// Generates Play Store graphics from the app's real brand (see App.tsx `C`/`F`).
// Render: FONTCONFIG_FILE=./fonts.conf node build.js
const sharp = require("sharp");
const path = require("path");

const OUT = path.resolve(__dirname, "..");

// Brand tokens, copied from mobile/App.tsx
const C = {
  field: "#0A0C16",
  fieldTop: "#10132A",
  raise: "#161A2C",
  line: "#2A3050",
  ink: "#EEF0FB",
  inkSoft: "#888FB5",
  signal: "#FF8A4C",
  live: "#6BE5D8",
};
const FDISPLAY = "Bricolage Grotesque ExtraBold";
const FLIGHT = "Bricolage Grotesque Light";
const FBODY = "Inter";

// A sonar field: concentric rings + a glowing node, the app's signature.
function soundField(cx, cy, max, color, { rings = 5, nodeR = 9, base = 0.07, span = 0.16, glow = 6 } = {}) {
  let s = "";
  for (let i = rings; i >= 1; i--) {
    const r = (max * i) / rings;
    const op = base + span * (1 - (i - 1) / rings);
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${1.5 + (rings - i) * 0.3}" opacity="${op.toFixed(3)}"/>`;
  }
  // soft glow halo behind the node
  s += `<circle cx="${cx}" cy="${cy}" r="${nodeR * glow}" fill="url(#nodeGlow)"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${nodeR}" fill="${color}"/>`;
  return s;
}

const defs = `
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.fieldTop}"/>
      <stop offset="1" stop-color="${C.field}"/>
    </linearGradient>
    <radialGradient id="nodeGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.signal}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${C.signal}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${C.signal}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

// ---- 512x512 app icon -------------------------------------------------------
function iconSvg() {
  const s = 512;
  const cx = s / 2,
    cy = s / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    ${defs}
    <rect width="${s}" height="${s}" fill="url(#field)"/>
    ${soundField(cx, cy - 4, 210, C.signal, { rings: 4, nodeR: 30, base: 0.22, span: 0.5, glow: 4 })}
  </svg>`;
}

// ---- 1024x500 feature graphic ----------------------------------------------
function featureSvg() {
  const w = 1024,
    h = 500;
  const fcx = 800,
    fcy = 250;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${defs}
    <rect width="${w}" height="${h}" fill="url(#field)"/>
    ${soundField(fcx, fcy, 360, C.signal, { rings: 6, nodeR: 11 })}
    <text x="72" y="214" font-family="${FDISPLAY}" font-size="76" letter-spacing="1" fill="${C.ink}">SURROUND</text>
    <text x="74" y="286" font-family="${FLIGHT}" font-size="72" letter-spacing="22" fill="${C.signal}">SPEAKER</text>
    <text x="74" y="356" font-family="${FBODY}" font-weight="400" font-size="25" fill="${C.inkSoft}">Turn every phone in the room into one</text>
    <text x="74" y="392" font-family="${FBODY}" font-weight="400" font-size="25" fill="${C.inkSoft}">speaker, synced to the music on your computer.</text>
  </svg>`;
}

async function main() {
  await sharp(Buffer.from(iconSvg()))
    .png()
    .toFile(path.join(OUT, "play-icon-512.png"));
  console.log("wrote play-icon-512.png");

  // Feature graphic must be flattened (no alpha) per Play requirements.
  await sharp(Buffer.from(featureSvg()))
    .flatten({ background: C.field })
    .png()
    .toFile(path.join(OUT, "feature-graphic-1024x500.png"));
  console.log("wrote feature-graphic-1024x500.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
