// Standalone Surround Pro buy endpoint. Runs on a server you control (EC2) so
// the horizon-pay secret never ships to clients. GET /buy creates a 500 TL
// session and 302-redirects to the PayTR checkout.
//
//   HORIZON_PAY_API_KEY=... PORT=8787 node server.mjs
import http from "node:http";
import { PaymentClient, PaymentClientError } from "@kerembay9/horizon-pay";

const PORT = Number(process.env.PORT) || 8787;
const apiKey = process.env.HORIZON_PAY_API_KEY;
if (!apiKey) {
  console.error("HORIZON_PAY_API_KEY is required");
  process.exit(1);
}

const PRICE_TL = 600;
const PAY_BASE = "https://pay.horizonzeta.com";
const SUCCESS_URL = "https://surround-speaker.expo.app/success.html";
const FAIL_URL = "https://surround-speaker.expo.app/failed.html";

const client = new PaymentClient({ baseUrl: PAY_BASE, apiKey });

// The published client's getCheckoutUrl still builds the old "/tr?token=" path
// (404 on the current pay app). The live checkout is "/?token=...&language=tr".
function checkoutUrl(token, language = "tr") {
  return `${PAY_BASE}/?token=${encodeURIComponent(token)}&language=${language}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

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
        successRedirectUrl: SUCCESS_URL,
        failRedirectUrl: FAIL_URL,
        metadata: { plan: "pro", app: "surround-host" },
      });
      res.writeHead(302, { Location: checkoutUrl(token, "tr") });
      return res.end();
    } catch (e) {
      const msg = e instanceof PaymentClientError ? e.message : "payment error";
      res.writeHead(502, { "content-type": "text/plain" });
      return res.end("Couldn't start checkout: " + msg);
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => console.log(`Surround buy service listening on :${PORT}`));
