import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server (.next/standalone/server.js) so the
  // Electron desktop app can run the real Next.js Node server with its own
  // bundled runtime. The browser/web workflow is unaffected.
  output: "standalone",

  // `lib/sync/license.ts` reads the license file via a dynamic path, so Next's
  // file tracer can't statically resolve it and conservatively globs the whole
  // project into the standalone bundle. That pulled `dist/` (a prior packaged
  // app) into standalone, producing an infinitely self-nested app tree that
  // broke codesign. Exclude build outputs and non-server source trees — none
  // are needed by the Node server at runtime.
  outputFileTracingExcludes: {
    "*": [
      "dist/**",
      "dist-electron/**",
      "mobile/**",
      "electron/**",
      "licensing/**",
      "buy-service/**",
      "docs/**",
      ".git/**",
      ".next/cache/**",
    ],
  },
};

export default nextConfig;
