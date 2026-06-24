// Clock synchronization for phone-host mode, over a WebRTC DataChannel.
//
// Same idea as the web app's lib/sync/clock.ts (Cristian's algorithm): the
// guest sends a burst of probes, the host echoes its own clock, and the guest
// trusts the sample with the smallest round-trip — assuming symmetric latency.
// The only difference is the transport: ping/pong frames on the `ctrl`
// DataChannel instead of `fetch("/api/time")`. The host phone's clock is the
// shared reference every speaker aligns to.

import type { PingMsg, PongMsg } from "./protocol";

/** Sends a ping frame to the host. Supplied by the session (DataChannel send). */
export type SendPing = (ping: PingMsg) => void;

export class DatachannelClock {
  private offset = 0; // hostTime - localTime, in ms
  private bestRtt = Number.POSITIVE_INFINITY;
  private synced = false;

  constructor(private sendPing: SendPing) {}

  /** Fire one probe. Call repeatedly (the session paces the burst). */
  probe(): void {
    this.sendPing({ t: "ping", t0: Date.now() });
  }

  /**
   * Handle a pong from the host. Keeps the estimate from the lowest-RTT sample.
   * `t0` is the original send time on THIS device's clock, so RTT and the
   * midpoint are both measured in the local timebase — no cross-clock subtraction
   * except the single offset we're solving for.
   */
  onPong(pong: PongMsg): void {
    const t1 = Date.now();
    const rtt = t1 - pong.t0;
    if (rtt < 0 || rtt >= this.bestRtt) return;
    this.bestRtt = rtt;
    // The host stamped tHost at ~the midpoint of the round trip.
    this.offset = pong.tHost + rtt / 2 - t1;
    this.synced = true;
  }

  /** Best estimate of the host clock right now (epoch ms). */
  now(): number {
    return Date.now() + this.offset;
  }

  get roundTripMs(): number {
    return this.bestRtt === Number.POSITIVE_INFINITY ? 0 : this.bestRtt;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get offsetMs(): number {
    return this.offset;
  }
}

/**
 * Host side is trivial: stamp the local clock when a ping arrives. Kept as a
 * function (not a class) because the host holds no per-guest clock state — each
 * pong is self-contained.
 */
export function answerPing(ping: PingMsg): PongMsg {
  return { t: "pong", t0: ping.t0, tHost: Date.now() };
}
