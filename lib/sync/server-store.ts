// In-memory session store for the sync server.
//
// This is intentionally process-local state. The intended deployment is a
// single Node process running on the "host" machine (e.g. the Mac) that all
// devices on the same Wi-Fi connect to, so a shared in-memory store is exactly
// right and keeps the whole app dependency-free. It is stashed on globalThis so
// it survives Next.js hot-reloads in development.

import type { Snapshot, Speaker, Transport } from "./types";

type Subscriber = (snap: Snapshot) => void;

interface StoredTrack {
  name: string;
  contentType: string;
  data: Buffer;
}

interface Store {
  transport: Transport;
  speakers: Map<string, Speaker>;
  tracks: Map<string, StoredTrack>;
  subscribers: Set<Subscriber>;
  version: number;
}

const STALE_MS = 20_000;

function createStore(): Store {
  return {
    transport: {
      version: 0,
      track: null,
      isPlaying: false,
      positionSec: 0,
      anchorServerTime: Date.now(),
    },
    speakers: new Map(),
    tracks: new Map(),
    subscribers: new Set(),
    version: 0,
  };
}

const g = globalThis as unknown as { __surroundStore?: Store };
const store: Store = g.__surroundStore ?? (g.__surroundStore = createStore());

export function getSnapshot(): Snapshot {
  pruneStale();
  return {
    transport: store.transport,
    speakers: [...store.speakers.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    serverTime: Date.now(),
  };
}

export function broadcast(): void {
  const snap = getSnapshot();
  for (const sub of store.subscribers) {
    try {
      sub(snap);
    } catch {
      // A failed subscriber will be cleaned up on its own stream cancel.
    }
  }
}

export function addSubscriber(sub: Subscriber): () => void {
  store.subscribers.add(sub);
  return () => store.subscribers.delete(sub);
}

export function setTransport(next: Partial<Transport>): Transport {
  store.transport = {
    ...store.transport,
    ...next,
    version: ++store.version,
  };
  return store.transport;
}

export function getTransport(): Transport {
  return store.transport;
}

export function registerSpeaker(id: string, name: string): void {
  store.speakers.set(id, { id, name, connected: true, lastSeen: Date.now() });
}

export function touchSpeaker(id: string, name?: string): void {
  const s = store.speakers.get(id);
  if (s) {
    s.lastSeen = Date.now();
    s.connected = true;
    if (name) s.name = name;
  } else if (name) {
    registerSpeaker(id, name);
  }
}

export function removeSpeaker(id: string): void {
  store.speakers.delete(id);
}

function pruneStale(): void {
  const cutoff = Date.now() - STALE_MS;
  for (const [id, s] of store.speakers) {
    if (s.lastSeen < cutoff) store.speakers.delete(id);
  }
}

export function addTrack(track: StoredTrack): string {
  const id = crypto.randomUUID();
  store.tracks.set(id, track);
  // Keep memory bounded: hold at most the few most-recent uploads.
  if (store.tracks.size > 8) {
    const oldest = store.tracks.keys().next().value;
    if (oldest) store.tracks.delete(oldest);
  }
  return id;
}

export function getTrack(id: string): StoredTrack | undefined {
  return store.tracks.get(id);
}
