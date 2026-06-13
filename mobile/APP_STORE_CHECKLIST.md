# Surround Speaker — App Store readiness checklist

Researched June 2026. The native app is an Expo (React Native) shell that embeds
the host's `/speaker` page in a hardened WebView with native onboarding, QR join,
saved identity, connection status, and keep-awake. Sources at the bottom.

## 0. Accounts & one-time cost (blocking — needs YOU)
- [ ] **Apple Developer Program** — $99/year. Required to sign a Distribution
      build and create the App Store Connect record. (Dev certs already on this
      Mac; a **Distribution** cert + App Store provisioning profile are still
      needed — EAS can create them after you log in with your Apple ID + 2FA.)
- [ ] **Google Play Console** — $25 one-time. Required to upload the AAB.
- [ ] Decide the final **bundle id / package** (currently
      `com.horizonzeta.surroundspeaker`) — it is permanent once published.

## 1. Identity & assets
- [ ] App name finalized ("Surround Speaker") and unique on both stores.
- [ ] **App icon** 1024×1024 (no alpha for iOS) — replace `assets/icon.png`.
- [ ] Android adaptive icon foreground/background — replace the `assets/android-icon-*`.
- [ ] Splash screen (`expo-splash-screen` / `assets/splash.png`).
- [ ] Screenshots: iPhone 6.9" + 6.5"; Android phone (min 2 each). Tablet shots
      if `supportsTablet` stays true (or set it false to avoid iPad shots).
- [ ] Short + full description, keywords, support URL, marketing URL.
- [ ] Privacy Policy URL (required by both stores) — host one page.

## 2. Versioning
- [ ] iOS `version` (1.0.0) + `buildNumber`; Android `version` + `versionCode`.
      `eas.json` production profile has `autoIncrement` for build numbers.

## 3. Android technical (Google Play, 2026)
- [ ] **Target API level 36 (Android 16)** — required for new apps/updates from
      **31 Aug 2026**. Expo SDK 56 targets a recent API; confirm `targetSdkVersion`
      ≥ 36 before submitting (set via `expo-build-properties` if needed).
- [ ] Ship an **AAB** (`buildType: app-bundle`), not an APK — Play requires AAB.
      (APK from the `preview` profile is for sideload testing only.)
- [ ] **Upload keystore** — let EAS manage it, or generate and back it up. Losing
      it means you can never update the app.
- [ ] **Data safety form** in Play Console: declare what's collected. This app
      stores host URL + device name locally only and collects no analytics —
      declare "no data collected/shared" accordingly.
- [ ] Cleartext HTTP to the LAN host is enabled (`usesCleartextTraffic: true`).
      Be ready to justify it in review (local-network device control).
- [ ] Content rating questionnaire (IARC).
- [ ] 64-bit only (RN/Expo are already).

## 4. iOS technical (App Store)
- [ ] **Privacy manifest** `PrivacyInfo.xcprivacy` — required since 2024/2025 for
      apps and privacy-impacting SDKs. Declared in `app.json`
      (`ios.privacyManifests`) for the UserDefaults required-reason API (AsyncStorage,
      reason `CA92.1`). Verify after `expo prebuild`.
- [ ] **Privacy "nutrition label"** in App Store Connect — match the manifest
      (no tracking; local-only storage).
- [ ] Usage-description strings present (camera, microphone, local network) — set
      in `ios.infoPlist`. Each must be specific or review rejects it.
- [ ] **App Transport Security**: `NSAllowsLocalNetworking` set (not arbitrary
      loads) so the LAN HTTP host is reachable without a blanket ATS disable.
- [ ] `UIBackgroundModes: ["audio"]` so playback continues when screen locks —
      Apple checks the app genuinely plays audio in the background (it does).
- [ ] Encryption declaration: `ITSAppUsesNonExemptEncryption=false` (only HTTPS/
      standard crypto) — add to `infoPlist` to skip the export-compliance prompt.

## 5. Guideline 4.2 — Minimum Functionality (the real WebView risk)
Apple rejects apps that are "just a website." Mitigations already built in; keep
them and be ready to point review at them:
- [ ] Native onboarding screen (host entry + named device) — not a raw WebView.
- [ ] **Native QR-scan** join flow (uses the camera — a device capability).
- [ ] Native connection-status bar + "Change host" control.
- [ ] Background audio + keep-awake (real device integration, not browser).
- [ ] Persisted identity via native storage.
- [ ] In the review notes, explain it's a **LAN device-control/audio client**, and
      provide a reachable host for the reviewer (see §7).

## 6. Legal / policy
- [ ] Confirm the name "Surround" doesn't infringe trademarks.
- [ ] No Spotify branding/logos in the app or listing (it streams *system* audio;
      don't imply a Spotify partnership). Review the Spotify brand guidelines if
      you mention it at all.
- [ ] Account-deletion rule: N/A (no accounts).

## 7. Reviewer access (both stores will test it)
- [ ] The app needs a **running host on the same network as the reviewer** — they
      can't reach your home LAN. Options: (a) ship a small demo/cloud host over
      HTTPS the app can point at, or (b) record a demo video and provide test
      steps + a temporary public host URL in review notes. Without this, both
      stores will reject "can't test core functionality."

## 8. Build commands
```bash
cd mobile
# one-time
npm i -g eas-cli && eas login
eas build:configure

# Android installable APK for testing (no Play account needed)
eas build -p android --profile preview

# Store builds (need the accounts/credentials above)
eas build -p android --profile production   # -> AAB for Play
eas build -p ios     --profile production   # -> signed IPA for App Store
eas submit -p android --profile production
eas submit -p ios     --profile production

# Local Android APK without EAS (uses local Android SDK)
npx expo prebuild -p android
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

## Sources
- [Google Play target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Meet Google Play's target API level requirement (developer.android.com)](https://developer.android.com/google/play/requirements/target-sdk)
- [Apple: privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Apple: adding a privacy manifest](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk)
- [Apple App Store Review Guidelines (4.2 Minimum Functionality)](https://developer.apple.com/app-store/review/guidelines/)
