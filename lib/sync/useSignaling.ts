"use client";

// Opens this peer's signaling mailbox (an SSE stream) while `active`, and hands
// incoming WebRTC messages to `onMessage`. Returns a `send` helper for posting
// messages to other peers. Kept separate from useSession so the snapshot stream
// is untouched when live streaming isn't in use.

import { useCallback, useEffect, useRef } from "react";
import { sendSignal } from "./client";
import type { SignalMessage } from "./types";

export function useSignaling(
  selfId: string | null,
  active: boolean,
  onMessage: (msg: SignalMessage) => void,
) {
  // Keep the latest handler without resubscribing the stream on every render.
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!active || !selfId) return;
    const es = new EventSource(
      `/api/signal/stream?id=${encodeURIComponent(selfId)}`,
    );
    es.onmessage = (ev) => {
      try {
        handlerRef.current(JSON.parse(ev.data) as SignalMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, [selfId, active]);

  const send = useCallback(
    (to: string, type: SignalMessage["type"], data: unknown) => {
      if (!selfId) return;
      void sendSignal({ from: selfId, to, type, data });
    },
    [selfId],
  );

  return { send };
}
