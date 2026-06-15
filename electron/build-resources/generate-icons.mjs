// Generates the app's icons with no image deps, drawn to match the landing
// page's "sound field" mark: a dark rounded-square tile with glowing violet
// concentric rings and a bright center source.
//
// Outputs:
//   icon.png         1024  — electron-builder derives .icns/.ico from this
//   trayTemplate.png 32    — monochrome macOS menu-bar template
//   favicon.ico      256   — written into ../../app/favicon.ico for the Next app
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..", "app");

/* ---------- PNG encoder ---------- */
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
// pixel(x, y) -> [r, g, b, a] (0-255)
function pngBytes(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
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

/* ---------- helpers ---------- */
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// soft 0..1 band peaking at edge=0, fading over `feather`
const band = (dist, feather) => Math.max(0, 1 - Math.abs(dist) / feather);
const mix = (a, b, t) => a + (b - a) * t;
function over(dst, src) {
  // src/dst = [r,g,b,a 0..1]; returns straight-alpha composite
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a === 0) return [0, 0, 0, 0];
  const f = (i) => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a;
  return [f(0), f(1), f(2), a];
}
// signed distance to a rounded square (negative = inside)
function sdRoundRect(x, y, cx, cy, half, r) {
  const qx = Math.abs(x - cx) - (half - r);
  const qy = Math.abs(y - cy) - (half - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* ---------- the mark ---------- */
// Brand palette matched to the Android app icon: a luminous orange center
// source radiating orange rings over a deep navy field.
const BG_TOP = [0x10, 0x13, 0x2a];   // deep navy
const BG_BOT = [0x0d, 0x0f, 0x20];   // near-black navy
const RING = [0xf2, 0x8a, 0x4e];     // warm orange stroke
const CORE = [0xff, 0x8a, 0x4c];     // bright orange
const CORE_C = [0xff, 0x8a, 0x4c];

function paintIcon(size) {
  const s = size;
  const c = s / 2;
  const margin = s * 0.085;          // transparent breathing room
  const half = c - margin;
  const radius = s * 0.225;          // macOS-ish squircle corner
  const aa = s / 256;                // ~1px feather scaled to resolution
  // ring geometry as fractions of half-size (four rings, matching Android mark)
  const rings = [0.30, 0.50, 0.70, 0.90].map((f) => f * half);
  const ringW = s * 0.018;

  return (x, y) => {
    const sd = sdRoundRect(x, y, c, c, half, radius);
    const inside = 1 - Math.min(Math.max((sd + aa) / (2 * aa), 0), 1); // AA coverage
    if (inside <= 0) return [0, 0, 0, 0];

    // background vertical gradient
    const t = y / s;
    let col = [
      mix(BG_TOP[0], BG_BOT[0], t),
      mix(BG_TOP[1], BG_BOT[1], t),
      mix(BG_TOP[2], BG_BOT[2], t),
      1,
    ];

    const d = Math.hypot(x - c, y - c);

    // concentric rings with a soft outward glow
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const core = band(d - r, ringW) ** 1.5;          // crisp stroke
      const glow = band(d - r, ringW * 6) * 0.28;       // halo
      const fade = 1 - i * 0.18;                         // outer rings dimmer
      const a = Math.min(1, core + glow) * fade;
      if (a > 0) col = over(col, [RING[0], RING[1], RING[2], a]);
    }

    // luminous center source — a bold filled orange dot with a soft halo
    const coreR = half * 0.14;
    const solid = 1 - Math.min(Math.max((d - coreR + aa) / (2 * aa), 0), 1); // crisp disc
    const coreA = Math.min(1, solid + band(d, coreR * 3) * 0.3);
    if (coreA > 0) col = over(col, [CORE_C[0], CORE_C[1], CORE_C[2], coreA]);

    return [clamp(col[0]), clamp(col[1]), clamp(col[2]), clamp(inside * 255)];
  };
}

/* ---------- ICO (single PNG entry) ---------- */
function icoFromPng(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: icon
  header.writeUInt16LE(1, 4);  // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 == 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0;  // palette
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1, 4);   // color planes
  entry.writeUInt16LE(32, 6);  // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png]);
}

/* ---------- write ---------- */
writeFileSync(join(here, "icon.png"), pngBytes(1024, paintIcon(1024)));

// Tray template: monochrome (black alpha), macOS tints it. Rings + dot.
const T = 32, tc = T / 2 - 0.5;
const tray = pngBytes(T, (x, y) => {
  const d = Math.hypot(x - tc, y - tc);
  let a = 0;
  if (d < 2.4) a = 255;
  for (const r of [7, 12]) a = Math.max(a, band(d - r, 1.3) * 255);
  return [0, 0, 0, clamp(a)];
});
writeFileSync(join(here, "trayTemplate.png"), tray);

// Favicon for the Next app (app/favicon.ico) — a 256px PNG wrapped in ICO.
writeFileSync(join(appDir, "favicon.ico"), icoFromPng(pngBytes(256, paintIcon(256)), 256));

console.log("icons written: icon.png (1024), trayTemplate.png (32), app/favicon.ico (256)");
