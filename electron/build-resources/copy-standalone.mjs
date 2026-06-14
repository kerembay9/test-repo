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
console.log("Copied .next/static and public into .next/standalone");
