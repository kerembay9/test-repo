// WebRTC plumbing for live audio streaming, host -> each speaker.
//
// The host is always the offerer and adds the captured audio track sendonly;
// speakers answer and surface the incoming MediaStream. Signaling (offer/answer/
// ice) is relayed through /api/signal via the `send` callback. On a shared LAN,
// host-reflexive/local candidates connect directly; STUN is only a fallback.

import type { SignalMessage, SignalType } from "./types";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export type SignalSend = (
  to: string,
  type: SignalType,
  data: unknown,
) => void;

/** Buffer ICE candidates that arrive before the remote description is set. */
class Peer {
  readonly pc: RTCPeerConnection;
  private remoteReady = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
  }

  async setRemote(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(desc);
    this.remoteReady = true;
    for (const c of this.pendingIce.splice(0)) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  async addIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteReady) {
      this.pendingIce.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate).catch(() => {});
  }

  close(): void {
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}

/** Host side: streams one captured MediaStream to every connected speaker. */
export class HostBroadcaster {
  private peers = new Map<string, Peer>();

  constructor(
    private stream: MediaStream,
    private send: SignalSend,
  ) {}

  private async addSpeaker(id: string): Promise<void> {
    if (this.peers.has(id)) return;
    const peer = new Peer();
    this.peers.set(id, peer);
    const { pc } = peer;

    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(id, "ice", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.removeSpeaker(id);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send(id, "offer", offer);
  }

  private removeSpeaker(id: string): void {
    this.peers.get(id)?.close();
    this.peers.delete(id);
  }

  /** Reconcile peer connections with the current set of speaker ids. */
  syncSpeakers(ids: string[]): void {
    for (const id of ids) {
      if (!this.peers.has(id)) void this.addSpeaker(id);
    }
    for (const id of [...this.peers.keys()]) {
      if (!ids.includes(id)) this.removeSpeaker(id);
    }
  }

  async onSignal(msg: SignalMessage): Promise<void> {
    const peer = this.peers.get(msg.from);
    if (!peer) return;
    if (msg.type === "answer") {
      await peer.setRemote(msg.data as RTCSessionDescriptionInit);
    } else if (msg.type === "ice") {
      await peer.addIce(msg.data as RTCIceCandidateInit);
    }
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) this.removeSpeaker(id);
  }
}

/** Speaker side: answers the host's offer and surfaces the incoming stream. */
export class SpeakerReceiver {
  private peer: Peer | null = null;

  constructor(
    private hostId: string,
    private send: SignalSend,
    private onStream: (stream: MediaStream) => void,
  ) {}

  private ensure(): Peer {
    if (this.peer) return this.peer;
    const peer = new Peer();
    const { pc } = peer;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(this.hostId, "ice", e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      this.onStream(e.streams[0] ?? new MediaStream([e.track]));
    };
    this.peer = peer;
    return peer;
  }

  async onSignal(msg: SignalMessage): Promise<void> {
    if (msg.from !== this.hostId) return;
    const peer = this.ensure();
    if (msg.type === "offer") {
      await peer.setRemote(msg.data as RTCSessionDescriptionInit);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.send(this.hostId, "answer", answer);
    } else if (msg.type === "ice") {
      await peer.addIce(msg.data as RTCIceCandidateInit);
    }
  }

  stop(): void {
    this.peer?.close();
    this.peer = null;
  }
}
