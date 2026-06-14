"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
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

// Bridge exposed by the Electron preload (see electron/preload.ts). Undefined
// in a plain browser.
type SurroundBridge = {
  isElectron?: boolean;
  openExternal?: (url: string) => void;
  enableLoopbackAudio?: () => Promise<void>;
  disableLoopbackAudio?: () => Promise<void>;
  audioListOutputs?: () => Promise<string[]>;
  audioGetOutput?: () => Promise<string>;
  audioSetOutput?: (name: string) => Promise<string>;
};
const BLACKHOLE_URL = "https://existential.audio/blackhole/";
// Hosted buy endpoint (EC2): creates a 500 TL horizon-pay session and redirects
// to checkout. Keeps the API key server-side, off every client.
const BUY_URL = "https://pay.horizonzeta.com/surround-buy/buy";
const surroundApi: SurroundBridge | undefined =
  typeof window !== "undefined"
    ? (window as unknown as { surround?: SurroundBridge }).surround
    : undefined;

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

/** Numbered step header inside a panel. */
function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-sm font-semibold text-primary tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="wordmark text-base font-semibold uppercase tracking-[0.12em] text-foreground">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Big source-choice button (track vs capture). */
function SourceBtn({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl border px-4 py-3 text-left transition-colors " +
        (active
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-background/40 hover:border-border/80 hover:bg-card")
      }
    >
      <div className={"text-sm font-semibold " + (active ? "text-primary" : "text-foreground")}>
        {label}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
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
  const [refreshing, setRefreshing] = useState(false);
  // Freemium plan state (desktop host). Free hosts cap the speaker count.
  const [license, setLicense] = useState<{ licensed: boolean; freeLimit: number } | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);
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
  // Phones report their live-stream latency; delay the Mac to match the slowest
  // so it isn't ahead of any of them.
  const measuredLatencies = speakers
    .map((s) => s.latencyMs)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const suggestedDelay = measuredLatencies.length
    ? Math.round(Math.max(...measuredLatencies))
    : null;

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
  // Which source the host is using; live forces the live panel regardless.
  const [sourceMode, setSourceMode] = useState<"track" | "live">("track");
  // Local intent to stream, so the host's signaling mailbox opens immediately
  // instead of waiting for the `live` flag to round-trip through a snapshot.
  const [streaming, setStreaming] = useState(false);
  // How the live audio is being captured. In "loopback" the original output is
  // muted (loopbackWithMute), so the Mac monitor can use the default speakers
  // without doubling/feeding back; other modes need a real-speaker device.
  const [captureMode, setCaptureMode] = useState<"device" | "tab" | "loopback" | null>(null);
  // Native desktop bridge (preload). Present only in the Electron app; unlocks
  // one-click system-audio capture. Set in an effect to avoid SSR/hydration skew.
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    setIsElectron(Boolean(surroundApi?.isElectron));
  }, []);
  const captureRef = useRef<MediaStream | null>(null);
  const broadcasterRef = useRef<HostBroadcaster | null>(null);
  // Real output device to restore after the BlackHole "Mac as a speaker" flow
  // swapped the system output. Null when we didn't change it.
  const prevSystemOutputRef = useRef<string | null>(null);
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

  // Re-detect the LAN IP (for the QR/join URL) and re-advertise over mDNS.
  // Runs on mount and from the "Refresh network" button after a Wi-Fi change —
  // `force` re-binds mDNS to the new interface even on the same port.
  const refreshNetwork = useCallback(async (force = false) => {
    const port =
      Number(window.location.port) ||
      (window.location.protocol === "https:" ? 443 : 80);
    // mDNS re-advertise (discovery is a convenience; QR/manual entry still work).
    void fetch("/api/advertise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, force }),
    }).catch(() => {});
    // Build a join URL phones can reach: the server's LAN IP, not the localhost
    // the host page is served on. Fall back to the page origin.
    const fallback = `${window.location.origin}/speaker`;
    try {
      const { addresses } = (await (await fetch("/api/host-info")).json()) as {
        addresses: string[];
      };
      const ip = addresses?.[0];
      const p = window.location.port ? `:${window.location.port}` : "";
      setJoinUrl(ip ? `${window.location.protocol}//${ip}${p}/speaker` : fallback);
    } catch {
      setJoinUrl((prev) => prev || fallback);
    }
  }, []);

  useEffect(() => {
    void refreshNetwork(false);
  }, [refreshNetwork]);

  // License/plan status (desktop host; web hosts report free with no path).
  const refreshLicense = useCallback(async () => {
    try {
      setLicense((await (await fetch("/api/license")).json()) as {
        licensed: boolean;
        freeLimit: number;
      });
    } catch {
      /* leave as-is */
    }
  }, []);
  useEffect(() => {
    void refreshLicense();
  }, [refreshLicense]);

  const activateLicense = async () => {
    setLicenseMsg(null);
    try {
      const r = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: licenseKey.trim() }),
      });
      if (r.ok) {
        setLicense((await r.json()) as { licensed: boolean; freeLimit: number });
        setLicenseKey("");
        setLicenseMsg("Activated — Surround Pro unlocked. Unlimited speakers.");
      } else {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        setLicenseMsg(e.error ?? "Invalid license key.");
      }
    } catch {
      setLicenseMsg("Couldn't reach the host to activate.");
    }
  };

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

  const startLive = (mode: "device" | "tab" | "loopback") =>
    guard(async () => {
      let stream: MediaStream;
      if (mode === "loopback") {
        // Native system-audio capture via the desktop app (no BlackHole). The
        // main process answers the display-media request with loopback audio;
        // we only keep the audio track.
        if (!surroundApi?.enableLoopbackAudio) {
          throw new Error("System audio capture is only available in the desktop app.");
        }
        await surroundApi.enableLoopbackAudio();
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (e) {
          throw new Error(
            "Couldn't capture system audio. On macOS, allow Screen Recording for Surround in System Settings → Privacy & Security, then retry. (" +
              (e instanceof Error ? e.message : String(e)) +
              ")",
          );
        } finally {
          await surroundApi.disableLoopbackAudio?.();
        }
        stream.getVideoTracks().forEach((t) => t.stop());
      } else if (mode === "tab") {
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
      setCaptureMode(mode);
      setCapturedLabel(
        mode === "loopback"
          ? "System audio"
          : stream.getAudioTracks()[0]?.label || "unknown input",
      );
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
      setCaptureMode(null);
      // Restore the system output if the BlackHole flow swapped it.
      if (prevSystemOutputRef.current && surroundApi?.audioSetOutput) {
        await surroundApi.audioSetOutput(prevSystemOutputRef.current).catch(() => {});
        prevSystemOutputRef.current = null;
      }
      await sendControl({ action: "endLive" });
    });

  // "Use this Mac as a speaker too": route the system output into BlackHole (so
  // the source no longer hits the real speakers), capture BlackHole, broadcast
  // to phones, and replay delayed to the real speakers — so the Mac plays in
  // sync. Restores the output on stop. Needs BlackHole installed.
  const enableMacSpeaker = () =>
    guard(async () => {
      const api = surroundApi;
      if (!api?.audioListOutputs || !api.audioGetOutput || !api.audioSetOutput) {
        throw new Error("This needs the desktop app.");
      }
      const outNames = await api.audioListOutputs();
      const blackhole = outNames.find((n) => /blackhole/i.test(n));
      if (!blackhole) {
        api.openExternal?.(BLACKHOLE_URL);
        throw new Error(
          "BlackHole isn't installed. I opened the download page — install it " +
            "(one-time), then try again.",
        );
      }
      // Prime permission, then resolve the BlackHole input + real-speaker output.
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
      const devs = await navigator.mediaDevices.enumerateDevices();
      const bhIn = devs.find(
        (d) => d.kind === "audioinput" && /blackhole/i.test(d.label),
      );
      if (!bhIn) throw new Error("Couldn't find the BlackHole input device.");

      const prev = await api.audioGetOutput();
      const realOut =
        devs.find((d) => d.kind === "audiooutput" && d.label === prev) ??
        devs.find((d) => d.kind === "audiooutput" && d.deviceId === "default");
      if (!realOut) throw new Error("Couldn't find your real speakers to play back on.");

      // Route the source into BlackHole (remember the real output to restore).
      await api.audioSetOutput(blackhole);
      prevSystemOutputRef.current = prev;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: bhIn.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        // Broadcast to phones.
        captureRef.current = stream;
        setCaptureMode("device");
        setCapturedLabel("This Mac (via BlackHole)");
        broadcasterRef.current = new HostBroadcaster(stream, sendSignal);
        setStreaming(true);
        await sendControl({ action: "goLive", hostId });
        broadcasterRef.current.syncSpeakers(
          (snapshotRef.current?.speakers ?? []).map((s) => s.id),
        );
        // Replay on the real speakers, delayed, to line up with the phones.
        if (!engineRef.current) engineRef.current = new AudioEngine();
        const engine = engineRef.current;
        await engine.unlock();
        await engine.setOutputDevice(realOut.deviceId);
        const start = suggestedDelay ?? (hostTrimMs || 250);
        setHostTrimMs(start);
        engine.setTrimMs(start);
        engine.attachStream(stream);
        setOutputId(realOut.deviceId);
        setMonitorOn(true);
      } catch (e) {
        // Restore the output if anything failed mid-setup.
        await api.audioSetOutput(prev).catch(() => {});
        prevSystemOutputRef.current = null;
        throw e;
      }
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
    <div className="mx-auto max-w-2xl px-5 py-8 lg:py-12">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="flex items-baseline gap-2.5">
          <span className="wordmark-strong text-2xl text-foreground">SURROUND</span>
          <span className="wordmark-thin text-base text-primary">HOST</span>
        </h1>
        <span className="status-pill" data-live={connected}>
          <span className="status-dot" />
          {connected ? "Live" : "Connecting…"}
        </span>
      </header>

      {err && (
        <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="space-y-5">
        {/* 1 — Connect phones */}
        <Card className="px-6">
          <Step n={1} title="Connect your phones" hint="Same Wi-Fi as this computer" />
          <div className="flex flex-col items-center gap-4">
            {joinUrl && (
              <div className="rounded-2xl bg-white p-3 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)]">
                <QRCodeSVG value={joinUrl} size={188} marginSize={0} />
              </div>
            )}
            <p className="text-center text-sm text-muted-foreground">
              Scan with each phone&apos;s camera, or open this address:
            </p>
            <code className="block w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-center text-sm break-all">
              {joinUrl || "…"}
            </code>
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => void copyJoin()}>
                {copied ? "Copied ✓" : "Copy link"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void refreshNetwork(true).finally(() =>
                    setTimeout(() => setRefreshing(false), 600),
                  );
                }}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            <div className="w-full">
              {speakers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  Waiting for phones to join…
                </p>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  {speakers.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm"
                    >
                      <span className="size-1.5 rounded-full bg-[var(--live)]" />
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {license && !license.licensed && speakers.length >= license.freeLimit && (
              <p className="text-center text-xs text-primary">
                You&apos;re at the free {license.freeLimit}-phone limit — get Pro below to add more.
              </p>
            )}
          </div>
        </Card>

        {/* 2 — What plays */}
        <Card className="px-6">
          <Step n={2} title="Choose what plays" />
          <div className="grid grid-cols-2 gap-2">
            <SourceBtn
              active={sourceMode === "track"}
              onClick={() => setSourceMode("track")}
              label="Play a track"
              sub="Music file or link"
            />
            <SourceBtn
              active={sourceMode === "live"}
              onClick={() => setSourceMode("live")}
              label="Capture this Mac"
              sub="Spotify / system audio"
            />
          </div>

          {sourceMode === "track" ? (
            <div className="mt-4 space-y-4">
              {track && (
                <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{track.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {fmt(scrubbing ?? displayPos)} / {fmt(duration)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.5}
                    disabled={!duration}
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
                  <div className="flex items-center gap-2">
                    <Button
                      className="flex-1"
                      disabled={busy}
                      onClick={() => (isPlaying ? void pause() : void play())}
                    >
                      {isPlaying ? "Pause" : "Play"}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={stop}>
                      Stop
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {track ? "Change track" : "Pick a track"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => chooseTrack(BUNDLED_TRACK)}>
                    Test sound
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      Upload file…
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onUpload(f);
                        }}
                      />
                    </label>
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="…or paste an audio URL"
                    className="min-w-0 flex-1 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm outline-none focus:border-primary/60"
                  />
                  <Button size="sm" variant="outline" disabled={!urlInput.trim()} onClick={onUrl}>
                    Load
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Play on this computer too</span>
                {hostAudioOn ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={hostVolume}
                      onChange={(e) => setHostVolume(Number(e.target.value))}
                      className="w-24"
                    />
                    <span className="w-9 text-right text-sm tabular-nums text-muted-foreground">
                      {Math.round(hostVolume * 100)}%
                    </span>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void enableHostAudio()}>
                    Enable
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {isElectron ? (
                live ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 p-4">
                    <span className="text-sm">
                      <span className="text-[var(--live)]">●</span> Streaming{" "}
                      <span className="font-medium">{capturedLabel || "audio"}</span> to{" "}
                      {speakers.length} phone{speakers.length === 1 ? "" : "s"}
                    </span>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void stopLive()}>
                      Stop
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button className="w-full" disabled={busy} onClick={() => void startLive("loopback")}>
                      Capture this Mac&apos;s audio
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      One click — no setup. On macOS, approve{" "}
                      <span className="text-foreground font-medium">Screen Recording</span> the first
                      time. The Mac keeps playing; the phones are the synced satellites.
                    </p>
                  </>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  Open the Surround desktop app to capture this Mac&apos;s audio. In a browser, play a
                  track instead — or pick a loopback input under Advanced.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Advanced */}
        <details className="overflow-hidden rounded-2xl border border-white/[0.06] bg-card/40">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-medium">
            <span>Advanced</span>
            <span className="text-xs text-muted-foreground">timing · BlackHole · devices</span>
          </summary>
          <div className="space-y-6 border-t border-white/[0.06] p-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Line this Mac up with the phones</p>
              <p className="text-xs text-muted-foreground">
                Phones lag by the stream buffer, so this Mac sounds early. Play the captured audio
                back through a different output (headphones), delayed, to match.
              </p>
              {!monitorOn ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="max-w-[16rem] rounded-md border border-border bg-background px-2 py-2 text-sm"
                    value={outputId}
                    onFocus={() => void refreshInputs()}
                    onChange={(e) => setOutputId(e.target.value)}
                  >
                    <option value="">App output: pick headphones/other…</option>
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm tabular-nums">Delay {hostTrimMs} ms</span>
                    <Button size="sm" variant="ghost" onClick={disableMonitor}>
                      Turn off
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => nudgeDelay(-25)}>-25</Button>
                    <Button size="sm" variant="outline" onClick={() => nudgeDelay(-5)}>-5</Button>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={5}
                      value={hostTrimMs}
                      onChange={(e) => setDelayMs(Number(e.target.value))}
                      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums"
                    />
                    <Button size="sm" variant="outline" onClick={() => nudgeDelay(5)}>+5</Button>
                    <Button size="sm" variant="outline" onClick={() => nudgeDelay(25)}>+25</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={suggestedDelay === null}
                      onClick={() => suggestedDelay !== null && setDelayMs(suggestedDelay)}
                    >
                      {suggestedDelay === null ? "Measuring…" : `Auto (${suggestedDelay} ms)`}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {isElectron && (
              <div className="space-y-2 border-t border-white/[0.06] pt-5">
                <p className="text-sm font-medium">Use this Mac as a speaker too (in sync)</p>
                <p className="text-xs text-muted-foreground">
                  Routes the sound through BlackHole so this Mac&apos;s own speakers play in sync.
                  Auto-switches output and restores it on stop. Needs BlackHole installed.
                </p>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void enableMacSpeaker()}>
                  Set up BlackHole sync
                </Button>
              </div>
            )}

            <div className="space-y-2 border-t border-white/[0.06] pt-5">
              <p className="text-sm font-medium">Capture a specific input or a browser tab</p>
              <p className="text-xs text-muted-foreground">
                For BlackHole/loopback inputs, or sharing one tab&apos;s audio.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void refreshInputs()}>
                  Scan devices
                </Button>
                <select
                  className="max-w-[14rem] rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={inputId}
                  onFocus={() => void refreshInputs()}
                  onChange={(e) => setInputId(e.target.value)}
                >
                  <option value="">Default input…</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Unlabeled input"}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void startLive("device")}>
                  Stream input
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void startLive("tab")}>
                  Share a tab
                </Button>
              </div>
            </div>
          </div>
        </details>

        {/* Pro / license */}
        {license &&
          (license.licensed ? (
            <div className="flex items-center gap-2.5 text-sm">
              <span className="status-pill" data-live="true">
                <span className="status-dot" />
                Surround Pro
              </span>
              <span className="text-muted-foreground">Unlimited speakers</span>
            </div>
          ) : (
            <div className="panel-pro space-y-3.5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="wordmark text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Surround Pro
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Free covers {license.freeLimit} phones. Go unlimited.
                  </p>
                </div>
                <div className="text-right leading-none">
                  <div className="wordmark-strong text-2xl text-foreground tabular-nums">
                    600<span className="ml-1 text-base font-normal text-muted-foreground">TL</span>
                  </div>
                  <div className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                    KDV dahil · tek seferlik
                  </div>
                </div>
              </div>
              <Button
                className="w-full shadow-[0_10px_30px_-12px_var(--primary)]"
                onClick={() => {
                  if (surroundApi?.openExternal) surroundApi.openExternal(BUY_URL);
                  else window.open(BUY_URL, "_blank");
                }}
              >
                Get Pro — unlock every phone
              </Button>
              <div className="flex items-center gap-2">
                <input
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="Already have a key?"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm outline-none focus:border-primary/60"
                />
                <Button size="sm" variant="outline" disabled={!licenseKey.trim()} onClick={() => void activateLicense()}>
                  Activate
                </Button>
              </div>
              {licenseMsg && <p className="text-xs text-muted-foreground">{licenseMsg}</p>}
            </div>
          ))}
      </div>
    </div>
  );
}
