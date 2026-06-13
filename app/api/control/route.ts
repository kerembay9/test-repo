// Transport control endpoint used by the host UI. Mutations to playback state
// happen here and are then pushed to all devices over SSE. Position is always
// re-anchored to the server clock, with a small lead time so every speaker has
// a chance to schedule the start at the same wall-clock instant.

import {
  broadcast,
  getSnapshot,
  getTransport,
  setTransport,
  touchSpeaker,
} from "@/lib/sync/server-store";
import { positionAt, type TrackInfo } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Scheduling lead: how far in the future a (re)start is anchored. */
const LEAD_MS = 600;

interface ControlBody {
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
  latencyMs?: number;
}

export async function POST(req: Request) {
  let body: ControlBody;
  try {
    body = (await req.json()) as ControlBody;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const now = Date.now();
  const t = getTransport();

  switch (body.action) {
    case "setTrack": {
      if (!body.track) {
        return Response.json({ error: "track required" }, { status: 400 });
      }
      setTransport({
        track: body.track,
        isPlaying: false,
        positionSec: 0,
        anchorServerTime: now,
      });
      break;
    }
    case "play": {
      if (!t.track) {
        return Response.json({ error: "no track loaded" }, { status: 409 });
      }
      const resumeAt = body.positionSec ?? positionAt(t, now);
      setTransport({
        isPlaying: true,
        positionSec: resumeAt,
        anchorServerTime: now + LEAD_MS,
      });
      break;
    }
    case "pause": {
      setTransport({
        isPlaying: false,
        positionSec: positionAt(t, now),
        anchorServerTime: now,
      });
      break;
    }
    case "seek": {
      const pos = Math.max(0, body.positionSec ?? 0);
      setTransport({
        positionSec: pos,
        anchorServerTime: t.isPlaying ? now + LEAD_MS : now,
      });
      break;
    }
    case "stop": {
      setTransport({ isPlaying: false, positionSec: 0, anchorServerTime: now });
      break;
    }
    case "goLive": {
      if (!body.hostId) {
        return Response.json({ error: "hostId required" }, { status: 400 });
      }
      // Live capture replaces file playback; stop the file transport so
      // speakers don't try to play both at once.
      setTransport({
        live: true,
        hostId: body.hostId,
        isPlaying: false,
        anchorServerTime: now,
      });
      break;
    }
    case "endLive": {
      setTransport({ live: false, hostId: null, anchorServerTime: now });
      break;
    }
    case "heartbeat": {
      if (body.speakerId) {
        touchSpeaker(body.speakerId, body.speakerName, body.latencyMs);
      }
      // Heartbeats don't bump the transport version, but a fresh latency report
      // should reach the host, so push it out when one is included.
      if (typeof body.latencyMs === "number") broadcast();
      return Response.json(getSnapshot());
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }

  broadcast();
  return Response.json(getSnapshot());
}
