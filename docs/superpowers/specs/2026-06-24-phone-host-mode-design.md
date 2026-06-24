# Surround — Phone Host Mode (no computer, LAN-only)

Date: 2026-06-24

## Goal

Let a group of phones run a synchronized-audio session **with no computer in the
room and no cloud server**. One phone becomes the *host* (the clock master and
audio source); the other phones join it as speakers, exactly like they join a
computer host today — just over a peer transport the host phone runs itself.

This is an additive option. The existing flow (a computer runs the Next.js
server, phones join its `/speaker` page in a WebView) is unchanged. Phone-host
mode is a second entry point on the onboarding screen: **"Host on this phone."**

## Why this is hard (and what we reuse)

The computer host gives phones three things over HTTP:

1. a **shared clock** reference (`GET /api/time`),
2. a **transport/control** channel (`/api/control`, `/api/events`),
3. an **audio source** — either a file every device fetches, or a live WebRTC
   stream the host broadcasts (`lib/sync/webrtc.ts`).

A phone can't run the Next.js Node server, so phone-host mode reimplements those
three responsibilities natively — but keeps the **protocol shape** identical to
`lib/sync` so the mental model (and much of the math) carries over:

- Clock sync is still **Cristian's algorithm** (`lib/sync/clock.ts`): sample
  several round trips, trust the lowest-RTT sample, assume symmetric latency.
  The only change is the transport — a WebRTC **DataChannel** instead of
  `fetch("/api/time")`.
- Transport state is still the `Transport` record from `lib/sync/types.ts`
  (version, isPlaying, positionSec, anchorServerTime, live, hostId). The host
  pushes it on change; speakers compute position with `positionAt()`.
- Live audio is still **host → each speaker, host is the offerer**, mirroring
  `HostBroadcaster` / `SpeakerReceiver` in `lib/sync/webrtc.ts` — but on
  `react-native-webrtc` instead of the browser RTCPeerConnection.

The chosen source for v1 is **live audio from the host phone** (the user's
pick): the host captures audio via `getUserMedia` and streams it to every
speaker. The file-sync path can be added later behind the same transport.

## The missing piece: serverless LAN signaling

WebRTC needs a signaling channel to trade SDP offer/answer + ICE *before* the
peer connection exists. With no server, the host phone provides the rendezvous
itself:

