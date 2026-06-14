// Offline license verification for the desktop host. A license key is a signed
// token: base64url(payloadJSON) + "." + base64url(Ed25519 signature). The host
// embeds only the PUBLIC key, so keys are verified offline and cannot be forged
// without the private key (kept by the seller; see licensing/issue-license.mjs).
//
// Free tier allows FREE_LIMIT speakers; a valid license unlocks unlimited,
// perpetually (one-time purchase). The key is stored at SURROUND_LICENSE_PATH,
// a file in the Electron app's user-data dir.

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// SPKI DER (base64) of the Ed25519 public key. Pairs with licensing/private-key.pem.
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAVhxz+UDLyLmS+CbExSeeeYvcnuL2I62aQCN0YeNpVBg=";

export const FREE_LIMIT = 2;

let publicKey: KeyObject | null = null;
function getPublicKey(): KeyObject {
  if (!publicKey) {
    publicKey = createPublicKey({
      key: Buffer.from(PUBLIC_KEY_B64, "base64"),
      format: "der",
      type: "spki",
    });
  }
  return publicKey;
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface LicensePayload {
  v: number;
  id: string;
  iat: number;
  to?: string; // who it was issued to (optional)
}

export function verifyKey(key: string): { valid: boolean; payload?: LicensePayload } {
  try {
    const [p, s] = key.trim().split(".");
    if (!p || !s) return { valid: false };
    const payloadBytes = b64urlDecode(p);
    const sig = b64urlDecode(s);
    if (!verify(null, payloadBytes, getPublicKey(), sig)) return { valid: false };
    return { valid: true, payload: JSON.parse(payloadBytes.toString("utf8")) };
  } catch {
    return { valid: false };
  }
}

function licensePath(): string | null {
  return process.env.SURROUND_LICENSE_PATH || null;
}

// Cache the disk read so the hot path (every speaker join) is cheap, but pick up
// a freshly entered key within a few seconds without a restart.
let cache: { at: number; licensed: boolean; payload: LicensePayload | null } = {
  at: 0,
  licensed: false,
  payload: null,
};

export function isLicensed(): boolean {
  const now = Date.now();
  if (now - cache.at < 4000) return cache.licensed;
  let licensed = false;
  let payload: LicensePayload | null = null;
  const p = licensePath();
  if (p) {
    try {
      const r = verifyKey(readFileSync(p, "utf8"));
      licensed = r.valid;
      payload = r.payload ?? null;
    } catch {
      /* no file / unreadable → unlicensed */
    }
  }
  cache = { at: now, licensed, payload };
  return licensed;
}

export function saveLicense(key: string): { ok: boolean; error?: string } {
  if (!verifyKey(key).valid) return { ok: false, error: "Invalid license key." };
  const p = licensePath();
  if (!p) return { ok: false, error: "Licensing is only available in the desktop app." };
  try {
    writeFileSync(p, key.trim(), "utf8");
    cache.at = 0; // invalidate
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the license." };
  }
}

export function licenseStatus(): {
  licensed: boolean;
  plan: "free" | "pro";
  freeLimit: number;
} {
  const licensed = isLicensed();
  return { licensed, plan: licensed ? "pro" : "free", freeLimit: FREE_LIMIT };
}
