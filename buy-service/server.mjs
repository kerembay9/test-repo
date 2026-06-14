// Surround Pro buy + auto-fulfillment service (runs on the EC2, same box as the
// pay backend). Flow:
//   GET  /buy     -> create session, set token cookie, redirect to checkout
//   POST /webhook -> pay backend posts here on success (localhost, secret-guarded)
//                    -> mint a license key, store it by session token
//   GET  /done    -> read cookie, show the minted key (polls until webhook lands)
//   GET  /key     -> { key } | { pending: true } for a token (page polling)
//   GET  /failed, /health
//
// The signing PRIVATE KEY lives on this box (private-key.pem, chmod 600) so keys
// are minted server-side only after a real, hash-verified PayTR payment.
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPrivateKey, sign, randomUUID } from "node:crypto";
import { PaymentClient, PaymentClientError } from "@kerembay9/horizon-pay";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const apiKey = process.env.HORIZON_PAY_API_KEY;
const webhookSecret = process.env.WEBHOOK_SECRET || "";
if (!apiKey) {
  console.error("HORIZON_PAY_API_KEY is required");
  process.exit(1);
}

const PRICE_TL = 600;
const PAY_BASE = "https://pay.horizonzeta.com";
const PUB = "https://pay.horizonzeta.com/surround-buy";
const client = new PaymentClient({ baseUrl: PAY_BASE, apiKey });

// Live checkout URL (query-param locale, per the updated pay app).
const checkoutUrl = (token, language = "tr") =>
  `${PAY_BASE}/?token=${encodeURIComponent(token)}&language=${language}`;

