// Frames raw device captures into polished, consistent Play Store screenshots.
//
// Usage:
//   1. Capture screens on a phone/emulator (portrait). Drop the PNGs in
//      store-assets/_raw/ named 01.png, 02.png, … (order = listing order).
//   2. Edit CAPTIONS below (one line per screenshot, in the same order).
//   3. FONTCONFIG_FILE=./fonts.conf node frame-screenshots.js
//   Output: store-assets/screenshot-01.png … (1242x2688, on-brand frame).
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const RAW = path.resolve(__dirname, "../_raw");
const OUT = path.resolve(__dirname, "..");

const C = { field: "#0A0C16", fieldTop: "#10132A", ink: "#EEF0FB", signal: "#FF8A4C" };
const FDISPLAY = "Bricolage Grotesque ExtraBold";

// One caption per screenshot, in filename order. Edit to match your captures.
const CAPTIONS = [
  "Find a host on your Wi-Fi",
  "Join as a speaker in one tap",
  "Synced to the music, in real time",
  "Scan a QR code to connect",
];

const W = 1242,
  H = 2688;
const SHOT_W = 1000; // device capture is scaled to this width and centered

async function main() {
  if (!fs.existsSync(RAW)) {
    console.error(`No _raw folder. Create ${RAW} and add 01.png, 02.png, …`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(RAW)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  if (!files.length) {
    console.error(`No images in ${RAW}.`);
    process.exit(1);
  }

  for (let i = 0; i < files.length; i++) {
    const caption = CAPTIONS[i] || "";
    const shot = await sharp(path.join(RAW, files[i]))
      .resize({ width: SHOT_W })
      .png()
      .toBuffer();
    const shotMeta = await sharp(shot).metadata();
    const shotTop = Math.round(H * 0.18); // leave room for caption above
    const shotLeft = Math.round((W - shotMeta.width) / 2);

    const bg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${C.fieldTop}"/>
            <stop offset="1" stop-color="${C.field}"/>
          </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>
        <text x="${W / 2}" y="${Math.round(H * 0.105)}" text-anchor="middle"
              font-family="${FDISPLAY}" font-size="58" fill="${C.ink}">${escape(caption)}</text>
        <rect x="${W / 2 - 40}" y="${Math.round(H * 0.122)}" width="80" height="6" rx="3" fill="${C.signal}"/>
      </svg>`;

    const out = path.join(OUT, `screenshot-${String(i + 1).padStart(2, "0")}.png`);
    await sharp(Buffer.from(bg))
      .composite([{ input: shot, top: shotTop, left: shotLeft }])
      .flatten({ background: C.field })
      .png()
      .toFile(out);
    console.log(`wrote ${path.basename(out)}  (caption: "${caption}")`);
  }
}

function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
