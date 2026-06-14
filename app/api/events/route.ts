// Server-Sent Events stream. Every connected device (host controller and
// speakers) opens this to receive transport + speaker-list snapshots in real
// time. Speakers identify themselves via query params so the host can show who
// is in the room; presence is tied to the lifetime of this connection.

import {
  addSubscriber,
  broadcast,
  getSnapshot,
  hasSpeaker,
  registerSpeaker,
  removeSpeaker,
  speakerCount,
} from "@/lib/sync/server-store";
import { licenseStatus } from "@/lib/sync/license";
import type { Snapshot } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role") ?? "controller";
  const id = searchParams.get("id") ?? crypto.randomUUID();
  const name = searchParams.get("name") ?? "Speaker";
  const isSpeaker = role === "speaker";

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let registered = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (snap: Snapshot) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`));
      };

      if (isSpeaker) {
        // Freemium cap: free hosts allow up to `freeLimit` speakers. Turn away
        // any new phone beyond that until the host activates a license.
        const { licensed, freeLimit } = licenseStatus();
        if (!licensed && !hasSpeaker(id) && speakerCount() >= freeLimit) {
          send({ ...getSnapshot(), rejected: "limit" });
          controller.close();
          return;
        }
        registerSpeaker(id, name);
        registered = true;
        broadcast(); // tell everyone a new speaker joined
      }

      unsubscribe = addSubscriber(send);
      send(getSnapshot()); // prime the new connection immediately

      // Comment pings keep intermediaries from closing an idle connection.
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* stream already closed */
        }
      }, 15_000);
    },
    cancel() {
      unsubscribe();
      if (ping) clearInterval(ping);
      if (registered) {
        removeSpeaker(id);
        broadcast();
      }
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
