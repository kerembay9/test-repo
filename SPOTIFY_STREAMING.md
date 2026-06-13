# Live audio streaming (Spotify / system audio) — design

## Goal

Let the host stream whatever is playing on the Mac (e.g. the Spotify desktop
app) to the joined phone speakers, in addition to the existing file-based mode.

## Why the file engine can't do it

The default engine downloads a track file and decodes it locally. Spotify is
DRM'd: no file to download, and the Web Playback SDK's audio is EME-protected so
Web Audio can't tap it. The only general way to get "what the Mac is playing" is
to **capture an audio stream on the host and send it live** to the phones.

## Capture (host side)

Browsers cannot read the system mixer directly. Two supported inputs:

1. **Loopback input device (recommended for the Spotify app).** Install a
   virtual device — [BlackHole](https://existential.audio/blackhole/) (free) —
   and a macOS *Multi-Output Device* (Audio MIDI Setup) that sends sound to both
   your real speakers and BlackHole. Spotify → Multi-Output → BlackHole is then
   selectable as a microphone-like input. The host picks it from a device list
   and we capture it with `getUserMedia({ audio: { deviceId } })`.

2. **Tab/screen share (no install, Spotify *Web Player* only).**
   `getDisplayMedia({ audio: true })` — share the Spotify web player tab with
   "share tab audio". Works without BlackHole but only for the web player.

## Transport: WebRTC mesh, host → each speaker

- The host opens one `RTCPeerConnection` per speaker, adds the captured audio
  track (sendonly), and is always the **offerer**.
- Speakers are **answerers**; `ontrack` feeds the incoming `MediaStream` into the
  existing `AudioEngine` graph (so per-speaker role / volume / delay-trim still
  apply).
- LAN-local ICE candidates connect directly; a public STUN server is configured
  as a fallback. No TURN (same-Wi-Fi assumption).

## Signaling

A dedicated channel, separate from the snapshot SSE so existing playback is
untouched:

- `GET /api/signal/stream?id=<peerId>` — SSE; registers a per-peer mailbox.
- `POST /api/signal` — `{ to, from, type, data }`, relayed to `to`'s mailbox.
- `type` ∈ `offer | answer | ice`.

The host (controller) gets a stable random id like speakers do, so messages can
be addressed both ways.

## State: a "live" flag

`Transport` gains `live: boolean` and `hostId: string | null`, set via two new
control actions `goLive` / `endLive`. When `live` is true:

- speakers stop the file-apply loop and start a `SpeakerReceiver` pointed at
  `hostId`;
- when `live` goes false they tear the receiver down and resume file mode.

## Sync caveat

Live streaming gives up the file engine's sample-accurate shared-start trick.
WebRTC delivers a real-time stream with its own jitter buffer, so phones lag the
Mac's own speakers by tens of milliseconds and can't be tightly phase-aligned.
Per-speaker **delay trim** is the manual knob to line them up by ear. This is the
expected tradeoff of live capture and is documented in the UI.

## Files

- `lib/sync/id.ts` — shared `randomId()` (used by host + speakers).
- `lib/sync/webrtc.ts` — `HostBroadcaster`, `SpeakerReceiver`.
- `lib/sync/useSignaling.ts` — signaling SSE hook + `send(to, msg)`.
- `app/api/signal/route.ts`, `app/api/signal/stream/route.ts` — relay.
- `AudioEngine.attachStream/detachStream` — play a live `MediaStream`.
- `HostDashboard` — capture UI + broadcaster; `speaker/page` — receiver.
