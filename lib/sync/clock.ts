// Client-side clock synchronization against /api/time using Cristian's
// algorithm: sample several times, trust the sample with the smallest
// round-trip time, and assume latency is symmetric. The resulting offset lets
// every device agree on "server now" to within a few milliseconds on a LAN.

export class ClockSync {
  private offset = 0; // serverTime - clientTime, in ms
  private bestRtt = Number.POSITIVE_INFINITY;
  private synced = false;

  /** Run a burst of samples and keep the best one. */
  async sync(samples = 7): Promise<void> {
    for (let i = 0; i < samples; i++) {
      try {
        await this.sample();
      } catch {
        /* transient; keep going */
      }
      await delay(60);
    }
  }

  private async sample(): Promise<void> {
    const t0 = Date.now();
    const res = await fetch("/api/time", { cache: "no-store" });
    const t1 = Date.now();
    const { t: serverT } = (await res.json()) as { t: number };

    const rtt = t1 - t0;
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt;
      // Server timestamp corresponds to ~the midpoint of the round trip.
      this.offset = serverT + rtt / 2 - t1;
      this.synced = true;
    }
  }

  /** Best estimate of the server clock right now (epoch ms). */
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
