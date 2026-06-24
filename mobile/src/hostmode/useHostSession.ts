// React hook wrapping a HostSession for the "Host on this phone" screen.
//
// Owns the session lifecycle (capture + advertise on mount, tear down on
// unmount) and surfaces the bits the UI renders: availability, the connected
// peer list, play/pause, and any error. Guest-side state lives in the embedded
// speaker UI in a later iteration; this hook is host-only.

import { useCallback, useEffect, useRef, useState } from "react";
import { HostSession, type HostPeerInfo } from "./session";
import { isHostModeAvailable, NativeUnavailableError } from "./native";

export interface HostSessionState {
  /** false in Expo Go / any build without the native modules. */
  available: boolean;
  status: "idle" | "starting" | "live" | "error";
  peers: HostPeerInfo[];
  isPlaying: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  play: () => void;
  pause: () => void;
}

export function useHostSession(
  hostId: string,
  hostName: string,
): HostSessionState {
  const [available] = useState(() => isHostModeAvailable());
  const [status, setStatus] = useState<HostSessionState["status"]>("idle");
  const [peers, setPeers] = useState<HostPeerInfo[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<HostSession | null>(null);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("idle");
    setPeers([]);
    setIsPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current) return;
    if (!available) {
      setError(new NativeUnavailableError("react-native-webrtc").message);
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("starting");
    try {
      const session = new HostSession(hostId, hostName, {
        onPeers: setPeers,
        onError: (e) => {
          setError(e.message);
          setStatus("error");
        },
      });
      sessionRef.current = session;
      session
        .start()
        .then(() => setStatus("live"))
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
          sessionRef.current = null;
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [available, hostId, hostName]);

  const play = useCallback(() => {
    sessionRef.current?.play();
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    sessionRef.current?.pause();
    setIsPlaying(false);
  }, []);

  // Tear down on unmount so the mic + sockets are always released.
  useEffect(() => () => stop(), [stop]);

  return { available, status, peers, isPlaying, error, start, stop, play, pause };
}
