// Accepts an audio file from the host and keeps it in memory so every speaker
// can download and decode the exact same bytes. Returns a TrackInfo the host
// can then broadcast via /api/control setTrack.

import { addTrack } from "@/lib/sync/server-store";
import type { TrackInfo } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB is plenty for a single song

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "file field required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "file too large" }, { status: 413 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const id = addTrack({
    name: file.name || "Uploaded track",
    contentType: file.type || "audio/mpeg",
    data,
  });

  const track: TrackInfo = {
    id,
    name: file.name || "Uploaded track",
    url: `/api/track/${id}`,
  };
  return Response.json(track);
}
