import dgram from 'dgram';
import { WebSocketServer } from 'ws';
import { parsePacket } from './parser.js';

const MULTICAST_GROUP = '239.192.88.100';
const MULTICAST_PORT  = 47200;
const WS_PORT         = 3001;
const NODE_TTL_MS     = 30_000;
const MAX_PACKETS     = 200;

// nodeId → NodeInfo
const nodes = new Map();
// circular buffer of recent packets
const recentPackets = [];

function deriveState(packet) {
  const { flags, msgType } = packet;
  if (flags.fault)    return 'FAULT';
  if (flags.holdover) return 'HOLDOVER';
  if (flags.leader)   return 'LEADER';
  if (msgType === 'SYNC_REQ') return 'FOLLOWER';
  if (!flags.calibrated)      return 'CALIBRATION';
  return 'FOLLOWER';
}

function upsertNode(packet) {
  const prev = nodes.get(packet.nodeId) ?? {};
  const node = {
    nodeId:       packet.nodeId,
    ip:           packet.srcIp,
    state:        deriveState(packet),
    flags:        packet.flags,
    electionTerm: packet.electionTerm,
    seq:          packet.seq,
    offsetNs:     packet.offsetNs ?? prev.offsetNs ?? null,
    rttNs:        packet.rttNs    ?? prev.rttNs    ?? null,
    lastSeen:     packet.rxTime,
  };
  nodes.set(packet.nodeId, node);
  return node;
}

function pushPacket(pkt) {
  recentPackets.push(pkt);
  if (recentPackets.length > MAX_PACKETS) recentPackets.shift();
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`WebSocket  ws://localhost:${WS_PORT}`);

function broadcast(msg) {
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(json);
  }
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type:    'snapshot',
    nodes:   [...nodes.values()],
    packets: recentPackets,
  }));
});

// ── Stale-node cleanup ────────────────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - NODE_TTL_MS;
  for (const [id, node] of nodes) {
    if (node.lastSeen < cutoff) {
      nodes.delete(id);
      broadcast({ type: 'node_remove', nodeId: id });
    }
  }
}, 5_000);

// ── UDP multicast listener ────────────────────────────────────────────────────

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

socket.on('message', (msg, rinfo) => {
  const packet = parsePacket(msg, rinfo.address);
  if (!packet) return;
  if (!packet.crcOk) {
    console.warn(`CRC mismatch from ${rinfo.address} seq=${packet.seq}`);
  }
  pushPacket(packet);
  const node = upsertNode(packet);
  broadcast({ type: 'node_update', node });
  broadcast({ type: 'packet',      packet });
});

socket.on('listening', () => {
  try {
    socket.addMembership(MULTICAST_GROUP);
  } catch (e) {
    console.error('Failed to join multicast group:', e.message);
    console.error('Make sure your network interface supports multicast and you are on the DRS LAN.');
  }
  socket.setMulticastLoopback(true); // receive own traffic for local testing
  const addr = socket.address();
  console.log(`UDP listen  ${addr.address}:${addr.port}  group ${MULTICAST_GROUP}`);
});

socket.on('error', err => {
  console.error('UDP socket error:', err.message);
});

socket.bind(MULTICAST_PORT);
