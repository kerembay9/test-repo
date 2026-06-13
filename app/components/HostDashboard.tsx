"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { AudioEngine } from "@/lib/sync/audio-engine";
import { sendControl, uploadTrack } from "@/lib/sync/client";
import { useSession } from "@/lib/sync/useSession";
import { positionAt, type TrackInfo } from "@/lib/sync/types";

const BUNDLED_TRACK: TrackInfo = {
  id: "bundled-testsound",
  name: "Test sound",
  url: "/testsound.mp3",
};

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(a.duration || 0);
    a.onerror = () => resolve(0);
    a.src = url;
  });
}

export default function HostDashboard() {
  const { snapshot, connected, clock } = useSession({ role: "controller" });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [duration, setDuration] = useState(0);
  const [displayPos, setDisplayPos] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // The host machine also plays the audio, so it's the main stereo pair.
  const [hostAudioOn, setHostAudioOn] = useState(false);
  const [hostVolume, setHostVolume] = useState(1);
  const engineRef = useRef<AudioEngine | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const transport = snapshot?.transport;
  const track = transport?.track ?? null;
  const isPlaying = transport?.isPlaying ?? false;
  const speakers = snapshot?.speakers ?? [];

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/speaker`);
  }, []);

  // Keep the scrub bar moving while playing.
  useEffect(() => {
    const i = setInterval(() => {
      if (transport && scrubbing === null) {
        setDisplayPos(positionAt(transport, clock.now()));
      }
    }, 250);
    return () => clearInterval(i);
  }, [transport, scrubbing, clock]);

  // Track duration for the scrub bar whenever the track changes.
  useEffect(() => {
    if (!track) {
      setDuration(0);
      return;
    }
    let cancelled = false;
    void readDuration(track.url).then((d) => !cancelled && setDuration(d));
    return () => {
      cancelled = true;
    };
    // Only the track URL matters here; re-reading on other `track` fields is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.url]);

  // Host playback engine: load on track change, reconcile on a loop.
  useEffect(() => {
    if (!hostAudioOn || !track) return;
    const engine = engineRef.current;
    if (!engine || loadedUrlRef.current === track.url) return;
    void engine
      .loadTrack(track.url)
      .then(() => {
        loadedUrlRef.current = track.url;
      })
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "host load failed"),
      );
    // Reload only when host audio toggles or the track URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostAudioOn, track?.url]);

  useEffect(() => {
    if (!hostAudioOn) return;
    const i = setInterval(() => {
      const engine = engineRef.current;
      const snap = snapshotRef.current;
      if (engine && snap && clock.isSynced && loadedUrlRef.current) {
        engine.apply(snap.transport, clock);
      }
    }, 200);
    return () => clearInterval(i);
  }, [hostAudioOn, clock]);

  useEffect(() => {
    const engine = engineRef.current;
    if (hostAudioOn && engine && snapshot && clock.isSynced && loadedUrlRef.current) {
      engine.apply(snapshot.transport, clock);
    }
  }, [snapshot, hostAudioOn, clock]);

  useEffect(() => engineRef.current?.setVolume(hostVolume), [hostVolume]);
  useEffect(() => () => engineRef.current?.destroy(), []);

  const enableHostAudio = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new AudioEngine();
    await engineRef.current.unlock();
    engineRef.current.setVolume(hostVolume);
    setHostAudioOn(true);
  }, [hostVolume]);

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);

  const chooseTrack = (t: TrackInfo) =>
    guard(async () => {
      loadedUrlRef.current = null;
      await sendControl({ action: "setTrack", track: t });
    });

  const onUpload = (file: File) =>
    guard(async () => {
      const t = await uploadTrack(file);
      loadedUrlRef.current = null;
      await sendControl({ action: "setTrack", track: t });
    });

  const onUrl = () => {
    if (!urlInput.trim()) return;
    const name = urlInput.split("/").pop() || "Remote track";
    void chooseTrack({ id: urlInput, name, url: urlInput.trim() });
  };

  const play = () =>
    guard(async () => {
      // Pressing Play is the user gesture browsers require to start audio, so
      // make the host itself a speaker here if it isn't already on.
      if (hostAudioOn) await engineRef.current?.unlock();
      else await enableHostAudio();
      await sendControl({ action: "play" });
    });
  const pause = () => guard(() => sendControl({ action: "pause" }));
  const stop = () => guard(() => sendControl({ action: "stop" }));
  const seek = (pos: number) => guard(() => sendControl({ action: "seek", positionSec: pos }));

  const copyJoin = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is shown anyway */
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Surround Host</h1>
        <p className="text-sm text-muted-foreground">
          Play a track here and turn every nearby phone into a synchronized
          satellite speaker.{" "}
          <span className={connected ? "text-foreground" : "text-destructive"}>
            {connected ? "● live" : "○ connecting…"}
          </span>
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Choose a track</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => chooseTrack(BUNDLED_TRACK)}>
              Use bundled test sound
            </Button>
            <label>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" disabled={busy} asChild>
                <span>Upload a song…</span>
              </Button>
            </label>
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="…or paste an audio URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onUrl()}
            />
            <Button variant="outline" disabled={busy || !urlInput.trim()} onClick={onUrl}>
              Load
            </Button>
          </div>
          {track && (
            <p className="text-sm text-muted-foreground">
              Loaded: <span className="text-foreground font-medium">{track.name}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Playback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {isPlaying ? (
              <Button onClick={pause} disabled={busy || !track}>
                Pause
              </Button>
            ) : (
              <Button onClick={play} disabled={busy || !track}>
                Play
              </Button>
            )}
            <Button variant="outline" onClick={stop} disabled={busy || !track}>
              Stop
            </Button>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {fmt(scrubbing ?? displayPos)} / {fmt(duration)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            disabled={!track || !duration}
            value={scrubbing ?? Math.min(displayPos, duration || 0)}
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onMouseUp={() => {
              if (scrubbing !== null) {
                const p = scrubbing;
                setScrubbing(null);
                void seek(p);
              }
            }}
            onTouchEnd={() => {
              if (scrubbing !== null) {
                const p = scrubbing;
                setScrubbing(null);
                void seek(p);
              }
            }}
            className="w-full"
          />

          <div className="rounded-md border p-3 space-y-2">
            {hostAudioOn ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">This computer is playing audio</span>
                  <span className="text-muted-foreground">{Math.round(hostVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={hostVolume}
                  onChange={(e) => setHostVolume(Number(e.target.value))}
                  className="w-full"
                />
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Play sound from this computer too (main stereo pair)
                </span>
                <Button size="sm" variant="secondary" onClick={() => void enableHostAudio()}>
                  Enable
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3 · Add speakers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            On each phone (same Wi-Fi), open this address in a browser and tap
            <span className="text-foreground font-medium"> Join</span>:
          </p>
          <div className="flex gap-2">
            <code className="flex-1 rounded-md border bg-muted/40 px-3 py-2 text-sm break-all">
              {joinUrl || "…"}
            </code>
            <Button variant="outline" onClick={() => void copyJoin()}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">
              Connected speakers ({speakers.length})
            </p>
            {speakers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No phones joined yet.</p>
            ) : (
              <ul className="space-y-1">
                {speakers.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 text-sm rounded-md border px-3 py-2"
                  >
                    <span className="size-2 rounded-full bg-green-500" />
                    {s.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
