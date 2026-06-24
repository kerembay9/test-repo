// Host-side transport state for phone-host mode.
//
// The host owns the single source of truth for "what is playing and exactly
// when", anchored to the host phone's clock. Mirrors the web app's transport
// model (lib/sync/types.ts): position is stored as a value at an anchor instant,
// so any speaker can compute the live position from the shared clock alone.

import type { Transport } from "./protocol";

/** Compute playback position (seconds) at a given host time. Pure. */
export function positionAt(transport: Transport, hostNow: number): number {
  if (!transport.isPlaying) return transport.positionSec;
  const elapsed = (hostNow - transport.anchorHostTime) / 1000;
  return transport.positionSec + Math.max(0, elapsed);
}

/**
 * Mutable host-side controller. Every mutation re-anchors position to the
 * current host time and bumps `version`, so speakers always receive a
 * self-consistent snapshot they can dedupe.
 */
export class TransportController {
  private state: Transport;
  private readonly now: () => number;

  constructor(hostId: string, now: () => number) {
    this.now = now;
    this.state = {
      version: 0,
      isPlaying: false,
      positionSec: 0,
      anchorHostTime: now(),
      live: true, // v1 phone-host is always a live capture stream
      hostId,
    };
  }

  get(): Transport {
    return this.state;
  }

  /** Re-anchor the current position to now without changing play/pause. */
  private reanchor(): void {
    const hostNow = this.now();
    this.state = {
      ...this.state,
      positionSec: positionAt(this.state, hostNow),
      anchorHostTime: hostNow,
      version: this.state.version + 1,
    };
  }

  play(): Transport {
    if (this.state.isPlaying) return this.state;
    this.reanchor();
    this.state = { ...this.state, isPlaying: true };
    return this.state;
  }

  pause(): Transport {
    if (!this.state.isPlaying) return this.state;
    this.reanchor(); // freezes position at the current instant
    this.state = { ...this.state, isPlaying: false };
    return this.state;
  }

  /** Jump to an absolute position (seconds). */
  seek(positionSec: number): Transport {
    this.state = {
      ...this.state,
      positionSec: Math.max(0, positionSec),
      anchorHostTime: this.now(),
      version: this.state.version + 1,
    };
    return this.state;
  }
}
