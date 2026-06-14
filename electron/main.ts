// Electron main process for Surround.
//
// Surround is a LAN server: phones join the host over HTTP and the host runs
// the real Next.js Node server (SSE, mDNS, upload, time-sync — all Node-only).
// So this process spawns the Next.js *standalone* server (built with
// `output: "standalone"`) bound to 0.0.0.0 so phones on the Wi-Fi can reach it,
// then opens a window pointed at http://localhost:<port>/ (a secure context,
// required for audio capture).

import { app, BrowserWindow, Tray, Menu, clipboard, shell, nativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import path from "node:path";
import { networkInterfaces } from "node:os";

const DEFAULT_PORT = 41234;

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort = DEFAULT_PORT;
let isQuitting = false;

/** Resolve a free TCP port, preferring `preferred`, else an OS-assigned one. */
function findPort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const tryListen = (port: number, allowFallback: boolean) => {
      const srv = createServer();
      srv.once("error", () => {
        srv.close();
        if (allowFallback) tryListen(0, false);
        else resolve(DEFAULT_PORT);
      });
      srv.listen({ port, host: "0.0.0.0" }, () => {
        const addr = srv.address();
        const got = typeof addr === "object" && addr ? addr.port : port;
        srv.close(() => resolve(got));
      });
    };
    tryListen(preferred, true);
  });
}

/** Absolute path to the Next.js standalone server directory. */
function standaloneDir(): string {
  // Packaged: shipped as an extraResource under resources/standalone.
  // Dev: built into <repo>/.next/standalone.
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(app.getAppPath(), ".next", "standalone");
}

/** Spawn the standalone server using Electron's bundled Node, bound to LAN. */
function startServer(port: number): Promise<void> {
  const dir = standaloneDir();
  const serverJs = path.join(dir, "server.js");

  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      // Bind all interfaces so phones on the LAN can connect; the window
      // itself still loads via localhost for a secure context.
      HOSTNAME: "0.0.0.0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProcess.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (!isQuitting) {
      console.error(`Next server exited unexpectedly (code ${code}); quitting.`);
      app.quit();
    }
  });

  return waitForServer(port);
}

/** Poll localhost:<port> until the server answers (or time out). */
function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server did not start in time"));
        else setTimeout(ping, 250);
      });
    };
    ping();
  });
}

/** First private LAN IPv4 address, for the join link shown to phones. */
function lanAddress(): string | null {
  const ips: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254")) {
        ips.push(net.address);
      }
    }
  }
  ips.sort((a, b) => rank(a) - rank(b));
  return ips[0] ?? null;
}
function rank(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (ip.startsWith("172.")) return 2;
  return 3;
}

function joinUrl(): string {
  const ip = lanAddress();
  return ip ? `http://${ip}:${serverPort}/speaker` : `http://localhost:${serverPort}/speaker`;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Surround",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}/`);

  // Close hides to tray instead of quitting (menu-bar-app feel).
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
  img.setTemplateImage(true); // monochrome auto-tint on macOS menu bar
  return img;
}

function buildTrayMenu(): Menu {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    {
      label: "Show Surround",
      click: () => {
        if (!mainWindow) createWindow();
        else mainWindow.show();
      },
    },
    {
      label: "Copy join link",
      click: () => clipboard.writeText(joinUrl()),
    },
    { type: "separator" },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { type: "separator" },
    {
      label: "Quit Surround",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  tray = new Tray(trayImage());
  tray.setToolTip("Surround");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (!mainWindow) createWindow();
    else mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// Single instance: focus the existing window instead of launching twice.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    serverPort = await findPort(DEFAULT_PORT);
    try {
      await startServer(serverPort);
    } catch (err) {
      console.error("Failed to start Next server:", err);
      app.quit();
      return;
    }
    createTray();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  // Keep running in the tray when all windows are closed (all platforms).
  app.on("window-all-closed", () => {
    /* stay alive in tray; quit only via tray/menu */
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopServer();
  });
  app.on("will-quit", stopServer);
}

// Optional: open external links from the renderer in the system browser.
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
});
