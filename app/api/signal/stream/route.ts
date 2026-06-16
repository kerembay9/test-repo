// Per-peer signaling mailbox. Each peer (host and every speaker) opens this SSE
// stream with its own id while live streaming is active; the server delivers
// WebRTC offer/answer/ice messages addressed to that id here.

import { addSignalSink } from "@/lib/sync/server-store";
import type { SignalMessage } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return new Response("id required", { status: 400 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (msg: SignalMessage) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      };
      cleanup = addSignalSink(id, send);

      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* stream already closed */
        }
      }, 15_000);
    },
    cancel() {
      cleanup();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
