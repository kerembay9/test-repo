// One-shot snapshot, handy for initial loads and debugging.

import { getSnapshot } from "@/lib/sync/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(getSnapshot());
}
