# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DRS (Distributed Real-time Synchronization) Cluster — a user-space distributed time synchronization system for Raspberry Pi 4B nodes. The goal is **<100 µs physical pulse delta** between cluster nodes, measured via GPIO 18 rising edges on an oscilloscope. All synchronization logic runs in pure Linux user space on PREEMPT_RT kernels.

The authoritative architecture spec is [drs_architecture_reviewed_fixed_v_21.md](drs_architecture_reviewed_fixed_v_21.md).

---

## Target Platform

- **Hardware**: Raspberry Pi 4B (Quad-core Cortex-A72), Gigabit Ethernet
- **OS**: PREEMPT_RT Linux
- **Language**: C (implied by the RT/syscall requirements)
- **Network**: Single-hop switched Gigabit LAN, UDP multicast only
- **IP schema**: `10.0.0.XY` where X = team ID (1–8), Y = node ID (1–3)

---

## Hard Constraints — Never Violate

**Clock discipline:**
- Never call `clock_settime()`, `adjtimex()`, or touch `CLOCK_REALTIME`
- All time corrections happen inside the virtual clock layer only
- Use `CLOCK_MONOTONIC_RAW` exclusively for all protocol timestamps

**Real-time hot path:**
- No floating-point arithmetic in the synchronization thread
- No mutex blocking; use atomic 64-bit ops with acquire/release ordering
- No dynamic heap allocation (`malloc`/`new`) in the sync loop
- No filesystem I/O or console output in the sync loop
- Use `clock_nanosleep()` to yield periodically — prevents softirq starvation and SSH lockout

**CPU isolation:**
- Core 3 is reserved exclusively for the sync thread (`isolcpus=3 nohz_full=3 rcu_nocbs=3`)
- Ethernet IRQs and WLAN interrupts must never execute on Core 3
- Sync thread: `SCHED_FIFO` priority 85, pinned to Core 3
- Lock all process memory with `mlockall(MCL_CURRENT | MCL_FUTURE)`

**Wire protocol:**
- All packets are exactly 64 bytes, fixed binary, big-endian
- No raw struct casting — serialize every field explicitly with `htons()`/`htonl()`/explicit 64-bit conversion
- Magic: `0x44525354` ("DRST"); CRC32 uses IEEE 802.3 (`0x04C11DB7`), reflected I/O, init `0xFFFFFFFF`
- Forbidden transports: TCP, Wi-Fi for sync, jumbo frames

---

## Virtual Clock Model

```
Tglobal = (Tlocal_raw × Rate) + Offset − LatencyCorrection_ns
```

- `Rate` is signed 64-bit **Q32.32 fixed-point** (`0x0000000100000000` = 1.0×)
- Max slew: ±1000 ppm
- PI controller defaults: Kp=0.05, Ki=0.005, update period=50 ms; integrator clamped to ±1000 ppm

---

## Node State Machine

`GROUND` → `CALIBRATION` → `LISTEN` → `CANDIDATE` → `LEADER` or `FOLLOWER` → `HOLDOVER`

- **GROUND**: 2 s startup, no transmissions, receive-only
- **CALIBRATION**: SO_TIMESTAMPING loopback, ≥50 samples, minimum-delay selection, reject outliers >20 µs
- Election: modified Bully — **lowest NodeID wins**; timeout randomized 250–500 ms
- **HOLDOVER**: maintains last stable Rate/Offset for max 10 s, then re-enters election; GPIO 23 goes HIGH

---

## Synchronization Protocol

- Discovery: UDP multicast `239.192.88.100:47200`, `IP_MULTICAST_LOOP=0`
- Leader announces at 100 ms; follower timeout = 3 missed heartbeats; sync exchange = 50 ms
- Timestamps T1–T4 (CLOCK_MONOTONIC_RAW ns): offset θ = ((T2−T1)+(T3−T4))/2; RTT δ = (T4−T1)−(T3−T2)
- Min-delay filter: rolling window=10, accept only samples within min_RTT + 10 µs
- Step mode triggers after **3 consecutive samples** with |θ| > 1 ms; otherwise slew via PI

---

## GPIO

- **GPIO 18**: 10 ms HIGH pulse once per global second (rising edge = second boundary); jitter <20 µs
- **GPIO 23**: LOW = synchronized (|offset| < 100 µs for 10 s continuous); HIGH = any other state

---

## Filter Reset Conditions

Reset sync state on: reboot, sequence discontinuity, leader change, timestamp overflow, phase correction >5 ms.

Sequence numbers are uint16 with wraparound; backward jump >1024 invalidates sync state.

---

## Disabled Services (required on each node)

`systemd-timesyncd`, `chronyd`, `ntpd`, `ptp4l`, `phc2sys` — all must be disabled.

---

## systemd Unit

See section 12 of the architecture doc for the canonical `.service` file (`CPUAffinity=3`, `CPUSchedulingPolicy=fifo`, `CPUSchedulingPriority=85`, `LimitMEMLOCK=infinity`).

---

## Visualizer (this repo)

A browser-based real-time visualizer for the DRS cluster. Passive UDP multicast sniffer + WebSocket relay + React frontend.

### Commands

```bash
# Install all dependencies (first time)
npm run install:all   # from repo root, or:
cd server && npm install
cd client && npm install

# Run both server and client (two terminals, or from root):
npm run dev           # root — uses concurrently

# Individually:
cd server && npm run dev   # Node.js WS server on :3001  (node --watch)
cd client && npm run dev   # Vite dev server   on :5173
```

Open `http://localhost:5173` after starting both.

### Architecture

```
DRS nodes (Pi LAN)
  │  UDP multicast 239.192.88.100:47200
  ▼
server/src/index.js    — joins multicast group, parses 64-byte DRS packets,
                         maintains node state map, broadcasts via WebSocket
  │  ws://localhost:3001
  ▼
client/src/App.jsx     — WebSocket client, state management
  ├── ClusterGraph.jsx — SVG topology: nodes in circle, animated packet links
  ├── NodeCard.jsx     — per-node status (state, offset, RTT, flags)
  └── PacketLog.jsx    — scrolling packet stream with auto-scroll
```

### WebSocket event types

| Type | Direction | Description |
|---|---|---|
| `snapshot` | server→client | Full state on connect: `{ nodes[], packets[] }` |
| `node_update` | server→client | Upsert a node: `{ node }` |
| `node_remove` | server→client | Node expired (30 s TTL): `{ nodeId }` |
| `packet` | server→client | Every parsed packet: `{ packet }` |

### Offset/RTT availability

Offset (θ) and RTT (δ) require all four timestamps T1–T4. In passive multicast sniffing, T4 is computed by the follower locally and is typically zero in sniffed SYNC_RESP packets — so these metrics show `—` unless the DRS implementation populates T4 in the outgoing packet. The node's state and flags are always fully visible.

---

## Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

---

## Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Git Style

Commit proactively after each plan phase is complete, tested, and confirmed working — do not wait to be asked. Follow the git style: one file (or tightly related file group) per commit. Never bundle unrelated files into a single commit. Keep commit messages short and focused — one change, one message. Do not create long commit message chains.

Do not touch already-committed code unless the task requires it. No reformatting, no comment tweaks, no whitespace cleanup as a side effect. Before committing, review the full diff and remove any unintended changes.

Never commit "current state" snapshots or plan markdown files. These exist as working files only and must not enter git history. Before every commit, review what is staged and exclude any planning or status documents.

**Autonomous commits** (made during implementation without being asked): Claude is the sole author — do not add a co-author trailer.

**User-requested commits** (user explicitly asks to commit): Add Claude as co-author:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
