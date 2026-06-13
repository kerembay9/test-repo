// Advertises the host on the local network via mDNS/Bonjour as
// `_surround._tcp`, so the mobile app can discover it without typing an IP.
// Process-local singleton stashed on globalThis to survive hot-reloads. The
// browser tells us the actual port (dev picks one dynamically) via /api/advertise.

import { Bonjour, type Service } from "bonjour-service";
import { hostname } from "node:os";

interface MdnsState {
  bonjour: Bonjour | null;
  service: Service | null;
  port: number | null;
}

const g = globalThis as unknown as { __surroundMdns?: MdnsState };
const state: MdnsState =
  g.__surroundMdns ?? (g.__surroundMdns = { bonjour: null, service: null, port: null });

export function advertise(port: number): void {
  if (state.port === port && state.service) return; // already advertising this
  stopAdvertising();
  const name = `Surround on ${hostname().replace(/\.local$/, "")}`;
  state.bonjour = new Bonjour();
  state.service = state.bonjour.publish({
    name,
    type: "surround",
    protocol: "tcp",
    port,
    txt: { path: "/speaker", app: "surround" },
  });
  state.port = port;
}

export function stopAdvertising(): void {
  try {
    state.service?.stop?.();
  } catch {
    /* ignore */
  }
  try {
    state.bonjour?.unpublishAll?.();
    state.bonjour?.destroy?.();
  } catch {
    /* ignore */
  }
  state.service = null;
  state.bonjour = null;
  state.port = null;
}

export function mdnsStatus(): { advertising: boolean; port: number | null } {
  return { advertising: !!state.service, port: state.port };
}
