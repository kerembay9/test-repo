// Clock reference endpoint. Clients hit this repeatedly and use Cristian's
// algorithm (min round-trip sample) to estimate the offset between their local
// clock and the server clock. Keep the handler as thin as possible so the
// timestamp reflects the moment of response, not request parsing.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return new Response(JSON.stringify({ t: Date.now() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
