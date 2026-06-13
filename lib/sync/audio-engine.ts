// The speaker's audio engine.
//
// Strategy: each device downloads and decodes the *entire* track locally, so
// there is no per-chunk network jitter during playback. The only thing that
// must be synchronized is the *start instant*, which we derive from the shared
// transport anchor (a server timestamp) plus this device's estimated clock
// offset. Because all devices share one clock and one anchor, they start the
// same sample at the same wall-clock moment.
//
// Over long tracks, independent audio hardware clocks drift apart. A periodic
// drift check nudges playbackRate by a tiny amount to pull each device back
// onto the shared timeline without audible glitches; large discrepancies (e.g.
// after a stall) trigger a hard re-seek.

import type { ChannelRole, Transport } from "./types";
import type { ClockSync } from "./clock";

const DRIFT_NUDGE_THRESHOLD = 0.02; // 20 ms: start gently correcting
const DRIFT_RESEEK_THRESHOLD = 0.25; // 250 ms: too far off, hard re-seek
const MAX_RATE_TRIM = 0.03; // clamp playbackRate to [0.97, 1.03]

export interface EngineStatus {
  positionSec: number;
  driftMs: number;
  playing: boolean;
  ready: boolean;
}

export class AudioEngine {
  private ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  // Static routing graph: source -> splitter -> merger -> delay -> gain -> out
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private delay: DelayNode;
  private gain: GainNode;

  private role: ChannelRole = "stereo";
  private volume = 1;
  private trimSec = 0;

  // Bookkeeping for the currently scheduled source.
  private startCtxTime = 0; // ctx.currentTime at which playback (offset) begins
  private startOffset = 0; // position in the buffer at startCtxTime
  private playing = false;
  private appliedVersion = -1;
  private driftMs = 0;

  constructor() {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();

    this.splitter = this.ctx.createChannelSplitter(2);
    this.merger = this.ctx.createChannelMerger(2);
    this.delay = this.ctx.createDelay(1.0);
    this.gain = this.ctx.createGain();

    this.merger.connect(this.delay);
    this.delay.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.wireRole();
  }

  /** Must be called from a user gesture on mobile to unlock audio output. */
  async unlock(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  async loadTrack(url: string): Promise<number> {
    const res = await fetch(url, { cache: "force-cache" });
    const bytes = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(bytes);
    return this.buffer.duration;
  }

  setRole(role: ChannelRole): void {
    this.role = role;
    this.wireRole();
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Manual per-speaker delay trim (ms) for fine surround alignment. */
  setTrimMs(ms: number): void {
    this.trimSec = clamp(ms, 0, 1000) / 1000;
    this.delay.delayTime.setTargetAtTime(
      this.trimSec,
      this.ctx.currentTime,
      0.02,
    );
  }

  /**
   * Reconcile local playback with the shared transport state. Safe to call on
   * every snapshot and on a periodic tick. `clock.now()` must already be
   * synchronized to the server.
   */
  apply(transport: Transport, clock: ClockSync): void {
    if (!this.buffer) return;

    const versionChanged = transport.version !== this.appliedVersion;

    if (!transport.isPlaying) {
      if (this.playing || versionChanged) this.stopSource();
      this.appliedVersion = transport.version;
      return;
    }

    // Playing. Start (or restart) when the transport version changes.
    if (versionChanged || !this.playing) {
      this.startAt(transport, clock);
      this.appliedVersion = transport.version;
      return;
    }

    // Already playing this version: just check drift.
    this.correctDrift(transport, clock);
  }

  status(): EngineStatus {
    return {
      positionSec: this.playing
        ? this.startOffset + (this.ctx.currentTime - this.startCtxTime)
        : this.startOffset,
      driftMs: this.driftMs,
      playing: this.playing,
      ready: this.buffer !== null,
    };
  }

  destroy(): void {
    this.stopSource();
    void this.ctx.close();
  }

  // --- internals -----------------------------------------------------------

  private startAt(transport: Transport, clock: ClockSync): void {
    if (!this.buffer) return;
    this.stopSource();

    const serverNow = clock.now();
    const startInMs = transport.anchorServerTime - serverNow;

    let when: number;
    let offset: number;
    if (startInMs >= 0) {
      // Start is in the future: schedule precisely.
      when = this.ctx.currentTime + startInMs / 1000;
      offset = transport.positionSec;
    } else {
      // We joined (or this fired) after the anchor: jump in mid-stream.
      when = this.ctx.currentTime;
      offset = transport.positionSec + -startInMs / 1000;
    }

    if (offset >= this.buffer.duration) return; // past the end

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.splitter);
    src.start(when, offset);

    this.source = src;
    this.startCtxTime = when;
    this.startOffset = offset;
    this.playing = true;
    this.driftMs = 0;

    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.source = null;
      }
    };
  }

  private correctDrift(transport: Transport, clock: ClockSync): void {
    if (!this.source) return;

    const ctxNow = this.ctx.currentTime;
    const localPos = this.startOffset + (ctxNow - this.startCtxTime);
    const expectedPos = transport.positionSec + (clock.now() - transport.anchorServerTime) / 1000;
    const drift = localPos - expectedPos; // positive => we're ahead
    this.driftMs = drift * 1000;

    if (Math.abs(drift) > DRIFT_RESEEK_THRESHOLD) {
      this.startAt(transport, clock); // too far gone, resync hard
      return;
    }

    if (Math.abs(drift) > DRIFT_NUDGE_THRESHOLD) {
      // Ahead -> play slightly slower (<1); behind -> slightly faster (>1).
      const trim = clamp(-drift * 0.5, -MAX_RATE_TRIM, MAX_RATE_TRIM);
      this.source.playbackRate.setTargetAtTime(1 + trim, ctxNow, 0.1);
    } else {
      this.source.playbackRate.setTargetAtTime(1, ctxNow, 0.2);
    }
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  /**
   * Map the decoded stereo signal onto this device's role. The merger always
   * feeds a 2-channel output (so phone earpieces/speakers get sound), but what
   * lands on each output channel depends on the role.
   */
  private wireRole(): void {
    try {
      this.splitter.disconnect();
    } catch {
      /* nothing connected yet */
    }

    const L = 0;
    const R = 1;
    switch (this.role) {
      case "left":
        this.splitter.connect(this.merger, L, 0);
        this.splitter.connect(this.merger, L, 1);
        break;
      case "right":
        this.splitter.connect(this.merger, R, 0);
        this.splitter.connect(this.merger, R, 1);
        break;
      case "mono":
        // Sum both channels onto both outputs.
        this.splitter.connect(this.merger, L, 0);
        this.splitter.connect(this.merger, R, 0);
        this.splitter.connect(this.merger, L, 1);
        this.splitter.connect(this.merger, R, 1);
        break;
      case "stereo":
      default:
        this.splitter.connect(this.merger, L, 0);
        this.splitter.connect(this.merger, R, 1);
        break;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
