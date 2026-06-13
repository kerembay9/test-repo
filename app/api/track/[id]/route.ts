// Serves an uploaded track's bytes back to the speakers for local decode.

import { getTrack } from "@/lib/sync/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const track = getTrack(id);
  if (!track) {
    return new Response("Not found", { status: 404 });
  }

  // Copy into a fresh ArrayBuffer so the typed-array view matches BodyInit.
  const body = new Uint8Array(track.data);
  return new Response(body, {
    headers: {
      "Content-Type": track.contentType,
      "Content-Length": String(track.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
