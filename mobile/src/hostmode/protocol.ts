// Wire protocol for phone-host mode (no computer, LAN-only).
//
// Two transports carry these messages:
//   1. The on-device TCP signaling socket — used ONLY for the pre-WebRTC
//      handshake (hello / welcome / sdp / ice). Newline-delimited JSON.
//   2. The reliable `ctrl` WebRTC DataChannel — used once the peer connection
//      is up, for clock sync (ping/pong) and transport/control updates.
//
// The transport state itself reuses the web app's `Transport`/`ChannelRole`
// shapes so phone-host mode stays conceptually identical to the computer host
// (see lib/sync/types.ts). They are duplicated here, not imported, because the
// mobile app is a separate toolchain that does not depend on the web sources.

/** How a speaker contributes to the surround field. Matches lib/sync/types.ts. */
export type ChannelRole = "stereo" | "left" | "right" | "mono";

/** Transport state pushed host → speakers. Mirrors lib/sync/types.ts `Transport`. */
export interface Transport {
  /** Monotonic counter; bumped on every change so speakers can dedupe. */
  version: number;
  isPlaying: boolean;
  /** Playback position (seconds) at the instant `anchorHostTime`. */
  positionSec: number;
  /** Host epoch (ms) that `positionSec` refers to. */
  anchorHostTime: number;
  /** True while the host is streaming live captured audio. v1 is always live. */
  live: boolean;
  /** Stable id of the host peer, so speakers know whom they answer. */
  hostId: string;
}

// --- TCP signaling handshake messages ------------------------------------

export interface HelloMsg {
  kind: "hello";
  /** Stable per-install guest id. */
  id: string;
  name: string;
}

export interface WelcomeMsg {
  kind: "welcome";
  hostId: string;
  hostName: string;
  /** Host rejected the guest (e.g. free speaker cap reached). */
  rejected?: "limit";
}

export interface SdpMsg {
  kind: "sdp";
  /** RTCSessionDescriptionInit ({ type, sdp }). */
  description: { type: "offer" | "answer"; sdp: string };
}

export interface IceMsg {
  kind: "ice";
  /** RTCIceCandidateInit. */
  candidate: unknown;
}

export type SignalMsg = HelloMsg | WelcomeMsg | SdpMsg | IceMsg;

// --- `ctrl` DataChannel messages -----------------------------------------

/** Guest → host: clock probe. `t0` is the guest's send time (its own clock). */
export interface PingMsg {
  t: "ping";
  t0: number;
}

/** Host → guest: clock reply. Echoes `t0`, adds the host clock at reply time. */
export interface PongMsg {
  t: "pong";
  t0: number;
  tHost: number;
}

/** Host → guest: new transport state. */
export interface TransportMsg {
  t: "transport";
  transport: Transport;
}

/** Guest → host: self-reported metadata, including measured live latency. */
export interface MetaMsg {
  t: "meta";
  name: string;
  role: ChannelRole;
  latencyMs?: number;
}

export type CtrlMsg = PingMsg | PongMsg | TransportMsg | MetaMsg;

/** Parse a newline-delimited JSON frame, returning null on malformed input. */
export function parseFrame<T>(line: string): T | null {
  const s = line.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Encode a message as a single newline-terminated JSON frame. */
export function encodeFrame(msg: unknown): string {
  return JSON.stringify(msg) + "\n";
}
