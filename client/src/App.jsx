import { useState, useEffect, useCallback, useRef } from 'react';
import ClusterGraph from './components/ClusterGraph.jsx';
import NodeCard from './components/NodeCard.jsx';
import PacketLog from './components/PacketLog.jsx';
import './App.css';

const WS_URL         = 'ws://localhost:3001';
const MAX_PACKETS_UI = 150;

export default function App() {
  const [nodes,     setNodes]     = useState(new Map());
  const [packets,   setPackets]   = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen  = () => setConnected(true);
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };

    ws.onmessage = e => {
      const msg = JSON.parse(e.data);

      if (msg.type === 'snapshot') {
        setNodes(new Map(msg.nodes.map(n => [n.nodeId, n])));
        setPackets(msg.packets.slice(-MAX_PACKETS_UI));

      } else if (msg.type === 'node_update') {
        setNodes(prev => new Map(prev).set(msg.node.nodeId, msg.node));

      } else if (msg.type === 'node_remove') {
        setNodes(prev => { const m = new Map(prev); m.delete(msg.nodeId); return m; });

      } else if (msg.type === 'packet') {
        setPackets(prev => {
          const next = [...prev, msg.packet];
          return next.length > MAX_PACKETS_UI ? next.slice(-MAX_PACKETS_UI) : next;
        });
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const nodeList = [...nodes.values()].sort((a, b) => a.nodeId - b.nodeId);
  const packetRate = packets.filter(p => Date.now() - p.rxTime < 1000).length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">DRS CLUSTER VISUALIZER</span>
          <span className="header-meta">
            {nodeList.length} node{nodeList.length !== 1 ? 's' : ''}
            &nbsp;·&nbsp;{packetRate} pkt/s
          </span>
        </div>
        <span className={`conn-badge ${connected ? 'conn-live' : 'conn-dead'}`}>
          {connected ? '● LIVE' : '○ CONNECTING…'}
        </span>
      </header>

      <main className="app-main">
        <section className="graph-panel">
          <ClusterGraph nodes={nodeList} packets={packets} />
        </section>

        <section className="side-panel">
          <div className="node-cards">
            {nodeList.length === 0
              ? <div className="empty-hint">No nodes detected — waiting for DRS multicast…</div>
              : nodeList.map(n => <NodeCard key={n.nodeId} node={n} />)
            }
          </div>
          <PacketLog packets={packets} nodes={nodes} />
        </section>
      </main>
    </div>
  );
}
