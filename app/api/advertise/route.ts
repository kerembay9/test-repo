// Starts (or refreshes) the mDNS advertisement for this host. The host page
// posts the port it's served on, since `next dev` may pick a dynamic one.

import { advertise, mdnsStatus } from "@/lib/sync/mdns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let port: number;
  let force = false;
  try {
    ({ port, force = false } = (await req.json()) as { port: number; force?: boolean });
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return Response.json({ error: "valid port required" }, { status: 400 });
  }
  try {
    advertise(p, force);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "advertise failed" },
      { status: 500 },
    );
  }
  return Response.json(mdnsStatus());
}

export function GET() {
  return Response.json(mdnsStatus());
}
