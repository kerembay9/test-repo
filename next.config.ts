import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server (.next/standalone/server.js) so the
  // Electron desktop app can run the real Next.js Node server with its own
  // bundled runtime. The browser/web workflow is unaffected.
  output: "standalone",
};

export default nextConfig;
