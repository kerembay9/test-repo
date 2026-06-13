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
}

export interface Speaker {
  id: string;
  name: string;
  connected: boolean;
  lastSeen: number;
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
