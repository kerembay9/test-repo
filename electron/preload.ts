// Minimal, safe bridge exposed to the renderer. contextIsolation is on and
// nodeIntegration is off, so the host page gets no Node access — only this
// small, explicit surface. The host UI already works unmodified in the browser;
// these are conveniences a renderer can feature-detect via `window.surround`.

import { contextBridge, ipcRenderer, shell } from "electron";

contextBridge.exposeInMainWorld("surround", {
  isElectron: true,
  platform: process.platform,
  appVersion: process.env.npm_package_version ?? null,
  openExternal: (url: string) => shell.openExternal(url),
});

// Reserved for future main<->renderer messaging; harmless if unused.
void ipcRenderer;
