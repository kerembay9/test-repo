// Generates valid PNG icons with no image deps: a solid-brand app icon
// (icon.png, consumed by electron-builder to derive .icns/.ico) and a
// monochrome macOS template tray icon (trayTemplate.png).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// pixel(x, y) -> [r, g, b, a]
function png(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// App icon: 1024px, brand violet with a centered ring (surround = concentric).
const N = 1024;
const cx = N / 2, cy = N / 2;
const appIcon = png(N, (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  // background
  let px = [124, 58, 237, 255]; // violet-600
  // concentric rings
  for (const r of [180, 300, 420]) {
    if (Math.abs(d - r) < 26) px = [237, 233, 254, 255]; // violet-100
  }
  if (d < 70) px = [237, 233, 254, 255]; // center dot
  return px;
});
writeFileSync(join(here, "icon.png"), appIcon);

// Tray template: 32px, black alpha mask (macOS tints it). Concentric ring mark.
const T = 32;
const tcx = T / 2 - 0.5, tcy = T / 2 - 0.5;
const tray = png(T, (x, y) => {
  const d = Math.hypot(x - tcx, y - tcy);
  let a = 0;
  if (d < 3) a = 255;
  for (const r of [7, 12]) if (Math.abs(d - r) < 1.6) a = 255;
  return [0, 0, 0, a];
});
writeFileSync(join(here, "trayTemplate.png"), tray);

console.log("icons written: icon.png (1024), trayTemplate.png (32)");
