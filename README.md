# Surround — multi-device synchronized audio

Turn the phones and laptops around you into **synchronized satellite speakers**
for music playing on your computer. Start a track on your Mac, have a few phones
join from their browsers, and they all play the same song in time — left,
right, mono, or full stereo per device — for a surround / multi-room effect.

No app install: phones just open a web page on the same Wi-Fi.

## How it works

The hard part of multi-speaker audio is **synchronization** — independent
devices have independent clocks and variable Wi-Fi latency, so naive streaming
drifts audibly. This app avoids that:

1. **Shared clock.** Every device estimates the offset between its own clock and
   the host's clock using Cristian's algorithm against `GET /api/time`
   (repeated samples, trust the lowest round-trip). On a LAN this agrees to a
   few milliseconds. See `lib/sync/clock.ts`.

2. **Local decode, synchronized start.** Each device downloads and decodes the
   *whole* track locally (Web Audio `decodeAudioData`), so there is no per-chunk
   network jitter during playback. The only thing synchronized is the **start
   instant**: the host anchors playback to a server timestamp a fraction of a
   second in the future, and every device schedules `AudioBufferSourceNode.start`
   for that same wall-clock moment. See `lib/sync/audio-engine.ts`.

3. **Drift correction.** Over long tracks, hardware audio clocks slowly diverge.
   Each device compares its real playback position to the position implied by the
   shared clock and gently nudges `playbackRate` (±3% max) to stay aligned; a
   large gap (e.g. after a stall) triggers a hard re-seek.

4. **Channel roles.** Each speaker maps the stereo signal to a role —
   `stereo`, `left`, `right`, or `mono` — plus a per-device volume and a manual
   delay trim for fine alignment. That's what lets phones act as surround
   satellites.

State is pushed to every device in real time over Server-Sent Events
(`/api/events`); the host controls transport via `POST /api/control`. Everything
runs inside the Next.js app — no separate server process.

### Routes

| Path                | Purpose                                                        |
| ------------------- | ------------------------------------------------------------- |
| `/`                 | **Host** dashboard: pick a track, play/pause/seek, see joined speakers. The host machine also plays as the main stereo pair. |
| `/speaker`          | **Speaker** page for phones: tap to join, choose channel role / volume / delay trim. |
| `/api/time`         | Clock reference for sync.                                      |
| `/api/events`       | SSE stream of transport + speaker-list snapshots.             |
| `/api/control`      | Transport mutations (setTrack / play / pause / seek / stop) + speaker heartbeats. |
| `/api/upload`       | Upload a song (kept in memory) for speakers to fetch.         |
| `/api/track/[id]`   | Serves an uploaded track's bytes.                             |
| `/api/state`        | One-shot snapshot (debugging).                                |

## Getting started

```bash
npm install
npm run dev
```

1. On the **host machine** (e.g. your Mac), open http://localhost:3000.
2. Choose a track — use the bundled test sound, upload a song, or paste an audio
   URL — then press **Play**. Click **Enable** under playback so the host plays
   audio too.
3. On each **phone** (same Wi-Fi), open `http://<host-lan-ip>:3000/speaker`
   (the host page shows the exact address to use), tap **Join**, and pick a
   channel role.

> Browsers require a user tap before they can produce audio, which is why each
> device has a "Join" / "Enable" step.

## Practical notes & limits

- **Same network.** Devices must reach the host over LAN. For phones, use the
  host's LAN IP shown on the dashboard.
- **Sync quality.** Expect alignment within tens of milliseconds over decent
  Wi-Fi — great for ambient / multi-room fill and surround effects. The manual
  per-speaker delay trim lets you fine-tune by ear.
- **Capturing arbitrary app audio** (e.g. Spotify) from the browser isn't
  possible without a system audio loopback driver, so the app plays a file/URL
  it controls end-to-end. That's what makes precise scheduling possible.
- **In-memory state.** The session store (`lib/sync/server-store.ts`) is
  process-local by design — the intended deployment is a single host process
  that everyone connects to.

## Tech

Next.js (App Router) · React · TypeScript · Web Audio API · Server-Sent Events ·
Tailwind CSS.
