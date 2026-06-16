# Surround — Electron Desktop App (Mac + Windows)

Date: 2026-06-14

## Goal

Ship Surround (the synchronized-audio host) as an installable desktop app for
macOS and Windows, with a bundled Node runtime and native niceties (tray,
launch-on-login). The plain web workflow (`npm run dev`, browser host) keeps
working unchanged.

## Why not a static wrapper

Surround is fundamentally a LAN server: phones join the host over HTTP and the
host runs the Next.js app with Node-only API routes — SSE (`/api/events`,
`/api/signal/stream`), in-memory store, file upload, time-sync, and mDNS
advertising via `bonjour-service`. Every API route declares
`runtime = "nodejs"`. A static export (`electron-serve`) cannot serve these.
The Electron app must run the real Next.js Node server so phones on the LAN can
still reach it.

## Architecture (Approach A — standalone server spawned by Electron)

1. Build Next.js with `output: "standalone"`, producing a self-contained
   `.next/standalone/server.js`.
2. Electron **main** process, on launch:
   - Picks a free port (default `41234`, fall back if busy).
   - Spawns `server.js` using Electron's bundled Node, with
     `HOSTNAME=0.0.0.0` (so LAN phones reach it) and `PORT=<port>`.
   - Health-polls the port until the server answers.
   - Creates a `BrowserWindow` loading `http://localhost:<port>/` — `localhost`
     is a secure context, required for audio capture (`getUserMedia`). The host
     reads its LAN IP server-side via `/api/host-info` (already implemented), so
     the join link still points phones at the reachable LAN address.
3. Phones connect to `http://<lan-ip>:<port>/speaker`, discovered through the
   existing mDNS advertising (`/api/advertise`, called by the host page).
4. On quit: kill the server child process and `stopAdvertising()`.

Rejected alternatives: (B) running Next in-process inside main — couples
Electron lifecycle to Next internals, fragile, no upside here. (C) static export
— impossible, the API routes need Node.

## Native niceties

- **Tray icon:** show/hide window, "Copy join link" (main computes
  `http://<lan-ip>:<port>/speaker`), toggle launch-on-login, quit.
- **Close-to-tray:** closing the window hides it instead of quitting (menu-bar
  app feel); real quit via tray or app menu.
- **Launch on login:** `app.setLoginItemSettings({ openAtLogin })`, persisted.
- **Native file picker:** the existing host `<input type="file">` already opens
  a native dialog inside Electron's Chromium — no extra IPC plumbing required.
- **Identity:** product name "Surround", app + dock/taskbar icon.

`preload.ts` exposes a minimal, safe `window.surround` bridge
(contextIsolation on, nodeIntegration off): `isElectron`, `platform`,
`appVersion`, and `openExternal(url)`. No Node access in the renderer.

## Build & packaging

- `next.config.ts`: add `output: "standalone"`.
- Electron sources in `electron/` (`main.ts`, `preload.ts`), compiled by `tsc`
  via `tsconfig.electron.json` (CommonJS) to `dist-electron/`.
- **electron-builder** (`electron-builder.yml`):
  - Bundle `.next/standalone`, `.next/static`, `public`, `dist-electron`.
    (Next standalone does not copy `public/` or `.next/static` itself — the
    build step / builder `files` config handles this.)
  - `mac`: `dmg` + `zip`, arm64 + x64, category `public.app-category.music`,
    hardened runtime, entitlements for microphone/audio capture
    (`com.apple.security.device.audio-input`, `NSMicrophoneUsageDescription`).
  - `win`: `nsis`, x64.
  - `directories.buildResources: electron/build-resources` (the repo's
    `.gitignore` ignores `/build`, so resources live under `electron/`).
- `package.json`: add `main: "dist-electron/main.js"`, electron + builder
  dev-deps, and scripts: `build:next`, `build:electron`, `electron:dev`,
  `dist`, `dist:mac`, `dist:win`.

## Code signing (config now, certs later)

Signing config is wired but env-driven; builds run **unsigned** when env vars
are absent, so dev/CI still works. To sign later, supply:

- **macOS:** Developer ID Application cert (`CSC_LINK` + `CSC_KEY_PASSWORD`) and
  notarization creds (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Windows:** Authenticode `.pfx` (`CSC_LINK` + `CSC_KEY_PASSWORD`) or EV token.

## Testing & risks

- **Manual:** `npm run dev` web mode still works (regression); `electron:dev`
  launches and loads the host page; a phone on the LAN joins via mDNS and plays
  in sync; `npm run dist` produces a launchable `.dmg` + Windows installer.
- **Automated:** sync logic stays in `lib/sync/*` (untouched, already
  unit-testable). Electron main is thin glue; the port-pick and server-ready
  helpers are plain functions, smoke-testable.
- **Risks:** standalone not copying `public`/`static` (handled in build);
  macOS firewall prompt on first `0.0.0.0` bind (documented); port collision
  (free-port fallback); orphaned server child (kill on `before-quit` and
  `window-all-closed`).

## File changes

- **New:** `electron/main.ts`, `electron/preload.ts`, `tsconfig.electron.json`,
  `electron-builder.yml`, `electron/build-resources/entitlements.mac.plist`,
  app icons under `electron/build-resources/`.
- **Edit:** `next.config.ts`, `package.json`, `.gitignore`
  (`dist-electron/`, `dist/`).
- **Untouched:** `app/*`, `lib/sync/*` — the Next app runs as-is.
