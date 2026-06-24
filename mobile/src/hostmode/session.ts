// Phone-host session: ties signaling → WebRTC → clock → transport together.
//
// Topology mirrors the web app (lib/sync/webrtc.ts): the HOST is always the
// offerer, captures live audio, and adds it sendonly to each guest; guests
// answer and play the incoming stream. A reliable `ctrl` DataChannel per peer
// carries clock pings and transport updates. The difference from the web app is
// only the transport (on-device TCP signaling + react-native-webrtc) — the
// roles and message flow are the same.

import {
  encodeFrame,
  parseFrame,
  type CtrlMsg,
  type Transport,
} from "./protocol";
import { answerPing, DatachannelClock } from "./clock";
import { TransportController } from "./transport";
import { LanSignalGuest, LanSignalHost, type SignalLink } from "./signaling";
import {
  loadWebrtc,
  type DataChannelLike,
  type MediaStreamLike,
  type RTCPeerConnectionLike,
} from "./native";

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Buffer ICE that arrives before the remote description is set. */
class Peer {
  remoteReady = false;
  private pendingIce: unknown[] = [];

  constructor(public pc: RTCPeerConnectionLike) {}

  async setRemote(desc: unknown): Promise<void> {
    await this.pc.setRemoteDescription(desc);
    this.remoteReady = true;
    for (const c of this.pendingIce.splice(0)) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  async addIce(candidate: unknown): Promise<void> {
    if (!this.remoteReady) {
      this.pendingIce.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate).catch(() => {});
  }
}

export interface HostPeerInfo {
  key: string;
  connected: boolean;
}

export interface HostSessionEvents {
  onPeers?: (peers: HostPeerInfo[]) => void;
  onError?: (err: Error) => void;
}

/**
 * Host side. Captures the mic, advertises on the LAN, and broadcasts to every
 * guest that connects. Holds the authoritative clock + transport.
 */
export class HostSession {
  private rtc = loadWebrtc();
  private signal: LanSignalHost;
  private transport: TransportController;
  private stream: MediaStreamLike | null = null;
  private peers = new Map<string, { peer: Peer; ctrl: DataChannelLike | null }>();

  constructor(
    private hostId: string,
    hostName: string,
    private events: HostSessionEvents = {},
  ) {
    this.signal = new LanSignalHost(hostName);
    this.transport = new TransportController(hostId, () => Date.now());
  }

  /** Capture audio and start accepting guests. */
  async start(): Promise<void> {
    this.stream = await this.rtc.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.signal.start((link) => void this.onGuest(link));
  }

