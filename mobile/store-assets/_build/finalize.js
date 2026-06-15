// Frames real emulator captures into Play-safe store screenshots.
// Device shots are 1080x2400 (2.22:1) which exceeds Play's 2:1 max, so each is
// scaled onto a brand-gradient canvas (1242x2208, 1.78:1) under a caption band.
// Render: FONTCONFIG_FILE=./fonts.conf node finalize.js
const sharp = require("sharp");
const path = require("path");

const RAW = path.resolve(__dirname, "../_raw");
const OUT = path.resolve(__dirname, "..");
const C = { field: "#0A0C16", fieldTop: "#10132A", ink: "#EEF0FB", signal: "#FF8A4C" };
const FDISPLAY = "Bricolage Grotesque ExtraBold";

const W = 1242,
  H = 2208; // 1.778:1 — within Play's 2:1 limit
const CAP_Y = 168; // caption baseline
const SHOT_TOP = 300; // shot starts below caption band

// shot file, caption, and optional mask rects {x,y,w,h} (in source 1080x2400 px)
const SHOTS = [
  { file: "_on.png", caption: "Join the sound field" },
  { file: "02_scanner.png", caption: "Scan the host's QR to join" },
  {
    file: "_c1.png",
    caption: "Playing in sync, in real time",
    mask: [{ x: 0, y: 2110, w: 220, h: 230 }], // hide Next.js dev badge
  },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  for (let i = 0; i < SHOTS.length; i++) {
    const { file, caption, mask } = SHOTS[i];
    let img = sharp(path.join(RAW, file));

    // paint over any dev-only overlays before scaling
    if (mask && mask.length) {
      const overlays = mask.map((m) => ({
        input: {
          create: { width: m.w, height: m.h, channels: 4, background: C.field },
        },
        top: m.y,
        left: m.x,
      }));
      const masked = await img.composite(overlays).png().toBuffer();
      img = sharp(masked);
    }

    const avail = H - SHOT_TOP - 80; // bottom padding
    const shot = await img.resize({ height: avail }).png().toBuffer();
    const sm = await sharp(shot).metadata();
    const left = Math.round((W - sm.width) / 2);

    const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.fieldTop}"/><stop offset="1" stop-color="${C.field}"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <text x="${W / 2}" y="${CAP_Y}" text-anchor="middle" font-family="${FDISPLAY}" font-size="62" fill="${C.ink}">${esc(caption)}</text>
      <rect x="${W / 2 - 44}" y="${CAP_Y + 36}" width="88" height="7" rx="3.5" fill="${C.signal}"/>
    </svg>`;

    const out = path.join(OUT, `screenshot-${String(i + 1).padStart(2, "0")}.png`);
    await sharp(Buffer.from(bg))
      .composite([{ input: shot, top: SHOT_TOP, left }])
      .flatten({ background: C.field })
      .png()
      .toFile(out);
    console.log(`wrote ${path.basename(out)}  "${caption}"  (${sm.width}x${sm.height} shot)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
