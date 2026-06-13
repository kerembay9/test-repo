// Small client helpers for talking to the control + upload endpoints.

import type { Snapshot, TrackInfo } from "./types";

interface ControlArgs {
  action: "setTrack" | "play" | "pause" | "seek" | "stop" | "heartbeat";
  track?: TrackInfo;
  positionSec?: number;
  speakerId?: string;
  speakerName?: string;
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
