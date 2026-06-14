"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { AudioEngine, type EngineStatus } from "@/lib/sync/audio-engine";
import { sendControl } from "@/lib/sync/client";
import { randomId } from "@/lib/sync/id";
import { useSession } from "@/lib/sync/useSession";
import { useSignaling } from "@/lib/sync/useSignaling";
import { SpeakerReceiver } from "@/lib/sync/webrtc";
import type { ChannelRole, SignalMessage } from "@/lib/sync/types";

const ROLES: { value: ChannelRole; label: string; hint: string }[] = [
  { value: "stereo", label: "Stereo", hint: "Full left + right" },
  { value: "left", label: "Left", hint: "Left channel only" },
  { value: "right", label: "Right", hint: "Right channel only" },
  { value: "mono", label: "Mono", hint: "Both channels summed" },
];

function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("surround.deviceId");
  if (!id) {
    id = randomId();
    localStorage.setItem("surround.deviceId", id);
  }
  return id;
}

function defaultName(): string {
  if (typeof window === "undefined") return "Speaker";
  return localStorage.getItem("surround.name") ?? "My phone";
}

export default function SpeakerPage() {
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("Speaker");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState<ChannelRole>("stereo");
  const [volume, setVolume] = useState(1);
  const [trimMs, setTrimMs] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [trackErr, setTrackErr] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);

  useEffect(() => {
    // localStorage is only available after mount (client-only); seeding the
    // device identity here is the intended pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceId(getDeviceId());
    setName(defaultName());
  }, []);

  const { snapshot, connected, clock } = useSession({
    role: "speaker",
    id: deviceId || undefined,
    name,
  });

  const engineRef = useRef<AudioEngine | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  // Live (WebRTC) streaming from the host.
  const live = snapshot?.transport.live ?? false;
  const hostId = snapshot?.transport.hostId ?? null;
  const receiverRef = useRef<SpeakerReceiver | null>(null);
  const onSignal = useCallback((msg: SignalMessage) => {
    void receiverRef.current?.onSignal(msg);
  }, []);
  const { send: sendSignal } = useSignaling(
    deviceId || null,
    joined && live,
    onSignal,
  );

  // Join requires a user gesture so the browser lets us produce audio.
  const join = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new AudioEngine();
    await engineRef.current.unlock();
    engineRef.current.setRole(role);
    engineRef.current.setVolume(volume);
    engineRef.current.setTrimMs(trimMs);
    setJoined(true);
  }, [role, volume, trimMs]);

  // Push local control changes into the engine.
  useEffect(() => engineRef.current?.setRole(role), [role]);
  useEffect(() => engineRef.current?.setVolume(volume), [volume]);
  useEffect(() => engineRef.current?.setTrimMs(trimMs), [trimMs]);

  // Load the track whenever the host selects a new one.
  useEffect(() => {
    const track = snapshot?.transport.track;
    const engine = engineRef.current;
    if (!joined || !engine || !track) return;
    if (loadedUrlRef.current === track.url) return;

    let cancelled = false;
    // Show the downloading indicator before kicking off the async decode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingTrack(true);
    setTrackErr(null);
    engine
      .loadTrack(track.url)
      .then(() => {
        if (cancelled) return;
        loadedUrlRef.current = track.url;
      })
      .catch((e: unknown) => {
        if (!cancelled) setTrackErr(e instanceof Error ? e.message : "load failed");
      })
      .finally(() => !cancelled && setLoadingTrack(false));

    return () => {
      cancelled = true;
    };
  }, [joined, snapshot?.transport.track]);

  // Reconciliation + drift-correction loop, plus presence heartbeat.
  useEffect(() => {
    if (!joined) return;
    const tick = setInterval(() => {
      const engine = engineRef.current;
      const snap = snapshotRef.current;
      // File reconciliation only; live streaming drives the engine separately.
      if (
        engine &&
        snap &&
        !snap.transport.live &&
        clock.isSynced &&
        loadedUrlRef.current
      ) {
        engine.apply(snap.transport, clock);
        setStatus(engine.status());
      }
    }, 200);

    const hb = setInterval(() => {
      if (!deviceId) return;
      void (async () => {
        let latencyMs: number | undefined;
        const recv = receiverRef.current;
        const engine = engineRef.current;
        if (recv && engine) {
          const net = await recv.measureLatencyMs();
          if (net != null) latencyMs = Math.round(net + engine.outputLatencyMs());
        }
        await sendControl({
          action: "heartbeat",
          speakerId: deviceId,
          speakerName: name,
          latencyMs,
        });
      })();
    }, 4000);

    return () => {
      clearInterval(tick);
      clearInterval(hb);
    };
  }, [joined, clock, deviceId, name]);

  // Apply immediately on each new snapshot too (don't wait for the next tick).
  useEffect(() => {
    const engine = engineRef.current;
    if (
      joined &&
      engine &&
      snapshot &&
      !snapshot.transport.live &&
      clock.isSynced &&
      loadedUrlRef.current
    ) {
      engine.apply(snapshot.transport, clock);
    }
  }, [snapshot, joined, clock]);

  // Live mode: receive the host's WebRTC stream and route it through the engine.
  useEffect(() => {
    const engine = engineRef.current;
    if (!joined || !live || !hostId || !deviceId || !engine) {
      receiverRef.current?.stop();
      receiverRef.current = null;
      engine?.detachStream();
      return;
    }
    const recv = new SpeakerReceiver(hostId, sendSignal, (stream) =>
      engine.attachStream(stream),
    );
    receiverRef.current = recv;
    return () => {
      recv.stop();
      receiverRef.current = null;
      engine.detachStream();
    };
  }, [joined, live, hostId, deviceId, sendSignal]);

  useEffect(() => {
    return () => engineRef.current?.destroy();
  }, []);

  const track = snapshot?.transport.track;
  const isPlaying = snapshot?.transport.isPlaying ?? false;

  if (!joined) {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-6 p-6">
        <div className="text-center space-y-2">
          <div className="flex items-baseline justify-center gap-2">
            <span className="wordmark-strong text-2xl text-foreground">SURROUND</span>
            <span className="wordmark-thin text-base text-primary">SPEAKER</span>
          </div>
          <h1 className="text-lg font-semibold pt-2">Join as a speaker</h1>
          <p className="text-muted-foreground max-w-sm">
            Tap below to add this device to the surround system. Your browser
            needs a tap before it can play audio.
          </p>
        </div>
        <label className="w-full max-w-xs text-sm">
          <span className="text-muted-foreground">This device&apos;s name</span>
          <input
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              localStorage.setItem("surround.name", e.target.value);
            }}
            placeholder="e.g. Kitchen phone"
          />
        </label>
        <Button size="lg" className="text-lg px-10 py-6" onClick={() => void join()}>
          Tap to join
        </Button>
        <span className="text-xs text-muted-foreground">
          {connected ? "Connected to host" : "Connecting…"}
        </span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-5 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">{name}</h1>
        <p className="text-sm text-muted-foreground">
          {live ? (
            <>🔴 Live from host</>
          ) : track ? (
            <>
              {isPlaying ? "▶ Playing" : "⏸ Paused"} · {track.name}
            </>
          ) : (
            "Waiting for the host to choose a track…"
          )}
        </p>
        {loadingTrack && <p className="text-xs text-muted-foreground">Downloading track…</p>}
        {trackErr && <p className="text-xs text-destructive">Error: {trackErr}</p>}
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Channel role</h2>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <Button
              key={r.value}
              variant={role === r.value ? "default" : "outline"}
              className="h-auto flex-col items-start py-2"
              onClick={() => setRole(r.value)}
            >
              <span className="font-medium">{r.label}</span>
              <span className="text-xs opacity-70 font-normal">{r.hint}</span>
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-sm font-semibold text-muted-foreground flex justify-between">
          <span>Volume</span>
          <span>{Math.round(volume * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full"
        />
      </section>

      <section className="space-y-2">
        <label className="text-sm font-semibold text-muted-foreground flex justify-between">
          <span>Delay trim</span>
          <span>{trimMs} ms</span>
        </label>
        <input
          type="range"
          min={0}
          max={300}
          step={5}
          value={trimMs}
          onChange={(e) => setTrimMs(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Add a little delay if this speaker sounds early compared to the others.
        </p>
      </section>

      <section className="rounded-lg border p-3 text-xs space-y-1 text-muted-foreground">
        <div className="flex justify-between">
          <span>Host link</span>
          <span className={connected ? "text-foreground" : "text-destructive"}>
            {connected ? "connected" : "reconnecting…"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Clock sync</span>
          <span>{clock.isSynced ? `±~${Math.round(clock.roundTripMs / 2)} ms` : "syncing…"}</span>
        </div>
        <div className="flex justify-between">
          <span>Drift</span>
          <span>{status ? `${status.driftMs >= 0 ? "+" : ""}${Math.round(status.driftMs)} ms` : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span>Position</span>
          <span>{status ? `${status.positionSec.toFixed(1)} s` : "—"}</span>
        </div>
      </section>
    </main>
  );
}