1. **Advertise.** The host opens a tiny TCP socket server on the device and
   advertises a Bonjour service `_surroundhost._tcp` (separate from the
   computer host's `_surround._tcp`) carrying its LAN IP + port. We already use
   `react-native-zeroconf` for discovery on the speaker onboarding screen.
2. **Discover.** Joining phones browse `_surroundhost._tcp`, list nearby hosts
   ("Found nearby" UI, already built), and open a TCP connection to the chosen
   host. A QR fallback encodes `ip:port` for when mDNS is blocked.
3. **Handshake.** Over that TCP socket the two phones exchange newline-delimited
   JSON signaling messages (`hello` → `welcome` → `sdp`/`ice`). This is the
   *only* job of the on-device server — it's a few hundred bytes per peer.
4. **Promote to WebRTC.** Once the peer connection is up, a reliable
   DataChannel named `ctrl` carries clock pings + transport updates, and the
   audio track carries playback. The TCP socket can then close.

```
        Bonjour _surroundhost._tcp                 WebRTC peer connection
 guest ───────browse──────►  host   guest ◄══ audio track (host offerer) ══ host
 guest ──TCP: hello/sdp/ice─► host   guest ◄══ ctrl DataChannel: ping/pong,
 host  ──TCP: welcome/sdp/ice► guest          transport ════════════════►
```

Why an on-device TCP socket rather than "pure" mDNS-only: a TXT record is far
too small to carry an SDP blob, and there is no standard LAN mechanism to push
one peer's offer to another without *some* listener. A short-lived TCP listener
on the host is the minimal honest answer to "serverless" — no cloud, no
computer, just one phone briefly accepting connections on the LAN.

## Module layout (`mobile/src/hostmode/`)

Pure-logic modules are framework-agnostic and unit-testable; everything that
touches a native module is isolated behind `native.ts` so the rest typechecks
and the app degrades gracefully where the native module is absent (e.g. Expo
Go).

| File | Responsibility | Native deps |
| --- | --- | --- |
| `protocol.ts` | Wire message types for the TCP handshake + `ctrl` DataChannel. Pure types. | — |
| `clock.ts` | `DatachannelClock`: Cristian's algorithm over a send/receive pair. Mirrors `lib/sync/clock.ts`. Pure logic. | — |
| `transport.ts` | Host-side `TransportController` (mutations + versioning) reusing `Transport`/`positionAt`. Pure logic. | — |
| `native.ts` | Lazy, guarded loaders for `react-native-webrtc` and `react-native-tcp-socket`; one friendly error if missing. | both |
| `signaling.ts` | `LanSignalHost` (TCP listen + Bonjour advertise) and `LanSignalGuest` (browse + TCP connect). | tcp, zeroconf |
| `session.ts` | `HostSession` / `GuestSession`: wires signaling → WebRTC → clock → transport. Live capture via `getUserMedia`. | webrtc |
| `useHostSession.ts` | React hook surfacing connection + peer state to the UI. | — |

## Dependencies & build

Phone-host mode needs two native modules added to `mobile/package.json`:

- `react-native-webrtc` — peer connection, DataChannel, `getUserMedia`. Ships a
  config plugin (`@config-plugins/react-native-webrtc`) that wires the iOS mic +
  the Android permissions.
- `react-native-tcp-socket` — the on-device signaling listener/dialer.

Both are native and require a **dev build / prebuild** (`npx expo prebuild`,
`expo run:ios|android`) — they do **not** run in Expo Go. The app already
depends on `react-native-zeroconf`, so it is already a dev-build app, not Expo
Go; this is consistent.

Permissions are mostly in place in `app.json`: `NSMicrophoneUsageDescription`,
`NSLocalNetworkUsageDescription`, `NSBonjourServices`, the `audio` background
mode, and Android `RECORD_AUDIO` / multicast. Phone-host mode must **un-block**
`android.permission.RECORD_AUDIO` (currently in `blockedPermissions` because the
speaker-only app never recorded) and add `_surroundhost._tcp` to
`NSBonjourServices`.

## Status / what's stubbed

This change lands the **architecture and the pure-logic core** plus the UI entry
point. The native adapters (`native.ts`, the WebRTC wiring in `session.ts`, the
TCP server in `signaling.ts`) are written against the documented module APIs but
**cannot be run or verified in CI / this environment** — they need a dev build
on two physical phones on the same Wi-Fi. They are intentionally isolated so the
rest of the module compiles and the app keeps working when the native modules
are absent (the host option surfaces a clear "needs a dev build" message rather
than crashing).

Concretely verified here: the pure-logic modules (`clock.ts`, `transport.ts`,
`protocol.ts`) and that the UI option renders and is gated. Not verified:
end-to-end audio between two phones — that requires device testing.

Both ends are now wired into the onboarding screen under a "no computer?"
divider: **"Host on this phone"** → `HostScreen` (capture + advertise +
broadcast) and **"Join a phone host"** → `GuestScreen` (browse
`_surroundhost._tcp` → pick a host → `GuestSession` answers the offer and plays
the incoming audio). The original computer-host join flow (the "Found nearby"
list and "Join as speaker" WebView) is untouched and still targets a computer
host. Remote audio from `react-native-webrtc` routes to the device output
automatically once the track arrives; the guest hook keeps a stream reference so
it isn't garbage-collected.

## Follow-ups

- **Audio routing polish**: on some devices remote audio defaults to the earpiece;
  add `InCallManager` (or an `AudioSession` config) on the guest to force the
  loud speaker, and surface per-speaker channel role / volume / delay-trim for
  phone-host guests (reuse the web `/speaker` controls).
- File-sync source for phone-host (each speaker fetches a track the host serves
  over the same TCP socket) — tighter sync than live capture, reuses
  `audio-engine.ts` math.
- Host migration / leader election if the host phone drops.
- Reuse the speaker WebView UI (channel role / volume / delay trim) for
  phone-host speakers so the two modes share one playback UI.
