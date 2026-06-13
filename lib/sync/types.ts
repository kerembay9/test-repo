// Shared types for the multi-device synchronized audio system.

/** How a given speaker contributes to the surround field. */
export type ChannelRole = "stereo" | "left" | "right" | "mono";

export interface TrackInfo {
  id: string;
  name: string;
  /** URL the speakers fetch the audio from (relative to the server origin). */
  url: string;
  /** Track duration in seconds, if known by the host. */
  durationSec?: number;
}

/**
 * Transport state is the single source of truth for "what should be playing,
 * and exactly when". Position is anchored to the server clock so every device
 * can compute the same playback position independently.
 *
 *   positionAt(serverNow) =
 *     isPlaying ? positionSec + (serverNow - anchorServerTime) / 1000
 *               : positionSec
 */
export interface Transport {
  /** Monotonic counter; bumped on every change so clients can dedupe. */
  version: number;
  track: TrackInfo | null;
  isPlaying: boolean;
  /** Playback position (seconds) at the instant `anchorServerTime`. */
  positionSec: number;
  /** Server epoch (ms) that `positionSec` refers to. */
  anchorServerTime: number;
  /** True while the host is streaming live captured audio over WebRTC. */
  live: boolean;
  /** Peer id of the host while live, so speakers know whom to answer. */
  hostId: string | null;
}

/** WebRTC signaling message relayed between peers via /api/signal. */
export type SignalType = "offer" | "answer" | "ice";

export interface SignalMessage {
  from: string;
  to: string;
  type: SignalType;
  /** SDP string for offer/answer, or a serialized ICE candidate. */
  data: unknown;
}

export interface Speaker {
  id: string;
  name: string;
  connected: boolean;
  lastSeen: number;
  /** Self-reported live-stream latency (ms), used to auto-set the host delay. */
  latencyMs?: number;
}

export interface Snapshot {
  transport: Transport;
  speakers: Speaker[];
  /** Server epoch (ms) at the moment the snapshot was produced. */
  serverTime: number;
}

/** Compute the playback position (seconds) for a given server time. */
export function positionAt(transport: Transport, serverNow: number): number {
  if (!transport.isPlaying) return transport.positionSec;
  const elapsed = (serverNow - transport.anchorServerTime) / 1000;
  return transport.positionSec + Math.max(0, elapsed);
}
