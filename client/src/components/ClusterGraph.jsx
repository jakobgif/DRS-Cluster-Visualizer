import { useState, useEffect, useRef } from 'react';

const STATE_COLOR = {
  LEADER:      '#f5c542',
  FOLLOWER:    '#4a9eff',
  HOLDOVER:    '#ff8c42',
  FAULT:       '#ff4444',
  CALIBRATION: '#4affea',
  GROUND:      '#6b7280',
};

function nodePos(index, total, cx, cy, r) {
  if (total === 1) return { x: cx, y: cy };
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

export default function ClusterGraph({ nodes, packets }) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 600, h: 500 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Animation ticker for fading links
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 80);
    return () => clearInterval(id);
  }, []);

  const { w, h } = dims;
  const cx = w / 2;
  const cy = h / 2;
  const r  = Math.min(w, h) * 0.30;

  const sorted = [...nodes].sort((a, b) => a.nodeId - b.nodeId);
  const posMap = new Map(sorted.map((n, i) => [n.nodeId, nodePos(i, sorted.length, cx, cy, r)]));
  const leader = sorted.find(n => n.state === 'LEADER');

  // Build active directional links from packets in the last 2 s
  const now = Date.now();
  const linkMap = new Map(); // key → { fromPos, toPos, msgType, opacity }

  for (const pkt of packets) {
    const age = now - pkt.rxTime;
    if (age > 2000) continue;
    const opacity = 1 - age / 2000;

    const fromPos = posMap.get(pkt.nodeId);
    if (!fromPos) continue;

    if (pkt.msgType === 'SYNC_REQ' && leader && pkt.nodeId !== leader.nodeId) {
      const toPos = posMap.get(leader.nodeId);
      if (!toPos) continue;
      const key = `req-${pkt.nodeId}`;
      const cur = linkMap.get(key);
      if (!cur || opacity > cur.opacity) {
        linkMap.set(key, { fromPos, toPos, msgType: 'SYNC_REQ', opacity });
      }

    } else if (pkt.msgType === 'SYNC_RESP' && leader && pkt.nodeId === leader.nodeId) {
      // We don't know which follower; light up all follower lines briefly
      for (const follower of sorted) {
        if (follower.nodeId === leader.nodeId) continue;
        const toPos = posMap.get(follower.nodeId);
        if (!toPos) continue;
        const key = `resp-${follower.nodeId}`;
        const cur = linkMap.get(key);
        if (!cur || opacity > cur.opacity) {
          linkMap.set(key, { fromPos, toPos: toPos, msgType: 'SYNC_RESP', opacity });
        }
      }

    } else if (pkt.msgType === 'ANNOUNCE') {
      const key = `ann-${pkt.nodeId}`;
      const cur = linkMap.get(key);
      if (!cur || opacity > cur.opacity) {
        // Store as a node glow marker rather than a line
        linkMap.set(key, { fromPos, toPos: null, msgType: 'ANNOUNCE', opacity, nodeId: pkt.nodeId });
      }
    }
  }

  const links = [...linkMap.values()].filter(l => l.toPos !== null);
  const announceGlows = [...linkMap.values()].filter(l => l.toPos === null);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg width={w} height={h}>
        <defs>
          <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#0f1d2e" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0a0e1a" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background ring */}
        {sorted.length > 0 && (
          <>
            <circle cx={cx} cy={cy} r={r + 30} fill="url(#bgGrad)" />
            <circle cx={cx} cy={cy} r={r}
              fill="none" stroke="#1a2a3a" strokeWidth={1} strokeDasharray="3 6" />
          </>
        )}

        {/* Static sync lines (follower → leader) */}
        {leader && sorted.filter(n => n.state === 'FOLLOWER' && posMap.get(n.nodeId)).map(n => {
          const from = posMap.get(n.nodeId);
          const to   = posMap.get(leader.nodeId);
          if (!from || !to) return null;
          return (
            <line key={`static-${n.nodeId}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#1a2d42" strokeWidth={1} />
          );
        })}

        {/* Animated packet links */}
        {links.map(({ fromPos, toPos, msgType, opacity }, i) => (
          <line key={i}
            x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y}
            className={`link-${msgType.toLowerCase().replace('_', '-')}`}
            opacity={opacity}
          />
        ))}

        {/* ANNOUNCE glows */}
        {announceGlows.map(({ fromPos, opacity, nodeId }) => (
          <circle key={`ag-${nodeId}`}
            cx={fromPos.x} cy={fromPos.y} r={32}
            fill="none" stroke="#a78bfa" strokeWidth={1.5}
            opacity={opacity * 0.8}
          />
        ))}

        {/* Nodes */}
        {sorted.map(node => {
          const pos = posMap.get(node.nodeId);
          if (!pos) return null;
          const color    = STATE_COLOR[node.state] ?? '#6b7280';
          const isLeader = node.state === 'LEADER';
          const isStale  = (now - node.lastSeen) > 5000;

          return (
            <g key={node.nodeId} transform={`translate(${pos.x},${pos.y})`} opacity={isStale ? 0.4 : 1}>
              {/* Leader outer pulse ring */}
              {isLeader && (
                <circle r={34} fill="none" stroke={color} strokeWidth={1.5}
                  className="leader-pulse" />
              )}

              {/* Node body */}
              <circle r={22} fill="#0f1724" stroke={color}
                strokeWidth={isLeader ? 2.5 : 1.5}
                filter={isLeader ? 'url(#glow)' : undefined} />

              {/* NodeID label */}
              <text textAnchor="middle" dy="0.35em"
                fontSize={11} fill={color} fontFamily="'Courier New', monospace" fontWeight="bold">
                {node.nodeId}
              </text>

              {/* State label above */}
              <text textAnchor="middle" y={-30}
                fontSize={8} fill={color} opacity={0.8} fontFamily="'Courier New', monospace">
                {node.state}
              </text>

              {/* Offset below (µs) */}
              {node.offsetNs !== null && (
                <text textAnchor="middle" y={34}
                  fontSize={8} fill="#6b7280" fontFamily="'Courier New', monospace">
                  {(node.offsetNs / 1000).toFixed(1)}µs
                </text>
              )}

              {/* IP label */}
              <text textAnchor="middle" y={44}
                fontSize={7} fill="#374151" fontFamily="'Courier New', monospace">
                {node.ip}
              </text>
            </g>
          );
        })}

        {/* Empty state */}
        {sorted.length === 0 && (
          <text x={cx} y={cy} textAnchor="middle"
            fill="#1e3a5a" fontSize={13} fontFamily="'Courier New', monospace">
            Waiting for DRS multicast packets…
          </text>
        )}
      </svg>
    </div>
  );
}
