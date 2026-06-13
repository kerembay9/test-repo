// In-memory session store for the sync server.
//
// This is intentionally process-local state. The intended deployment is a
// single Node process running on the "host" machine (e.g. the Mac) that all
// devices on the same Wi-Fi connect to, so a shared in-memory store is exactly
// right and keeps the whole app dependency-free. It is stashed on globalThis so
// it survives Next.js hot-reloads in development.

import type { SignalMessage, Snapshot, Speaker, Transport } from "./types";

type Subscriber = (snap: Snapshot) => void;
type SignalSink = (msg: SignalMessage) => void;

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
  /** WebRTC signaling mailboxes, keyed by peer id. */
  signalSinks: Map<string, SignalSink>;
  /** Messages addressed to a peer whose mailbox isn't open yet. */
  signalQueue: Map<string, SignalMessage[]>;
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
      live: false,
      hostId: null,
    },
    speakers: new Map(),
    tracks: new Map(),
    subscribers: new Set(),
    signalSinks: new Map(),
    signalQueue: new Map(),
    version: 0,
  };
}

const g = globalThis as unknown as { __surroundStore?: Store };
const store: Store = g.__surroundStore ?? (g.__surroundStore = createStore());

// Retrofit fields onto a store that was created (and cached on globalThis) by an
// older build before a hot-reload, so newly added state isn't left undefined.
store.signalSinks ??= new Map();
store.signalQueue ??= new Map();
store.transport.live ??= false;
store.transport.hostId ??= null;

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

export function touchSpeaker(
  id: string,
  name?: string,
  latencyMs?: number,
): void {
  const s = store.speakers.get(id);
  if (s) {
    s.lastSeen = Date.now();
    s.connected = true;
    if (name) s.name = name;
    if (typeof latencyMs === "number") s.latencyMs = latencyMs;
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

// --- WebRTC signaling relay -------------------------------------------------

const SIGNAL_QUEUE_MAX = 64;

export function addSignalSink(id: string, sink: SignalSink): () => void {
  store.signalSinks.set(id, sink);
  // Flush anything that arrived before this mailbox opened (connection-setup
  // race: an offer/answer can be relayed before the peer's stream connects).
  const queued = store.signalQueue.get(id);
  if (queued) {
    store.signalQueue.delete(id);
    for (const msg of queued) {
      try {
        sink(msg);
      } catch {
        /* drop */
      }
    }
  }
  return () => {
    // Only remove if it's still the same sink (avoid clobbering a reconnect).
    if (store.signalSinks.get(id) === sink) store.signalSinks.delete(id);
  };
}

/** Deliver a signaling message, queueing briefly if the peer isn't connected. */
export function routeSignal(msg: SignalMessage): boolean {
  const sink = store.signalSinks.get(msg.to);
  if (sink) {
    try {
      sink(msg);
      return true;
    } catch {
      /* fall through to queue */
    }
  }
  const q = store.signalQueue.get(msg.to) ?? [];
  q.push(msg);
  // Bound the backlog so a peer that never connects can't grow memory forever.
  while (q.length > SIGNAL_QUEUE_MAX) q.shift();
  store.signalQueue.set(msg.to, q);
  return false;
}
