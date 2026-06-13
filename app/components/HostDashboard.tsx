"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { AudioEngine } from "@/lib/sync/audio-engine";
import { sendControl, uploadTrack } from "@/lib/sync/client";
import { randomId } from "@/lib/sync/id";
import { useSession } from "@/lib/sync/useSession";
import { useSignaling } from "@/lib/sync/useSignaling";
import { HostBroadcaster } from "@/lib/sync/webrtc";
import {
  positionAt,
  type SignalMessage,
  type TrackInfo,
} from "@/lib/sync/types";

const BUNDLED_TRACK: TrackInfo = {
  id: "bundled-testsound",
  name: "Test sound",
  url: "/testsound.mp3",
};

// Outputs that route back into the captured loopback and cause feedback.
function isLoopbackOutput(label: string): boolean {
  return /blackhole|multi-output|aggregate|soundflower|loopback/i.test(label);
}

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
  const speakers = useMemo(() => snapshot?.speakers ?? [], [snapshot?.speakers]);
  const live = transport?.live ?? false;

  // Live audio streaming (Spotify / system audio) over WebRTC.
  const [hostId] = useState(() => randomId());
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState("");
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState("");
  // Monitor the captured audio locally (through the delay node) so the Mac's own
  // output can be delayed to line up with the WebRTC-lagged phones.
  const [monitorOn, setMonitorOn] = useState(false);
  const [hostTrimMs, setHostTrimMs] = useState(0);
  // Label of the input we're actually capturing, so it's obvious whether it's
  // BlackHole or (by mistake) the microphone.
  const [capturedLabel, setCapturedLabel] = useState("");
  // Local intent to stream, so the host's signaling mailbox opens immediately
  // instead of waiting for the `live` flag to round-trip through a snapshot.
  const [streaming, setStreaming] = useState(false);
  const captureRef = useRef<MediaStream | null>(null);
  const broadcasterRef = useRef<HostBroadcaster | null>(null);
  const onSignal = useCallback((msg: SignalMessage) => {
    void broadcasterRef.current?.onSignal(msg);
  }, []);
  const { send: sendSignal } = useSignaling(hostId, live || streaming, onSignal);

  // Device labels (e.g. "BlackHole 2ch") are hidden until the page has been
  // granted audio permission once, so prime it before listing inputs.
  const refreshInputs = useCallback(async () => {
    setErr(null);
    // getUserMedia/enumerateDevices only exist in a secure context. Over plain
    // HTTP on a LAN IP, navigator.mediaDevices is undefined.
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(
        "Audio capture needs a secure context. Open this host page at " +
          "http://localhost:3002 on the Mac itself (not the 192.168.x.x LAN " +
          "address), or serve it over HTTPS.",
      );
      return;
    }
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setErr(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission was blocked — it's needed to list and capture audio inputs. Allow it in the address-bar site settings and retry."
          : "Could not access audio inputs: " +
              (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const found = devs.filter((d) => d.kind === "audioinput");
      setInputs(found);
      setOutputs(devs.filter((d) => d.kind === "audiooutput"));
      if (found.every((d) => !d.label)) {
        setErr("Inputs found but unlabeled — permission may still be pending.");
      }
    } catch (e) {
      setErr("enumerateDevices failed: " + (e instanceof Error ? e.message : ""));
    }
  }, []);

  // Keep WebRTC peers in step with the connected speaker list while live.
  useEffect(() => {
    if (live && broadcasterRef.current) {
      broadcasterRef.current.syncSpeakers(speakers.map((s) => s.id));
    }
  }, [live, speakers]);

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

  const startLive = (mode: "device" | "tab") =>
    guard(async () => {
      let stream: MediaStream;
      if (mode === "tab") {
        // Share a tab/window and tick "share audio". Video is discarded.
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        stream.getVideoTracks().forEach((t) => t.stop());
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: inputId ? { exact: inputId } : undefined,
            // Capture the program audio as-is, not voice.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("That source has no audio track to stream.");
      }
      captureRef.current = stream;
      setCapturedLabel(stream.getAudioTracks()[0]?.label || "unknown input");
      broadcasterRef.current = new HostBroadcaster(stream, sendSignal);
      // Open our signaling mailbox before any answers can come back.
      setStreaming(true);
      await sendControl({ action: "goLive", hostId });
      // Connect to whoever is already in the room.
      broadcasterRef.current.syncSpeakers(
        (snapshotRef.current?.speakers ?? []).map((s) => s.id),
      );
    });

  const stopLive = () =>
    guard(async () => {
      broadcasterRef.current?.stop();
      broadcasterRef.current = null;
      engineRef.current?.detachStream();
      setMonitorOn(false);
      captureRef.current?.getTracks().forEach((t) => t.stop());
      captureRef.current = null;
      setStreaming(false);
      await sendControl({ action: "endLive" });
    });

  // Play the captured stream locally through the delay node so the Mac's own
  // output can be pushed back to match the phones.
  const enableMonitor = () =>
    guard(async () => {
      if (!captureRef.current) throw new Error("Start streaming first.");
      const out = outputs.find((d) => d.deviceId === outputId);
      // Refuse any output that can route back into the captured loopback, or
      // the monitor will feed BlackHole and scream. Require an explicit,
      // physical speaker chosen via setSinkId.
      if (!outputId || !out) {
        throw new Error(
          "Pick your real speakers in 'App output' first (not the default — " +
            "with BlackHole as system output, default loops back).",
        );
      }
      if (isLoopbackOutput(out.label)) {
        throw new Error(
          `"${out.label}" feeds the capture and will feed back. Pick your ` +
            "physical speakers/headphones instead.",
        );
      }
      if (!engineRef.current) engineRef.current = new AudioEngine();
      const engine = engineRef.current;
      await engine.unlock();
      const routed = await engine.setOutputDevice(outputId);
      if (!routed) {
        throw new Error(
          "This browser can't route output to a chosen device (needs Chrome). " +
            "Without it the monitor would feed back, so it's disabled here.",
        );
      }
      engine.setTrimMs(hostTrimMs);
      engine.attachStream(captureRef.current);
      setMonitorOn(true);
    });

  const disableMonitor = () => {
    engineRef.current?.detachStream();
    setMonitorOn(false);
  };

  const setDelayMs = (ms: number) =>
    setHostTrimMs(Math.min(1000, Math.max(0, Math.round(ms || 0))));
  const nudgeDelay = (by: number) => setDelayMs(hostTrimMs + by);

  // Live host-delay slider takes effect immediately.
  useEffect(() => {
    if (monitorOn) engineRef.current?.setTrimMs(hostTrimMs);
  }, [hostTrimMs, monitorOn]);
  // Changing output while monitoring: re-route, but never to a loopback device.
  useEffect(() => {
    if (!monitorOn || !outputId) return;
    const out = outputs.find((d) => d.deviceId === outputId);
    if (out && !isLoopbackOutput(out.label)) {
      void engineRef.current?.setOutputDevice(outputId);
    }
  }, [outputId, monitorOn, outputs]);

  // Tear streaming down if the host page unmounts.
  useEffect(() => {
    return () => {
      broadcasterRef.current?.stop();
      captureRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
          <CardTitle className="text-base">
            2½ · Stream live audio (Spotify / system)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {live ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="text-red-500">●</span> Streaming{" "}
                  <span className="font-medium">{capturedLabel || "audio"}</span>{" "}
                  to {speakers.length} speaker
                  {speakers.length === 1 ? "" : "s"}.
                </span>
                <Button variant="outline" disabled={busy} onClick={() => void stopLive()}>
                  Stop streaming
                </Button>
              </div>
              {/(microphone|default|built-in|macbook.*microphone)/i.test(
                capturedLabel,
              ) && (
                <p className="text-xs text-destructive">
                  That looks like a microphone, not BlackHole — phones will hear
                  the room, not Spotify. Stop, then pick{" "}
                  <span className="font-medium">BlackHole 2ch</span> as the input.
                </p>
              )}

              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Delay this Mac to match phones</p>
                <p className="text-xs text-muted-foreground">
                  Phones lag by WebRTC&apos;s buffer, so this Mac sounds early. To
                  delay it, the app plays the captured audio to your real speakers
                  through a delay. Set the Mac&apos;s system output to{" "}
                  <span className="text-foreground font-medium">BlackHole only</span>{" "}
                  (not the Multi-Output), then pick your real speakers as the app
                  output below so it doesn&apos;t feed back.
                </p>

                {!monitorOn ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-md border bg-background px-2 py-2 text-sm max-w-[14rem]"
                      value={outputId}
                      onFocus={() => void refreshInputs()}
                      onChange={(e) => setOutputId(e.target.value)}
                    >
                      <option value="">App output: system default…</option>
                      {outputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Unlabeled output"}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void enableMonitor()}>
                      Play on this Mac (delayed)
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Delay this Mac</span>
                      <Button size="sm" variant="ghost" onClick={disableMonitor}>
                        Turn off
                      </Button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      step={5}
                      value={hostTrimMs}
                      onChange={(e) => setHostTrimMs(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => nudgeDelay(-25)}>
                        −25
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => nudgeDelay(-5)}>
                        −5
                      </Button>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          step={5}
                          value={hostTrimMs}
                          onChange={(e) => setDelayMs(Number(e.target.value))}
                          className="w-20 rounded-md border bg-background px-2 py-1 text-sm text-right tabular-nums"
                        />
                        <span className="text-sm text-muted-foreground">ms</span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => nudgeDelay(5)}>
                        +5
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => nudgeDelay(25)}>
                        +25
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Play something with a steady beat, then step the delay until
                      this Mac and the phones land on the beat together. Most
                      Wi-Fi setups settle around 150–400 ms.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Send whatever is playing on this Mac (e.g. Spotify) to the
                phones. Pick a loopback input like{" "}
                <span className="text-foreground font-medium">BlackHole</span>{" "}
                (route Spotify into it via a macOS Multi-Output Device), or share
                a browser tab&apos;s audio.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void refreshInputs()}>
                  Scan devices
                </Button>
                <select
                  className="rounded-md border bg-background px-2 py-2 text-sm max-w-[16rem]"
                  value={inputId}
                  onFocus={() => void refreshInputs()}
                  onChange={(e) => setInputId(e.target.value)}
                >
                  <option value="">Default input (usually the mic)…</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Unlabeled input"}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void startLive("device")}
                >
                  Stream selected input
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void startLive("tab")}>
                  Share a tab instead
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Click <span className="text-foreground font-medium">Scan devices</span>{" "}
                (allow the mic prompt), then pick{" "}
                <span className="text-foreground font-medium">BlackHole 2ch</span>{" "}
                — not the default, which captures your microphone.
              </p>
              <p className="text-xs text-muted-foreground">
                Live streaming can&apos;t be sample-aligned like files — expect a
                small, steady lag versus this Mac&apos;s own speakers. Use each
                phone&apos;s delay trim to line them up.
              </p>
            </>
          )}
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