/* ---------- license minting (private key on this box) ---------- */
const KEY_PATH = process.env.PRIVATE_KEY_PATH || join(HERE, "private-key.pem");
let privateKey = null;
try {
  privateKey = createPrivateKey(readFileSync(KEY_PATH, "utf8"));
} catch {
  console.error(`[mint] no private key at ${KEY_PATH} — fulfillment disabled`);
}
const b64url = (b) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function mintKey(to) {
  const payload = { v: 1, id: randomUUID(), iat: Date.now(), ...(to ? { to } : {}) };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return `${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

/* ---------- token -> key store (survives restarts) ---------- */
const STORE = join(HERE, "keys.json");
let keys = {};
try {
  if (existsSync(STORE)) keys = JSON.parse(readFileSync(STORE, "utf8"));
} catch {
  keys = {};
}
function saveKeys() {
  try {
    writeFileSync(STORE, JSON.stringify(keys), "utf8");
  } catch (e) {
    console.error("[store] write failed:", e.message);
  }
}

/* ---------- helpers ---------- */
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PAGE_HEAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Surround Pro</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#0a0c16;color:#eef0fb;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background-image:radial-gradient(90% 55% at 50% -12%,rgba(255,138,76,.13),transparent 55%)}
.wrap{max-width:560px;margin:0 auto;padding:64px 24px 96px}
.brand{font-weight:800;letter-spacing:.04em;font-size:13px;text-transform:uppercase;color:#ff8a4c;margin-bottom:10px}
h1{font-size:28px;margin:0 0 8px}p{color:#c9c6d4}strong{color:#fff}
.key{margin:18px 0;padding:14px;border:1px solid #2a3050;border-radius:12px;background:#12162a;
font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;user-select:all}
.btn{display:inline-block;margin-top:6px;padding:10px 16px;border-radius:10px;border:0;background:#ff8a4c;color:#1a0e06;font-weight:700;cursor:pointer}
.muted{color:#888fb5;font-size:14px}.spin{color:#ff8a4c}
a{color:#ff8a4c}</style></head><body><div class="wrap">
<div class="brand">Surround Speaker</div>`;
const PAGE_FOOT = `<footer class="muted" style="margin-top:48px">© 2026 Horizon Zeta · Surround Speaker</footer></div></body></html>`;

function doneReady(key) {
  return `${PAGE_HEAD}
<h1>Payment received 🎉</h1>
<p>Here's your <strong>Surround Pro</strong> license key. In the Surround host, open
<strong>Surround Pro → “Already have a key?”</strong>, paste it, and Activate —
unlimited phones, forever.</p>
<div class="key" id="k">${esc(key)}</div>
<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('k').textContent);this.textContent='Copied ✓'">Copy key</button>
<p class="muted" style="margin-top:22px">Save this key somewhere safe. Trouble? Email
<a href="mailto:kerembayramoglu@horizonzeta.com">kerembayramoglu@horizonzeta.com</a>.</p>
${PAGE_FOOT}`;
}
function donePending(token) {
  return `${PAGE_HEAD}
<h1>Payment received 🎉</h1>
<p class="spin" id="s">Generating your license key…</p>
<div id="out"></div>
<p class="muted">This usually takes a few seconds.</p>
<script>
var t=${JSON.stringify(token)};
async function poll(){try{var r=await fetch('/surround-buy/key?token='+encodeURIComponent(t));var j=await r.json();
if(j.key){document.getElementById('s').style.display='none';
document.getElementById('out').innerHTML='<p>Here is your <strong>Surround Pro</strong> key — paste it into the host (Surround Pro → “Already have a key?”).</p><div class="key" id="k">'+j.key+'</div><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById(\\'k\\').textContent);this.textContent=\\'Copied ✓\\'">Copy key</button>';
return;}}catch(e){}setTimeout(poll,2500);}poll();
</script>${PAGE_FOOT}`;
}
function failedPage() {
  return `${PAGE_HEAD}
<h1>Payment didn't go through</h1>
<p>No charge was made. You can try again from the <strong>Buy</strong> button in the
Surround host. The free plan keeps working (up to two phones).</p>
<p class="muted">Trouble? <a href="mailto:kerembayramoglu@horizonzeta.com">kerembayramoglu@horizonzeta.com</a></p>
${PAGE_FOOT}`;
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, type, body, headers = {}) => {
    res.writeHead(code, { "content-type": type, ...headers });
    res.end(body);
  };

  if (url.pathname === "/health") return send(200, "text/plain", "ok");

  // 1) Start checkout.
  if (url.pathname === "/buy" && req.method === "GET") {
    const email = url.searchParams.get("email") || "buyer@surroundspeaker.com";
    try {
      const { token } = await client.createSession({
        amount: PRICE_TL,
        currency: "TL",
        paymentType: "one_time",
        payerEmail: email,
        productDetailTextTr: "Surround Pro — sınırsız hoparlör",
        productDetailTextEn: "Surround Pro — unlimited speakers",
        successRedirectUrl: `${PUB}/done`,
        failRedirectUrl: `${PUB}/failed`,
        webhookUrl: `http://127.0.0.1:${PORT}/webhook?k=${encodeURIComponent(webhookSecret)}`,
        metadata: { plan: "pro", app: "surround-host" },
      });
      return send(302, "text/plain", "", {
        Location: checkoutUrl(token, "tr"),
        "Set-Cookie": `surround_buy_token=${token}; Path=/surround-buy; Max-Age=3600; Secure; HttpOnly; SameSite=Lax`,
      });
    } catch (e) {
      const msg = e instanceof PaymentClientError ? e.message : "payment error";
      return send(502, "text/plain", "Couldn't start checkout: " + msg);
    }
  }

  // 2) Webhook from the local pay backend — mint on confirmed payment.
  if (url.pathname === "/webhook" && req.method === "POST") {
    // Only the local pay backend knows the secret and posts directly (no proxy).
    if (!webhookSecret || url.searchParams.get("k") !== webhookSecret) {
      return send(403, "text/plain", "forbidden");
    }
    if (req.headers["x-forwarded-for"]) return send(403, "text/plain", "forbidden");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        if (body.status === "completed" && body.token && privateKey) {
          if (!keys[body.token]) {
            keys[body.token] = mintKey();
            saveKeys();
            console.log(`[mint] issued key for token ${String(body.token).slice(0, 8)}…`);
          }
        }
      } catch (e) {
        console.error("[webhook] bad payload:", e.message);
      }
      send(200, "text/plain", "OK");
    });
    return;
  }

  // 3) Key lookup for the success page poll.
  if (url.pathname === "/key" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    const key = keys[token];
    return send(200, "application/json", JSON.stringify(key ? { key } : { pending: true }));
  }

  // 4) Success page — show the key (from the cookie token).
  if (url.pathname === "/done" && req.method === "GET") {
    const token = readCookie(req, "surround_buy_token");
    const key = token ? keys[token] : null;
    const html = key ? doneReady(key) : donePending(token || "");
    return send(200, "text/html; charset=utf-8", html);
  }

  if (url.pathname === "/failed" && req.method === "GET") {
    return send(200, "text/html; charset=utf-8", failedPage());
  }

  send(404, "text/plain", "not found");
});

server.listen(PORT, () => console.log(`Surround buy service on :${PORT}`));
