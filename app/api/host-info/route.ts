// Reports the host machine's LAN IPv4 addresses so the host UI can build a
// join URL phones can actually reach. The page itself is opened on localhost
// (a secure context, needed for audio capture), so it can't infer the LAN IP
// from the browser — the server reads it from the OS instead.

import { networkInterfaces } from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const addresses: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      // IPv4, not loopback, not link-local (169.254.x).
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254")) {
        addresses.push(net.address);
      }
    }
  }
  // Prefer common private LAN ranges first (192.168/10.x), then anything else.
  addresses.sort((a, b) => rank(a) - rank(b));
  return Response.json({ addresses });
}

function rank(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (ip.startsWith("172.")) return 2;
  return 3;
}
