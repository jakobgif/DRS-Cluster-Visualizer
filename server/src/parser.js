// CRC32 table — IEEE 802.3, reflected polynomial 0xEDB88320
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf, start, end) {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readUint64BE(buf, offset) {
  const hi = BigInt(buf.readUInt32BE(offset));
  const lo = BigInt(buf.readUInt32BE(offset + 4));
  return (hi << 32n) | lo;
}

const MAGIC = 0x44525354; // "DRST"
const MSG_TYPE_MAP = { 0x01: 'ANNOUNCE', 0x02: 'SYNC_REQ', 0x03: 'SYNC_RESP' };

// Packet layout (64 bytes, big-endian):
//  0- 3: Magic (uint32)
//  4:    Version (uint8)
//  5:    MsgType (uint8)
//  6:    Flags (uint8)
//  7:    Reserved (uint8)
//  8- 9: Seq (uint16)
// 10-13: NodeID (uint32)
// 14-17: ElectionTerm (uint32)
// 18-25: T1 (uint64)
// 26-33: T2 (uint64)
// 34-41: T3 (uint64)
// 42-49: T4 (uint64)
// 50-53: CRC32 (uint32)  — over full 64-byte packet with this field zeroed
// 54-63: Padding (10 bytes, zero)

export function parsePacket(buf, srcIp) {
  if (buf.length < 64) return null;
  if (buf.readUInt32BE(0) !== MAGIC) return null;

  const version     = buf.readUInt8(4);
  const msgTypeByte = buf.readUInt8(5);
  const flagsByte   = buf.readUInt8(6);
  const seq         = buf.readUInt16BE(8);
  const nodeId      = buf.readUInt32BE(10);
  const electionTerm = buf.readUInt32BE(14);
  const t1 = readUint64BE(buf, 18);
  const t2 = readUint64BE(buf, 26);
  const t3 = readUint64BE(buf, 34);
  const t4 = readUint64BE(buf, 42);
  const storedCrc = buf.readUInt32BE(50);

  const tmp = Buffer.from(buf.subarray(0, 64));
  tmp.writeUInt32BE(0, 50);
  const crcOk = crc32(tmp, 0, 64) === storedCrc;

  const msgType = MSG_TYPE_MAP[msgTypeByte] ?? `UNK(0x${msgTypeByte.toString(16)})`;

  const flags = {
    leader:     !!(flagsByte & 0x01),
    holdover:   !!(flagsByte & 0x02),
    calibrated: !!(flagsByte & 0x04),
    fault:      !!(flagsByte & 0x08),
  };

  // Full offset+RTT only when all four timestamps are present (rare in passive sniffing;
  // T4 is filled by the follower locally and may not appear in sniffed SYNC_RESP packets).
  let offsetNs = null;
  let rttNs    = null;
  if (t1 > 0n && t2 > 0n && t3 > 0n && t4 > 0n) {
    offsetNs = Number(((t2 - t1) + (t3 - t4)) / 2n);
    rttNs    = Number((t4 - t1) - (t3 - t2));
  }

  return {
    version,
    msgType,
    flags,
    seq,
    nodeId,
    electionTerm,
    t1: t1.toString(),
    t2: t2.toString(),
    t3: t3.toString(),
    t4: t4.toString(),
    offsetNs,
    rttNs,
    crcOk,
    srcIp,
    rxTime: Date.now(),
  };
}

// Telemetry packet layout (40 bytes, little-endian):
//  0- 7: timestamp_ns (int64)
//  8-11: state        (int32)
// 12-19: offset_ns    (int64)
// 20-27: rtt_ns       (int64)
// 28-35: rate_q32     (int64, Q32.32 fixed-point)
// 36-39: node_id      (uint32)

const TELEMETRY_STATES = ['GROUND', 'CALIBRATION', 'LISTEN', 'CANDIDATE', 'FOLLOWER', 'LEADER', 'HOLDOVER'];
const RATE_ONE = 4294967296; // 2^32 — safe as Number; deviations are << 2^53

export function parseTelemetry(buf, srcIp) {
  if (buf.length < 40) return null;
  const state    = buf.readInt32LE(8);
  const offsetNs = Number(buf.readBigInt64LE(12));
  const rttNs    = Number(buf.readBigInt64LE(20));
  const rateQ32  = Number(buf.readBigInt64LE(28));
  const nodeId   = buf.readUInt32LE(36);

  return {
    nodeId,
    srcIp,
    state:   TELEMETRY_STATES[state] ?? 'UNKNOWN',
    offsetNs,
    rttNs,
    ratePpm: (rateQ32 - RATE_ONE) / RATE_ONE * 1e6,
    rxTime:  Date.now(),
  };
}
