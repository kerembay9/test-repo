// Mint a Surround Pro license key. Run after a sale:
//   node licensing/issue-license.mjs "buyer@example.com"
// Prints a signed key the buyer pastes into the desktop host. Requires
// licensing/private-key.pem (gitignored — keep it secret).
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const privateKey = createPrivateKey(readFileSync(join(here, "private-key.pem"), "utf8"));

const to = process.argv[2] || undefined;
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const payload = { v: 1, id: randomUUID(), iat: Date.now(), ...(to ? { to } : {}) };
const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
const sig = sign(null, payloadBytes, privateKey);

const key = `${b64url(payloadBytes)}.${b64url(sig)}`;
console.log("\nSurround Pro license key" + (to ? ` for ${to}` : "") + ":\n");
console.log(key + "\n");
