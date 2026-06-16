# Play Store assets

On-brand graphics for the Surround Speaker listing. Colors/fonts match `mobile/App.tsx`.

## Files

| File | Play field | Spec | Status |
|------|-----------|------|--------|
| `play-icon-512.png` | App icon | 512×512 PNG | ✅ generated |
| `feature-graphic-1024x500.png` | Feature graphic | 1024×500 PNG, no alpha | ✅ generated |
| `screenshot-01..03.png` | Phone screenshots | 1242×2208 (1.78:1) | ✅ from emulator captures |
| `tablet-10in-01..02.png` | 10" tablet screenshots | 1600×2560 (1.6:1) | ✅ from Pixel_Tablet |
| `tablet-7in-01..02.png` | 7" tablet screenshots | 1200×1920 (1.6:1) | ✅ from Pixel_Tablet |

## Regenerate icon + feature graphic

```sh
cd store-assets/_build
FONTCONFIG_FILE="$(pwd)/fonts.conf" node build.js
```

## Phone screenshots

Real emulator captures (sources kept in `_raw/`) framed onto a brand canvas.
Device shots are 1080×2400 (2.22:1), which exceeds Play's **2:1 max**, so each is
scaled onto a 1242×2208 (1.78:1) gradient canvas under a caption band.

To regenerate (edit `SHOTS`/captions in `_build/finalize.js` first):
```sh
cd store-assets/_build
FONTCONFIG_FILE="$(pwd)/fonts.conf" node finalize.js
```

Captures done on AVD `Medium_Phone_API_36.1`:
- `_on.png` — onboarding ("Join the sound field")
- `02_scanner.png` — QR scanner ("Scan the host's QR to join"). The emulator has
  no camera, so this screen is **synthesized** by `_build/camera-scene.js`: a dim
  room with the host's screen showing a real scannable QR, plus the app's actual
  scanner chrome. Needs `qrcode` (`npm i qrcode --no-save`).
- `_c1.png` — connected `/speaker` ("Playing in sync, in real time"); the
  Next.js dev badge is masked out in `finalize.js`.

`_build/frame-screenshots.js` is a generic variant (numbered `_raw/01.png`… +
a `CAPTIONS` array) if you prefer that workflow.

## Tablet screenshots

Captured on AVD `Pixel_Tablet`, portrait 1600×2560 (forced via
`adb shell settings put system user_rotation 1`; the app is portrait-locked and
otherwise letterboxes in the tablet's native landscape). Sources in `_raw_tab/`
(`_on3.png` onboarding, `_r2.png` connected). Framed to 10" (1600×2560) and 7"
(1200×1920) — both 1.6:1, within Play's 2:1 limit.

```sh
cd store-assets/_build
FONTCONFIG_FILE="$(pwd)/fonts.conf" node finalize-tablets.js
```

## In-app launcher + splash icons

The old `mobile/assets/` icons shipped with editor construction guides baked in
and were off-brand (blue chevron). `_build/app-icons.js` regenerates them all
on-brand (matches the store icon): `icon.png`, `splash-icon.png`,
`android-icon-{foreground,background,monochrome}.png`, `favicon.png`. Adaptive
foreground/monochrome content stays inside the center-66% safe zone.

```sh
cd store-assets/_build && node app-icons.js
```

## Notes

- `_build/fonts.conf` points fontconfig at the bundled Bricolage Grotesque + Inter
  TTFs in `node_modules`, so renders use the app's real fonts.
- The previous icon shipped with design-tool construction guides baked in and was
  off-brand (light-blue chevron). The app launcher icons under `mobile/assets/`
  (`icon.png`, adaptive foreground) still carry that old art — regenerate those too
  for a consistent install if desired.
