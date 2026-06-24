// React hook wrapping a GuestSession for the "Join a phone host" screen.
//
// Browses for nearby phone hosts on mount, lets the UI pick one, runs the
// WebRTC handshake, and surfaces the live transport + the incoming audio
// stream. Symmetric to useHostSession. Remote audio from react-native-webrtc
// plays through the device audio route automatically once the track arrives;
// we keep a reference so it isn't garbage-collected.

import { useCallback, useEffect, useRef, useState } from "react";
import { GuestSession } from "./session";
import type { MediaStreamLike } from "./native";
import type { DiscoveredHost } from "./signaling";
import type { Transport } from "./protocol";
import { isHostModeAvailable, NativeUnavailableError } from "./native";

export interface GuestSessionState {
  available: boolean;
  status: "idle" | "browsing" | "connecting" | "connected" | "error";
  hosts: DiscoveredHost[];
  transport: Transport | null;
  error: string | null;
  connect: (host: DiscoveredHost) => void;
  stop: () => void;
}

const hostKey = (h: DiscoveredHost) => `${h.host}:${h.port}`;

export function useGuestSession(
  guestId: string,
  name: string,
): GuestSessionState {
  const [available] = useState(() => isHostModeAvailable());
  const [status, setStatus] = useState<GuestSessionState["status"]>("idle");
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<GuestSession | null>(null);
  const streamRef = useRef<MediaStreamLike | null>(null); // hold a ref so audio keeps playing
  const stopBrowseRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopBrowseRef.current?.();
    stopBrowseRef.current = null;
    sessionRef.current?.stop();
    sessionRef.current = null;
    streamRef.current = null;
    setStatus("idle");
    setTransport(null);
  }, []);

  const connect = useCallback(
    (host: DiscoveredHost) => {
      const session = sessionRef.current;
      if (!session) return;
      stopBrowseRef.current?.(); // stop scanning once we've picked a host
      stopBrowseRef.current = null;
      setError(null);
      setStatus("connecting");
      session
        .connect(host.host, host.port)
        .then(() => setStatus("connected"))
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        });
    },
    [],
  );

  // Build the session + start browsing on mount (when the build supports it).
  useEffect(() => {
    if (!available) {
      setError(new NativeUnavailableError("react-native-webrtc").message);
      setStatus("error");
      return;
    }
    let session: GuestSession;
    try {
      session = new GuestSession(guestId, name, {
        onStream: (s) => {
          streamRef.current = s;
        },
        onTransport: setTransport,
        onError: (e) => {
          setError(e.message);
          setStatus("error");
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    }
    sessionRef.current = session;
    setStatus("browsing");
    stopBrowseRef.current = session.browse((found) => {
      setHosts((prev) =>
        prev.some((h) => hostKey(h) === hostKey(found)) ? prev : [...prev, found],
      );
    });
    return () => {
      stopBrowseRef.current?.();
      stopBrowseRef.current = null;
      session.stop();
      sessionRef.current = null;
      streamRef.current = null;
    };
  }, [available, guestId, name]);

  return { available, status, hosts, transport, error, connect, stop };
}
