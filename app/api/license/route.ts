// License status + activation for the desktop host. GET reports the current
// plan; POST activates a key (verifies the signature, persists it). Browser-
// only (web) hosts have no license path and stay on the free tier.

import { licenseStatus, saveLicense } from "@/lib/sync/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(licenseStatus());
}

export async function POST(req: Request) {
  let key = "";
  try {
    ({ key } = (await req.json()) as { key: string });
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const r = saveLicense(String(key ?? ""));
  if (!r.ok) {
    return Response.json({ error: r.error ?? "Invalid license key." }, { status: 400 });
  }
  return Response.json(licenseStatus());
}
