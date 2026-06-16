# Signing & notarizing the macOS desktop app

A macOS app downloaded from the web only opens with a normal double-click if it
is **signed with a Developer ID Application certificate** and **notarized** by
Apple. Without that, Gatekeeper shows "Surround is damaged and can't be opened."

The build is already wired for this: `electron-builder.yml` sets `hardenedRuntime`,
entitlements, and an `afterSign` hook (`electron/build-resources/notarize.js`)
that notarizes + staples when Apple credentials are in the environment. You only
need to obtain the credentials and run the build.

## One-time setup

### 1. Enroll in the Apple Developer Program
<https://developer.apple.com/programs/> — $99/year. Required for a Developer ID
certificate. Enrollment can take a few hours to a day to activate.

### 2. Create a "Developer ID Application" certificate
Easiest via Xcode:
- Xcode → Settings → Accounts → add your Apple ID → **Manage Certificates** →
  **+** → **Developer ID Application**.

This installs the certificate + private key into your login keychain. Confirm:
```bash
security find-identity -p codesigning -v | grep "Developer ID Application"
```
You should see one line like `... "Developer ID Application: Your Name (TEAMID)"`.

### 3. Generate an app-specific password (for notarization)
<https://appleid.apple.com> → **Sign-In and Security** → **App-Specific
Passwords** → generate one. Format: `xxxx-xxxx-xxxx-xxxx`.

### 4. Find your Team ID
<https://developer.apple.com/account> → **Membership** → **Team ID** (10 chars).

## Building a signed + notarized release

With the certificate in your login keychain, electron-builder auto-discovers it —
no `CSC_LINK` needed. Set the notarization env vars and build:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

npm run dist:mac
```

electron-builder signs with the Developer ID identity, the hook notarizes and
staples, and you get `dist/Surround-mac-arm64.dmg` + `dist/Surround-mac-x64.dmg`
that open cleanly for anyone.

> Do **not** pass `CSC_IDENTITY_AUTO_DISCOVERY=false` — that flag (used only for
> unsigned dev builds) disables signing.

## Verify it worked
```bash
codesign -dv --verbose=2 "dist/mac-arm64/Surround.app"      # TeamIdentifier set, not adhoc
spctl -a -vv "dist/mac-arm64/Surround.app"                  # "accepted, source=Notarized Developer ID"
xcrun stapler validate "dist/Surround-mac-arm64.dmg"        # "The validate action worked!"
```

## CI / headless signing (optional)
If building somewhere without your keychain (CI), export the cert as `.p12` and
provide it via env instead of the keychain:
```bash
# Keychain Access → export the "Developer ID Application" cert as Certificates.p12
export CSC_LINK="$(base64 -i Certificates.p12)"   # or a file path
export CSC_KEY_PASSWORD="the .p12 password"
# plus the three APPLE_* vars above
npm run dist:mac
```

## Windows
The same `npm run dist:win` produces `Surround-windows-x64.exe`. To avoid
SmartScreen warnings it needs an Authenticode certificate (`CSC_LINK` +
`CSC_KEY_PASSWORD`); otherwise it runs but warns on first launch. Windows builds
must run on Windows (or with wine/mono available).
