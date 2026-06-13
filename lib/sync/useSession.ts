"use client";

// React hook that wires a device into the session: opens the SSE stream for
// live transport/speaker snapshots and keeps a synchronized server clock.

import { useEffect, useState } from "react";
import { ClockSync } from "./clock";
import type { Snapshot } from "./types";

interface Options {
  role: "controller" | "speaker";
  /** Stable id for this device (speakers only); generated if omitted. */
  id?: string;
  name?: string;
}

interface Session {
  snapshot: Snapshot | null;
  connected: boolean;
  clock: ClockSync;
}

export function useSession({ role, id, name }: Options): Session {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  // One stable ClockSync instance per mounted hook.
  const [clock] = useState(() => new ClockSync());

  useEffect(() => {
    let cancelled = false;

    // Initial clock sync, then a slow periodic re-sync to fight drift.
    void clock.sync();
    const resync = setInterval(() => void clock.sync(3), 30_000);

    const params = new URLSearchParams({ role });
    if (id) params.set("id", id);
    if (name) params.set("name", name);
    const es = new EventSource(`/api/events?${params.toString()}`);

    es.onopen = () => !cancelled && setConnected(true);
    es.onerror = () => !cancelled && setConnected(false);
    es.onmessage = (ev) => {
      if (cancelled) return;
      try {
        setSnapshot(JSON.parse(ev.data) as Snapshot);
      } catch {
        /* ignore malformed frame */
      }
    };

    return () => {
      cancelled = true;
      clearInterval(resync);
      es.close();
    };
  }, [role, id, name, clock]);

  return { snapshot, connected, clock };
}
