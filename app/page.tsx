import Link from "next/link";
import { Button } from "@/app/components/ui/button";

// Marketing landing page. Hero thesis: the room itself becomes the speaker —
// opened with the sonar sound-field signature shared with the app.

const STEPS = [
  {
    n: "01",
    title: "Play on your computer",
    body: "Open the host, pick a track or stream your system audio, and hit play.",
  },
  {
    n: "02",
    title: "Phones join from a link",
    body: "Each phone opens a web page on the same Wi-Fi — or the app finds the host automatically. No install needed.",
  },
  {
    n: "03",
    title: "The room plays in sync",
    body: "Every device locks to a shared clock and plays the same instant — left, right, mono, or full stereo per phone.",
  },
];

const SYNC = [
  {
    title: "Shared clock",
    body: "Each device estimates its offset from the host with Cristian's algorithm, agreeing to a few milliseconds on a LAN.",
  },
  {
    title: "Local decode, synced start",
    body: "Phones download and decode the whole track, then schedule the same sample for the same wall-clock instant — no streaming jitter.",
  },
  {
    title: "Drift correction",
    body: "Hardware clocks slowly diverge, so each device nudges its playback rate ±3% to stay locked over a long track.",
  },
];

const ROLES = ["Stereo", "Left", "Right", "Mono"];

// Desktop host installers, served as GitHub Release assets. The artifact names
// are version-less (see electron-builder.yml), so "latest/download" stays valid
// across releases.
const RELEASES = "https://github.com/kerembay9/test-repo/releases/latest/download";
const DOWNLOADS = [
  { label: "macOS — Apple Silicon", file: "Surround-mac-arm64.dmg", primary: true },
  { label: "macOS — Intel", file: "Surround-mac-x64.dmg", primary: false },
  { label: "Windows", file: "Surround-windows-x64.exe", primary: false },
  { label: "Linux — AppImage", file: "Surround-linux-x86_64.AppImage", primary: false },
  { label: "Linux — .deb", file: "Surround-linux-amd64.deb", primary: false },
];

function SoundField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/4"
    >
      <div className="relative h-[460px] w-[460px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="field-ring absolute inset-0 rounded-full border border-primary/60"
            style={{ animationDelay: `${i * 1.1}s` }}
          />
        ))}
        {[0.42, 0.72, 1].map((s, i) => (
          <span
            key={`s-${i}`}
            className="absolute inset-0 rounded-full border border-primary/10"
            style={{ transform: `scale(${s})` }}
          />
        ))}
        <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_22px_4px_var(--primary)]" />
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="relative overflow-hidden">
      {/* Hero */}
      <section className="relative px-6 pb-24 pt-28 text-center">
        <SoundField />
        <div className="relative mx-auto max-w-2xl">
          <p className="mb-6 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Multi-device synchronized audio
          </p>
          <div className="mb-5 flex items-baseline justify-center gap-2.5">
            <span className="wordmark-strong text-5xl text-foreground sm:text-6xl">
              SURROUND
            </span>
            <span className="wordmark-thin text-2xl text-primary sm:text-3xl">
              SPEAKER
            </span>
          </div>
          <h1 className="mx-auto max-w-xl text-balance text-2xl font-semibold leading-snug text-foreground sm:text-3xl">
            Turn the phones around you into one synchronized speaker.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground">
            Play a track on your computer. Nearby phones join and play it in
            time — left, right, mono, or full stereo each — for a real surround
            field across the room.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="px-7 text-base">
              <Link href="/host">Start hosting</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="px-7 text-base">
              <Link href="/speaker">Join as a speaker</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works — a real sequence, so it's numbered. */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          How it works
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card/50 p-6">
              <div className="wordmark-strong mb-3 text-2xl text-primary">{s.n}</div>
              <h3 className="mb-1.5 text-base font-semibold text-foreground">{s.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why it stays in sync — the technical substance. */}
      <section className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mx-auto mb-12 max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-foreground">
              Sync is the hard part. This nails it.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Independent devices have independent clocks and variable Wi-Fi
              latency, so naïve streaming drifts audibly. Surround avoids that.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {SYNC.map((c) => (
              <div key={c.title} className="rounded-2xl border border-border bg-background/60 p-6">
                <div className="mb-3 size-2 rounded-full bg-[var(--live)] shadow-[0_0_10px_2px_var(--live)]" />
                <h3 className="mb-1.5 text-base font-semibold text-foreground">{c.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">
              Assign each phone a place in the field
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {ROLES.map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-sm font-medium text-foreground"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Get the desktop host app */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-2xl font-semibold text-foreground">
          Run the host on your computer
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          The host plays the music and keeps every phone in sync. Download the
          desktop app for macOS, Windows, or Linux — no terminal, no setup.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {DOWNLOADS.map((d) => (
            <Button
              key={d.file}
              asChild
              size="lg"
              variant={d.primary ? "default" : "outline"}
              className="px-7 text-base"
            >
              <a href={`${RELEASES}/${d.file}`}>{d.label}</a>
            </Button>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          macOS 10.12+ · Windows 10+ · Linux (x64). The app runs the host server
          locally; phones join from the same Wi-Fi.
        </p>
      </section>

      {/* Get the speaker app */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-2xl font-semibold text-foreground">Get the speaker app</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Phones can join right from a browser — no install. Or get the native
          app to auto-find the host on your Wi-Fi and keep playing with the
          screen off.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="px-7 text-base">
            <Link href="/speaker">Open in browser</Link>
          </Button>
          <span className="rounded-lg border border-border px-5 py-2.5 text-sm text-muted-foreground">
            iOS &amp; Android apps — coming soon
          </span>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        <span className="wordmark-strong text-sm text-foreground">SURROUND</span> ·
        multi-device synchronized audio
      </footer>
    </main>
  );
}
