// Small client helpers for talking to the control + upload endpoints.

import type { SignalMessage, Snapshot, TrackInfo } from "./types";

interface ControlArgs {
  action:
    | "setTrack"
    | "play"
    | "pause"
    | "seek"
    | "stop"
    | "heartbeat"
    | "goLive"
    | "endLive";
  track?: TrackInfo;
  positionSec?: number;
  speakerId?: string;
  speakerName?: string;
  hostId?: string;
}

export async function sendControl(args: ControlArgs): Promise<Snapshot> {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(error ?? `control failed (${res.status})`);
  }
  return (await res.json()) as Snapshot;
}

/** Fire-and-forget a WebRTC signaling message to another peer. */
export async function sendSignal(msg: SignalMessage): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  }).catch(() => {
    /* signaling is best-effort; ICE will retry via renegotiation if needed */
  });
}

export async function uploadTrack(file: File): Promise<TrackInfo> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(error ?? `upload failed (${res.status})`);
  }
  return (await res.json()) as TrackInfo;
}
