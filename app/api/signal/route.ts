// WebRTC signaling relay. Peers POST offer/answer/ice messages addressed to
// another peer id; the message is pushed to that peer's open SSE mailbox
// (see ./stream/route.ts). This is only used while the host streams live audio.

import { routeSignal } from "@/lib/sync/server-store";
import type { SignalMessage, SignalType } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: SignalType[] = ["offer", "answer", "ice"];

export async function POST(req: Request) {
  let body: Partial<SignalMessage>;
  try {
    body = (await req.json()) as Partial<SignalMessage>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { from, to, type, data } = body;
  if (!from || !to || !type || !TYPES.includes(type)) {
    return Response.json({ error: "from, to and valid type required" }, {
      status: 400,
    });
  }

  const delivered = routeSignal({ from, to, type, data });
  return Response.json({ delivered });
}
