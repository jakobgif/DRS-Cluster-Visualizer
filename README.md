# DRS Cluster Visualizer

Real-time browser dashboard for a DRS synchronization cluster. Passively sniffs UDP multicast traffic from the cluster and visualizes node states, communication, and sync quality.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- Machine connected to the **same LAN** as the DRS cluster (wired preferred)

## Setup

```bash
# 1. Install dependencies (run once)
npm run install:all

# 2. Start both the backend and the frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

## What it does

| Component | Port | Role |
|---|---|---|
| `server/` | 3001 | Joins multicast group `239.192.88.100:47200`, parses DRS packets, streams updates via WebSocket |
| `client/` | 5173 | React/Vite app — connects to the WebSocket and renders the dashboard |

The server must be running on a machine that can receive multicast from the DRS nodes. The browser just needs to reach `localhost:3001`.

## Network requirement

Your machine needs to be on the same Layer-2 segment as the Pi nodes (`10.0.0.0/24`). The visualizer joins the DRS multicast group `239.192.88.100` on port `47200` — no changes to the cluster are needed.

If you are on Wi-Fi and the DRS nodes are on wired Ethernet with no multicast bridging, you will not receive packets.

## Running server and client separately

```bash
# Terminal 1 — backend
cd server
npm run dev

# Terminal 2 — frontend
cd client
npm run dev
```

## Dashboard

- **Cluster graph** — nodes arranged in a circle, color-coded by state. Animated lines show live SYNC_REQ / SYNC_RESP / ANNOUNCE traffic.
- **Node cards** — per-node: state, offset, RTT, election term, sequence number, flags.
- **Packet log** — scrolling stream of every received packet with timestamp, source IP, message type, and sequence number.

### Node states

| Color | State | Meaning |
|---|---|---|
| Gold | LEADER | Authoritative clock source |
| Blue | FOLLOWER | Synchronized to leader |
| Orange | HOLDOVER | Leader lost, running on last known rate (max 10 s) |
| Red | FAULT | Synchronization fault |
| Cyan | CALIBRATION | Self-latency calibration in progress |
| Gray | GROUND | Startup stabilization |

### Offset / RTT

These values are computed from the four-way timestamp exchange (T1–T4). They appear only if the DRS implementation includes all four timestamps in the sniffed packets. If the fields show `—`, the follower is computing the offset internally and not transmitting T4.
