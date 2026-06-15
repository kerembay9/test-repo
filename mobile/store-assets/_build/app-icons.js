// Regenerates the in-app launcher + splash icons in mobile/assets/ on-brand
// (dark indigo field, orange sonar node + rings), replacing the old guide-line
// blue-chevron art. Matches the Play store icon (build.js).
// Render: FONTCONFIG_FILE not needed (no text). node app-icons.js
const sharp = require("sharp");
const path = require("path");

const ASSETS = path.resolve(__dirname, "../../assets");
const C = { field: "#0A0C16", fieldTop: "#10132A", signal: "#FF8A4C" };

// rings + glowing node, centered at (cx,cy). color/opacity tunable.
function field(cx, cy, max, color, { rings = 4, nodeR = 30, base = 0.22, span = 0.5, glow = true, glowId = "ng" } = {}) {
  let s = "";
  for (let i = rings; i >= 1; i--) {
    const r = (max * i) / rings;
    const op = base + span * (1 - (i - 1) / rings);
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${(nodeR / 12) + (rings - i) * 0.4}" opacity="${op.toFixed(3)}"/>`;
  }
  if (glow) s += `<circle cx="${cx}" cy="${cy}" r="${nodeR * 4}" fill="url(#${glowId})"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${nodeR}" fill="${color}"/>`;
  return s;
}

const glowDef = (id) => `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="${C.signal}" stop-opacity="0.55"/>
  <stop offset="0.5" stop-color="${C.signal}" stop-opacity="0.12"/>
  <stop offset="1" stop-color="${C.signal}" stop-opacity="0"/></radialGradient>`;
const fieldDef = `<linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.fieldTop}"/><stop offset="1" stop-color="${C.field}"/></linearGradient>`;

function svg(size, body, defs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs}</defs>${body}</svg>`;
}

async function write(name, buf) {
  await sharp(buf).png().toFile(path.join(ASSETS, name));
  console.log("wrote assets/" + name);
}

async function main() {
  // 1024 launcher base — full field square (like the store icon)
  await write(
    "icon.png",
    Buffer.from(
      svg(1024, `<rect width="1024" height="1024" fill="url(#field)"/>${field(512, 508, 420, C.signal, { nodeR: 60, glowId: "ng" })}`, fieldDef + glowDef("ng")),
    ),
  );

  // adaptive background — solid field gradient
  await write("android-icon-background.png", Buffer.from(svg(512, `<rect width="512" height="512" fill="url(#field)"/>`, fieldDef)));

  // adaptive foreground — mark only, within the center-66% safe zone, transparent
  await write(
    "android-icon-foreground.png",
    Buffer.from(svg(512, field(256, 256, 150, C.signal, { nodeR: 26, glowId: "ng" }), glowDef("ng"))),
  );

  // monochrome (themed icon) — white silhouette, transparent, safe zone
  await write(
    "android-icon-monochrome.png",
    Buffer.from(svg(432, field(216, 216, 124, "#ffffff", { nodeR: 24, glow: false }))),
  );

  // splash — orange mark centered on transparent (sits on #0a0a0a backgroundColor)
  await write(
    "splash-icon.png",
    Buffer.from(svg(1024, field(512, 512, 250, C.signal, { nodeR: 42, glowId: "ng" }), glowDef("ng"))),
  );

  // favicon — tiny: render the field icon at high res then downscale for crispness
  const fav = Buffer.from(svg(256, `<rect width="256" height="256" fill="url(#field)"/>${field(128, 127, 96, C.signal, { rings: 3, nodeR: 22, glowId: "ng" })}`, fieldDef + glowDef("ng")));
  await sharp(fav).resize(48, 48).png().toFile(path.join(ASSETS, "favicon.png"));
  console.log("wrote assets/favicon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
