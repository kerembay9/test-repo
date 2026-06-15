// Frames real Pixel_Tablet captures (1600x2560 portrait) into Play tablet
// screenshots at two sizes: 10" (1600x2560) and 7" (1200x1920). Both 1.6:1.
// Render: FONTCONFIG_FILE=./fonts.conf node finalize-tablets.js
const sharp = require("sharp");
const path = require("path");

const RAW = path.resolve(__dirname, "../_raw_tab");
const OUT = path.resolve(__dirname, "..");
const C = { field: "#0A0C16", fieldTop: "#10132A", ink: "#EEF0FB", signal: "#FF8A4C" };
const FDISPLAY = "Bricolage Grotesque ExtraBold";

const SHOTS = [
  { file: "_on3.png", caption: "Join the sound field" },
  {
    file: "_r2.png",
    caption: "Playing in sync, in real time",
    mask: [{ x: 0, y: 2330, w: 220, h: 230 }], // Next.js dev badge
  },
];

// size presets: canvas WxH, caption baseline, top band height, font size
const SIZES = [
  { tag: "10in", W: 1600, H: 2560, cap: 150, band: 250, fs: 64 },
  { tag: "7in", W: 1200, H: 1920, cap: 116, band: 190, fs: 50 },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  for (let s = 0; s < SHOTS.length; s++) {
    const { file, caption, mask } = SHOTS[s];
    let base = sharp(path.join(RAW, file));
    if (mask && mask.length) {
      const ov = mask.map((m) => ({
        input: { create: { width: m.w, height: m.h, channels: 4, background: C.field } },
        top: m.y,
        left: m.x,
      }));
      base = sharp(await base.composite(ov).png().toBuffer());
    }
    const maskedBuf = await base.png().toBuffer();

    for (const z of SIZES) {
      const availH = z.H - z.band - Math.round(z.H * 0.03);
      const shot = await sharp(maskedBuf).resize({ height: availH }).png().toBuffer();
      const sm = await sharp(shot).metadata();
      const left = Math.round((z.W - sm.width) / 2);

      const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${z.W}" height="${z.H}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${C.fieldTop}"/><stop offset="1" stop-color="${C.field}"/>
        </linearGradient></defs>
        <rect width="${z.W}" height="${z.H}" fill="url(#g)"/>
        <text x="${z.W / 2}" y="${z.cap}" text-anchor="middle" font-family="${FDISPLAY}" font-size="${z.fs}" fill="${C.ink}">${esc(caption)}</text>
        <rect x="${z.W / 2 - 44}" y="${z.cap + 34}" width="88" height="7" rx="3.5" fill="${C.signal}"/>
      </svg>`;

      const out = path.join(OUT, `tablet-${z.tag}-${String(s + 1).padStart(2, "0")}.png`);
      await sharp(Buffer.from(bg))
        .composite([{ input: shot, top: z.band, left }])
        .flatten({ background: C.field })
        .png()
        .toFile(out);
      console.log(`wrote ${path.basename(out)}  "${caption}"`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
