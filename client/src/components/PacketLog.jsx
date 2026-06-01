import { useEffect, useRef, useState } from 'react';

const MSG_COLOR = {
  ANNOUNCE:  '#a78bfa',
  SYNC_REQ:  '#60a5fa',
  SYNC_RESP: '#34d399',
};

function fmtTime(ts) {
  const d = new Date(ts);
  return [
    d.getHours().toString().padStart(2, '0'),
    d.getMinutes().toString().padStart(2, '0'),
    d.getSeconds().toString().padStart(2, '0'),
  ].join(':') + '.' + d.getMilliseconds().toString().padStart(3, '0');
}

function shortIp(ip) {
  if (!ip) return '?';
  const parts = ip.split('.');
  // Show last two octets for clarity (e.g., 10.0.0.11 → "0.11")
  return parts.slice(-2).join('.');
}


export default function PacketLog({ packets }) {
  const logRef = useRef(null);
  const pinned = useRef(true);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(null);

  const display = paused ? frozen : packets;

  useEffect(() => {
    const el = logRef.current;
    if (!el || !pinned.current || paused) return;
    el.scrollTop = el.scrollHeight;
  }, [packets, paused]);

  function togglePause() {
    if (!paused) {
      setFrozen(packets);
    } else {
      pinned.current = true;
    }
    setPaused(p => !p);
  }

  function onScroll() {
    const el = logRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
  }

  return (
    <div className="pkt-log">
      <div className="pkt-log-header">
        <span>PACKET LOG</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className={`pkt-pause-btn ${paused ? 'pkt-pause-btn--paused' : ''}`} onClick={togglePause}>
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <span className="pkt-count">{display.length}</span>
        </div>
      </div>
      <div className="pkt-col-headers">
        <span>TIME</span>
        <span>NODE</span>
        <span>TYPE</span>
        <span>SEQ</span>
      </div>
      <div className="pkt-rows" ref={logRef} onScroll={onScroll}>
        {display.map((pkt, i) => {
          const color = MSG_COLOR[pkt.msgType] ?? '#6b7280';
          return (
            <div key={i} className="pkt-row">
              <span className="pkt-time">{fmtTime(pkt.rxTime)}</span>
              <span className="pkt-src">N:{pkt.nodeId}</span>
              <span className="pkt-type" style={{ color }}>{pkt.msgType}</span>
              <span className="pkt-seq">{pkt.seq}</span>
              {!pkt.crcOk && <span className="pkt-crc-err">CRC!</span>}
            </div>
          );
        })}
      </div>

      <style>{`
        .pkt-log {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          font-size: 0.68rem;
          font-family: 'Courier New', monospace;
        }
        .pkt-log-header {
          padding: 5px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #607080;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          border-bottom: 1px solid #1a2d40;
          flex-shrink: 0;
        }
        .pkt-count {
          background: #1a2d40;
          padding: 1px 6px;
          border-radius: 8px;
        }
        .pkt-pause-btn {
          background: none;
          border: 1px solid #1e3a50;
          color: #607080;
          font-family: 'Courier New', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.1em;
          padding: 1px 6px;
          border-radius: 3px;
          cursor: pointer;
        }
        .pkt-pause-btn:hover { border-color: #4a9eff; color: #4a9eff; }
        .pkt-pause-btn--paused { border-color: #f5c542; color: #f5c542; }
        .pkt-pause-btn--paused:hover { border-color: #f5c542; color: #f5c542; }
        .pkt-col-headers {
          display: grid;
          grid-template-columns: 90px 48px 84px 1fr;
          gap: 0;
          padding: 3px 12px;
          border-bottom: 1px solid #1a2d40;
          color: #3d5060;
          font-size: 0.6rem;
          letter-spacing: 0.1em;
          flex-shrink: 0;
        }
        .pkt-rows {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }
        .pkt-row {
          display: grid;
          grid-template-columns: 90px 48px 84px 1fr;
          gap: 0;
          padding: 2px 12px;
          border-bottom: 1px solid #0f1a26;
          align-items: center;
          white-space: nowrap;
        }
        .pkt-row:last-child { border-bottom: none; }
        .pkt-time   { color: #607080; }
        .pkt-src    { color: #6b7a88; }
        .pkt-type   { font-weight: bold; font-size: 0.68rem; letter-spacing: 0.04em; }
        .pkt-seq    { color: #607080; }
        .pkt-offset { color: #8090a0; }
        .pkt-crc-err {
          color: #ff4444;
          font-size: 0.6rem;
          font-weight: bold;
          background: rgba(255,68,68,0.1);
          padding: 0 3px;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
