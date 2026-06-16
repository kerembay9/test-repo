# Surround — Repository Map

Orientation for picking this repo back up later. What each top-level piece is,
how to build it, where the docs live, and the non-obvious gotchas.

For *how the audio sync works* and the web app itself, see **[README.md](README.md)**.

## Top-level layout

| Path | What it is | Deps | Run / build |
| --- | --- | --- | --- |
| `app/` | Next.js (App Router) web app: marketing landing (`/`), host dashboard (`/host`), speaker page (`/speaker`), and the `/api/*` route handlers. This same Next server is what the desktop app runs internally. | root `package.json` | `npm run dev` |
| `lib/sync/` | Core engine: shared clock (`clock.ts`), playback scheduling (`audio-engine.ts`), WebRTC (`webrtc.ts`), in-memory session store (`server-store.ts`), mDNS (`mdns.ts`), license gate (`license.ts`). | root | — |
| `electron/` | Electron desktop wrapper (`main.ts`, `preload.ts`). Spawns the Next **standalone** server bound to the LAN, opens a window on `/host`. Build resources (icons, entitlements, notarize hook, `copy-standalone.mjs`) live under `build-resources/`. | root | `npm run electron:dev` |
| `mobile/` | Separate **React Native (Expo)** speaker app. Its own toolchain and `node_modules`. | `mobile/package.json` | see `mobile/CLAUDE.md` |
| `buy-service/` | Standalone Node payment microservice (`horizon-pay` → PayTR). Deployed on EC2 at `pay.horizonzeta.com`; the host dashboard links to it for the Pro purchase. Runs as a systemd unit (`surround-buy.service`). | `buy-service/package.json` | see `buy-service/README.md` |
| `licensing/` | Offline license-key signing for the Pro speaker-cap (`issue-license.mjs`). `private-key.pem` is **gitignored — never commit it**. | — | — |
| `docs/` | Design specs (e.g. the desktop app design doc). | — | — |
| `.github/workflows/` | CI. `build-windows.yml` builds + uploads the Windows installer. | — | — |

## Build & release

| Target | Command | Notes |
| --- | --- | --- |
| Web (dev) | `npm run dev` | http://localhost:3000 |
| Desktop (dev) | `npm run electron:dev` | rebuilds standalone + launches the app |
| macOS installers | `npm run dist:mac` | dmg + zip, arm64 + x64 → `dist/`. Signs automatically with the Developer ID cert in the keychain. Notarizes **only** when `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` are set — see [SIGNING.md](SIGNING.md). |
| Linux installers | Docker (`electronuserland/builder:wine`) | AppImage + deb. Output to a container-local dir then copy out — Docker Desktop's bind mount rejects `chmod`, which fails an in-place build. |
| Windows installer | GitHub Actions (`.github/workflows/build-windows.yml`) | Triggered by pushing a `v*` tag. **Cannot be cross-built locally** on Apple Silicon — wine crashes under qemu. |

**Release flow:** artifacts are uploaded to a GitHub Release (currently tag `v0.1.0`). The landing page links to `releases/latest/download/<file>`, so artifact names are **version-less and must stay stable** (configured in `electron-builder.yml`).

## Gotchas (learned the hard way)

- **Standalone runtime must be bundled.** Next 16's Turbopack `output: "standalone"` tracer drops `next/dist/compiled/next-server/app-route-turbo.runtime.prod.js` — the runtime every `/api/*` route handler loads. Without it, every API route returns **500** in the packaged app (host dashboard stuck on "Connecting") while static pages still render. A dev machine hides this via the hoisted `node_modules`. Fix lives in `electron/build-resources/copy-standalone.mjs`.
- **tsconfig excludes `mobile` and `buy-service`** so the web `next build` typecheck doesn't sweep their sources and fail on a fresh checkout (CI) with `Cannot find module 'react-native'`.
- **Session store is process-local by design** — the deployment model is a single host process everyone connects to.

## Docs index

- [README.md](README.md) — web app: sync algorithm, routes, getting started.
- [SIGNING.md](SIGNING.md) — macOS code signing + notarization setup.
- [SPOTIFY_STREAMING.md](SPOTIFY_STREAMING.md) — system-audio loopback capture notes.
- `docs/superpowers/specs/` — desktop app design spec.
- `buy-service/README.md` — payment microservice.
- `mobile/CLAUDE.md`, `mobile/AGENTS.md`, `mobile/APP_STORE_CHECKLIST.md`, `mobile/store/` — mobile app + store listing.

## Known open items (as of 2026-06-16)

- macOS builds are signed but **not notarized** → public downloaders hit Gatekeeper "damaged" until an Apple app-specific password is provided.
- Windows exe is **unsigned** → SmartScreen "unknown publisher" warning (needs a Windows code-signing cert).
- Unused root dependencies (safe to drop): **`lucide-react`** (no references anywhere) and **`@kerembay9/horizon-pay`** (only used by `buy-service/`, which declares its own).
