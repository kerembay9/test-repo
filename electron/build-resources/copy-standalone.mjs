// Next's `output: "standalone"` does NOT copy `.next/static` or `public` into
// the standalone tree — they must be placed alongside server.js for assets to
// serve. Run this after `next build`. Cross-platform (no shell cp).
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("No .next/standalone — run `next build` with output:'standalone' first.");
  process.exit(1);
}

cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

// Next 16's Turbopack `output: "standalone"` tracer copies the app-page and
// pages runtimes into the bundle but misses `app-route-*.runtime.*` — the
// runtime every App-Router route handler `externalRequire`s. On a dev machine
// Node falls back to the hoisted `node_modules/next`, so it's invisible there;
// inside the packaged/installed app there's no fallback, so every /api/* route
// throws "Cannot find module app-route-turbo.runtime.prod.js" and returns 500.
// Copy the whole compiled next-server runtime dir to guarantee resolution.
const compiledRel = join("node_modules", "next", "dist", "compiled", "next-server");
const compiledSrc = join(root, compiledRel);
if (existsSync(compiledSrc)) {
  cpSync(compiledSrc, join(standalone, compiledRel), { recursive: true });
  console.log("Copied next/dist/compiled/next-server runtimes into .next/standalone");
}

console.log("Copied .next/static and public into .next/standalone");
