import { useState, useEffect } from 'react';

const STATE_COLOR = {
  LEADER:      '#f5c542',
  FOLLOWER:    '#4a9eff',
  HOLDOVER:    '#ff8c42',
  FAULT:       '#ff4444',
  CALIBRATION: '#4affea',
  GROUND:      '#6b7280',
};

function fmtOffset(ns) {
  if (ns === null || ns === undefined) return '—';
  const us = ns / 1000;
  const sign = us >= 0 ? '+' : '';
  if (Math.abs(us) < 10000) return `${sign}${us.toFixed(1)} µs`;
  return `${sign}${(us / 1000).toFixed(2)} ms`;
}

function fmtRtt(ns) {
  if (ns === null || ns === undefined) return '—';
  return `${(ns / 1000).toFixed(1)} µs`;
}

function syncQualityColor(ns) {
  if (ns === null) return '#374151';
  const us = Math.abs(ns / 1000);
  if (us < 20)   return '#34d399';
  if (us < 100)  return '#f5c542';
  if (us < 1000) return '#ff8c42';
  return '#ff4444';
}

function timeSince(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 2)  return 'now';
  if (s < 60) return `${s.toFixed(0)}s ago`;
  return `${(s / 60).toFixed(0)}m ago`;
}

export default function NodeCard({ node }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const color   = STATE_COLOR[node.state] ?? '#6b7280';
  const qColor  = syncQualityColor(node.offsetNs);
  const isStale = Date.now() - node.lastSeen > 5000;

  return (
    <div className="node-card" style={{ '--node-color': color, opacity: isStale ? 0.5 : 1 }}>
      <div className="node-card-header">
        <span className="node-id">N:{node.nodeId}</span>
        <span className="node-state" style={{ color, borderColor: color }}>
          {node.state}
        </span>
        <span className="node-ip">{node.ip}</span>
      </div>

      <div className="node-metrics">
        <div className="metric">
          <span className="metric-label">OFFSET</span>
          <span className="metric-value" style={{ color: qColor }}>
            {fmtOffset(node.offsetNs)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">RTT</span>
          <span className="metric-value">{fmtRtt(node.rttNs)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">TERM</span>
          <span className="metric-value">{node.electionTerm ?? '—'}</span>
        </div>
        <div className="metric">
          <span className="metric-label">SEQ</span>
          <span className="metric-value">{node.seq ?? '—'}</span>
        </div>
      </div>

      <div className="node-footer">
        <span className="node-flags">
          {node.flags?.calibrated ? <span className="flag flag-ok">CAL</span> : <span className="flag flag-off">CAL</span>}
          {node.flags?.holdover   ? <span className="flag flag-warn">HLD</span> : null}
          {node.flags?.fault      ? <span className="flag flag-err">FLT</span> : null}
        </span>
        <span className="node-last-seen">{timeSince(node.lastSeen)}</span>
      </div>

      <style>{`
        .node-card {
          background: #0f1724;
          border: 1px solid #1a2d40;
          border-left: 3px solid var(--node-color);
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 0.72rem;
        }
        .node-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .node-id {
          font-weight: bold;
          font-size: 0.8rem;
          color: var(--node-color);
          min-width: 36px;
        }
        .node-state {
          font-size: 0.65rem;
          font-weight: bold;
          letter-spacing: 0.06em;
          padding: 1px 5px;
          border: 1px solid;
          border-radius: 3px;
          background: color-mix(in srgb, var(--node-color) 12%, transparent);
        }
        .node-ip {
          color: #374151;
          margin-left: auto;
          font-size: 0.68rem;
        }
        .node-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
          margin-bottom: 6px;
        }
        .metric {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .metric-label {
          color: #374151;
          font-size: 0.6rem;
          letter-spacing: 0.08em;
        }
        .metric-value {
          color: #9ca3af;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .node-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .node-flags { display: flex; gap: 4px; }
        .flag {
          font-size: 0.6rem;
          padding: 0 4px;
          border-radius: 2px;
          font-weight: bold;
          letter-spacing: 0.06em;
        }
        .flag-ok   { background: rgba(52,211,153,0.15); color: #34d399; }
        .flag-off  { background: rgba(55,65,81,0.3);    color: #374151; }
        .flag-warn { background: rgba(255,140,66,0.15); color: #ff8c42; }
        .flag-err  { background: rgba(255,68,68,0.15);  color: #ff4444; }
        .node-last-seen { color: #374151; font-size: 0.65rem; }
      `}</style>
    </div>
  );
}
