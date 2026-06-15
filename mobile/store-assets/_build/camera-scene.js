// Synthesizes a believable QR-scanner screen for screenshot-02 (no real camera
// on the emulator gives a usable shot). A dim warm room with the host's screen
// showing a real scannable QR, plus the app's actual scanner chrome (reticle,
// prompt, Cancel) from App.tsx. Output: store-assets/_raw/02_scanner.png (1080x2400).
const sharp = require("sharp");
const QRCode = require("qrcode");
const path = require("path");

const OUT = path.resolve(__dirname, "../_raw/02_scanner.png");
const W = 1080,
  H = 2400;
const C = { field: "#0A0C16", signal: "#FF8A4C", ink: "#1A0E06" };

const CX = 540,
  CY = 1120; // scene + reticle center

async function main() {
  // Real, scannable QR for the host address the app would join.
  const qrPng = await QRCode.toBuffer("http://192.168.1.45:3002", {
    margin: 1,
    width: 460,
    color: { dark: "#0A0C16", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });

  // --- camera backdrop: a dim, warm room (blurred, as a camera would see it) ---
  const backdrop = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="room" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="#1b160f"/>
        <stop offset="0.55" stop-color="#100d0a"/>
        <stop offset="1" stop-color="#070605"/>
      </linearGradient>
      <radialGradient id="lamp" cx="0.18" cy="0.12" r="0.7">
        <stop offset="0" stop-color="#5a3d1f" stop-opacity="0.8"/>
        <stop offset="0.5" stop-color="#2a1d10" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#room)"/>
    <rect width="${W}" height="${H}" fill="url(#lamp)"/>
    <!-- a desk plane near the bottom -->
    <polygon points="0,1700 ${W},1560 ${W},${H} 0,${H}" fill="#0b0907" opacity="0.7"/>
    <polygon points="0,1700 ${W},1560 ${W},1640 0,1820" fill="#3a2c1a" opacity="0.25"/>
  </svg>`;
  const bg = await sharp(Buffer.from(backdrop)).blur(7).png().toBuffer();

  // --- the host's screen showing the QR (the focused subject; kept crisp) ---
  const panelW = 700,
    panelH = 700;
  const panel = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}">
    <defs>
      <radialGradient id="screenGlow" cx="0.5" cy="0.42" r="0.6">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="40" y="40" width="${panelW - 80}" height="${panelH - 80}" rx="34" fill="#15161c"/>
    <rect x="64" y="64" width="${panelW - 128}" height="${panelH - 128}" rx="22" fill="#f6f6f1"/>
    <rect width="${panelW}" height="${panelH}" fill="url(#screenGlow)"/>
    <text x="${panelW / 2}" y="${panelH - 96}" text-anchor="middle"
          font-family="Inter" font-weight="600" font-size="26" fill="#6b7088"
          letter-spacing="2">SCAN TO JOIN</text>
  </svg>`;
  const panelBuf = await sharp(Buffer.from(panel)).png().toBuffer();
  const pm = await sharp(panelBuf).metadata();

  // --- app scanner chrome (crisp overlay) ---
  const rW = 720,
    rH = 720;
  const rx = CX - rW / 2,
    ry = CY - rH / 2;
  const overlay = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <!-- status bar -->
    <text x="40" y="64" font-family="Inter" font-weight="600" font-size="34" fill="#ffffff">9:53</text>
    <g fill="#ffffff">
      <rect x="940" y="40" width="36" height="22" rx="3"/>
      <rect x="986" y="34" width="54" height="28" rx="6" opacity="0.95"/>
    </g>
    <!-- vignette for camera feel -->
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>
    <!-- prompt -->
    <text x="${CX}" y="150" text-anchor="middle" font-family="Inter" font-weight="500"
          font-size="40" fill="#ffffff">Point at the host's QR code</text>
    <!-- reticle -->
    <rect x="${rx}" y="${ry}" width="${rW}" height="${rH}" rx="60"
          fill="none" stroke="${C.signal}" stroke-width="6" opacity="0.95"/>
    <!-- corner ticks -->
    ${corner(rx, ry, 1, 1)}${corner(rx + rW, ry, -1, 1)}${corner(rx, ry + rH, 1, -1)}${corner(rx + rW, ry + rH, -1, -1)}
    <!-- cancel pill -->
    <rect x="${CX - 140}" y="2090" width="280" height="104" rx="52" fill="${C.signal}"/>
    <text x="${CX}" y="2158" text-anchor="middle" font-family="Inter" font-weight="700"
          font-size="40" fill="${C.ink}">Cancel</text>
  </svg>`;

  await sharp(bg)
    .composite([
      { input: panelBuf, top: Math.round(CY - pm.height / 2), left: Math.round(CX - pm.width / 2) },
      { input: qrPng, top: Math.round(CY - 230 - 30), left: Math.round(CX - 230) },
      { input: Buffer.from(overlay), top: 0, left: 0 },
    ])
    .png()
    .toFile(OUT);
  console.log("wrote", path.relative(process.cwd(), OUT));
}

// L-shaped focus tick at a reticle corner; dx/dy give direction into the frame.
function corner(x, y, dx, dy) {
  const len = 46,
    off = 0;
  return `<path d="M ${x} ${y + dy * len} L ${x} ${y + off} L ${x + dx * len} ${y + off}"
    fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity="0.9"/>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
