// Starts a Surround Pro purchase: creates a horizon-pay session (server-side,
// using the secret API key) and redirects the buyer to the PayTR checkout.
//
// SECURITY: HORIZON_PAY_API_KEY is a backend secret and must never ship inside
// the distributed desktop app. This route only works where the key is present
// in the server environment — for public distribution, host this endpoint on a
// server you control and point the host's Buy button at it.

import { PaymentClient, PaymentClientError } from "@kerembay9/horizon-pay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRICE_TL = 500;
const SUCCESS_URL = "https://surround-speaker.expo.app/success.html";
const FAIL_URL = "https://surround-speaker.expo.app/failed.html";

export async function GET(req: Request) {
  const apiKey = process.env.HORIZON_PAY_API_KEY;
  if (!apiKey) {
    return new Response("Purchasing isn't configured on this host.", { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email") || "buyer@surroundspeaker.com";

  const client = new PaymentClient({ baseUrl: "https://pay.horizonzeta.com", apiKey });
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
    return Response.redirect(client.getCheckoutUrl(token, "tr"), 302);
  } catch (e) {
    const msg = e instanceof PaymentClientError ? e.message : "payment error";
    return new Response("Couldn't start checkout: " + msg, { status: 502 });
  }
}