  private async onGuest(link: SignalLink): Promise<void> {
    const pc = new this.rtc.RTCPeerConnection(RTC_CONFIG) as RTCPeerConnectionLike;
    const peer = new Peer(pc);
    const entry = { peer, ctrl: null as DataChannelLike | null };
    this.peers.set(link.peerKey, entry);

    for (const track of this.stream?.getTracks() ?? []) {
      pc.addTrack(track, this.stream);
    }

    // Host opens the control channel; guest receives it via ondatachannel.
    const ctrl = pc.createDataChannel("ctrl", { ordered: true });
    entry.ctrl = ctrl;
    ctrl.onopen = () => this.pushTransport(ctrl);
    ctrl.onmessage = (e) => this.onCtrl(ctrl, e.data);

    pc.onicecandidate = (e) => {
      if (e.candidate) link.send({ kind: "ice", candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed" || s === "disconnected") {
        this.dropPeer(link.peerKey);
      }
      this.emitPeers();
    };

    link.onMessage((msg) => void this.onSignal(peer, link, msg));

    link.send({ kind: "welcome", hostId: this.hostId, hostName: "" });
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    link.send({ kind: "sdp", description: offer as { type: "offer"; sdp: string } });
    this.emitPeers();
  }

  private async onSignal(peer: Peer, link: SignalLink, msg: unknown): Promise<void> {
    const m = msg as { kind?: string; description?: unknown; candidate?: unknown };
    try {
      if (m.kind === "sdp" && m.description) {
        await peer.setRemote(new this.rtc.RTCSessionDescription(m.description));
      } else if (m.kind === "ice" && m.candidate) {
        await peer.addIce(new this.rtc.RTCIceCandidate(m.candidate));
      }
    } catch (err) {
      this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onCtrl(ctrl: DataChannelLike, data: string): void {
    const msg = parseFrame<CtrlMsg>(data);
    if (!msg) return;
    if (msg.t === "ping") {
      ctrl.send(encodeFrame(answerPing(msg)));
    }
    // `meta` (role/name/latency) is surfaced to the UI in a later iteration.
  }

  private pushTransport(ctrl: DataChannelLike): void {
    if (ctrl.readyState !== "open") return;
    ctrl.send(encodeFrame({ t: "transport", transport: this.transport.get() }));
  }

  private broadcastTransport(): void {
    for (const { ctrl } of this.peers.values()) {
      if (ctrl) this.pushTransport(ctrl);
    }
  }

  play(): void {
    this.transport.play();
    this.broadcastTransport();
  }

  pause(): void {
    this.transport.pause();
    this.broadcastTransport();
  }

  private dropPeer(key: string): void {
    const entry = this.peers.get(key);
    if (!entry) return;
    try {
      entry.peer.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(key);
  }

  private emitPeers(): void {
    this.events.onPeers?.(
      [...this.peers.entries()].map(([key, e]) => ({
        key,
        connected: e.peer.pc.connectionState === "connected",
      })),
    );
  }

  stop(): void {
    for (const key of [...this.peers.keys()]) this.dropPeer(key);
    for (const track of this.stream?.getTracks() ?? []) {
      (track as { stop?: () => void }).stop?.();
    }
    this.stream = null;
    this.signal.stop();
  }
}

export interface GuestSessionEvents {
  onStream?: (stream: MediaStreamLike) => void;
  onTransport?: (transport: Transport) => void;
  onError?: (err: Error) => void;
}

/**
 * Guest side. Discovers/dials a phone host, answers its offer, plays the
 * incoming audio, and keeps a clock estimate via ctrl ping/pong.
 */
export class GuestSession {
  private rtc = loadWebrtc();
  private guest = new LanSignalGuest();
  private pc: RTCPeerConnectionLike | null = null;
  private ctrl: DataChannelLike | null = null;
  private clock: DatachannelClock | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private guestId: string,
    private name: string,
    private events: GuestSessionEvents = {},
  ) {}

  /** Browse for nearby phone hosts; returns a stop function. */
  browse = this.guest.browse.bind(this.guest);

  /** Connect to a host at ip:port and run the WebRTC handshake. */
  async connect(host: string, port: number): Promise<void> {
    const link = await this.guest.connect(host, port);
    const pc = new this.rtc.RTCPeerConnection(RTC_CONFIG) as RTCPeerConnectionLike;
    this.pc = pc;
    const peer = new Peer(pc);

    pc.ontrack = (e) => {
      this.events.onStream?.(e.streams[0]);
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "ctrl") this.attachCtrl(e.channel);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) link.send({ kind: "ice", candidate: e.candidate });
    };

    link.onMessage(async (msg) => {
      try {
        if (msg.kind === "sdp" && msg.description.type === "offer") {
          await peer.setRemote(new this.rtc.RTCSessionDescription(msg.description));
          const answer = await pc.createAnswer({});
          await pc.setLocalDescription(answer);
          link.send({ kind: "sdp", description: answer as { type: "answer"; sdp: string } });
        } else if (msg.kind === "ice") {
          await peer.addIce(new this.rtc.RTCIceCandidate(msg.candidate));
        }
      } catch (err) {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    link.send({ kind: "hello", id: this.guestId, name: this.name });
  }

  private attachCtrl(ctrl: DataChannelLike): void {
    this.ctrl = ctrl;
    this.clock = new DatachannelClock((ping) => {
      if (ctrl.readyState === "open") ctrl.send(encodeFrame(ping));
    });
    ctrl.onopen = () => {
      // Burst a few probes, then settle into a slow keep-fresh cadence.
      let n = 0;
      this.clockTimer = setInterval(() => {
        this.clock?.probe();
        if (++n >= 7 && this.clockTimer) {
          clearInterval(this.clockTimer);
          this.clockTimer = setInterval(() => this.clock?.probe(), 5000);
        }
      }, 80);
    };
    ctrl.onmessage = (e) => {
      const msg = parseFrame<CtrlMsg>(e.data);
      if (!msg) return;
      if (msg.t === "pong") this.clock?.onPong(msg);
      else if (msg.t === "transport") this.events.onTransport?.(msg.transport);
    };
  }

  /** Host-clock estimate (epoch ms), or null until first sync. */
  hostNow(): number | null {
    return this.clock?.isSynced ? this.clock.now() : null;
  }

  stop(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.guest.stopBrowse();
    try {
      this.ctrl?.close();
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.ctrl = null;
    this.clock = null;
  }
}
