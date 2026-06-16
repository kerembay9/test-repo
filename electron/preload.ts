// Minimal, safe bridge exposed to the renderer. contextIsolation is on and
// nodeIntegration is off, so the host page gets no Node access — only this
// small, explicit surface. The host UI already works unmodified in the browser;
// these are conveniences a renderer can feature-detect via `window.surround`.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("surround", {
  isElectron: true,
  platform: process.platform,
  appVersion: process.env.npm_package_version ?? null,
  // shell isn't available in a sandboxed preload — go through main via IPC.
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // Native system-audio loopback (electron-audio-loopback). The renderer wraps
  // these around its own getDisplayMedia() call (the MediaStream can't cross the
  // context bridge, so capture must happen in the page).
  enableLoopbackAudio: () => ipcRenderer.invoke("enable-loopback-audio"),
  disableLoopbackAudio: () => ipcRenderer.invoke("disable-loopback-audio"),

  // macOS default-output control (SwitchAudioSource) for the BlackHole flow.
  audioListOutputs: (): Promise<string[]> => ipcRenderer.invoke("audio-list-outputs"),
  audioGetOutput: (): Promise<string> => ipcRenderer.invoke("audio-get-output"),
  audioSetOutput: (name: string): Promise<string> =>
    ipcRenderer.invoke("audio-set-output", name),
});
