// Guarded, lazy loaders for the native modules phone-host mode needs.
//
// These modules (react-native-webrtc, react-native-tcp-socket) only exist in a
// dev build / prebuild — never in Expo Go. We load them lazily so that:
//   - the rest of the hostmode/ code typechecks and imports cleanly, and
//   - on a runtime without them, the host option shows ONE friendly message
//     ("needs a dev build") instead of crashing the whole app at import time.
//
// Every consumer goes through these helpers; nothing else imports the native
// packages directly.

export class NativeUnavailableError extends Error {
  constructor(moduleName: string) {
    super(
      `Phone-host mode needs the "${moduleName}" native module, which isn't ` +
        `in this build. Phone-host mode requires a dev build (npx expo prebuild ` +
        `&& expo run:ios|android) — it can't run in Expo Go.`,
    );
    this.name = "NativeUnavailableError";
  }
}

/** True if both native modules are present (i.e. phone-host mode can run). */
export function isHostModeAvailable(): boolean {
  return tryRequire("react-native-webrtc") != null &&
    tryRequire("react-native-tcp-socket") != null;
}

// We intentionally use require() (not import) so a missing module is a catchable
// runtime condition rather than a hard module-resolution failure at load time.
function tryRequire(name: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name);
  } catch {
    return null;
  }
}

function need(name: string): unknown {
  const mod = tryRequire(name);
  if (mod == null) throw new NativeUnavailableError(name);
  return mod;
}

/** react-native-webrtc surface used by the session layer. */
export interface WebrtcModule {
  RTCPeerConnection: new (config?: unknown) => RTCPeerConnectionLike;
  RTCSessionDescription: new (init: unknown) => unknown;
  RTCIceCandidate: new (init: unknown) => unknown;
  mediaDevices: {
    getUserMedia: (constraints: unknown) => Promise<MediaStreamLike>;
  };
}

/** Minimal structural types so the session code stays honest without DOM libs. */
export interface RTCPeerConnectionLike {
  createOffer: (opts?: unknown) => Promise<{ type: string; sdp: string }>;
  createAnswer: (opts?: unknown) => Promise<{ type: string; sdp: string }>;
  setLocalDescription: (desc: unknown) => Promise<void>;
  setRemoteDescription: (desc: unknown) => Promise<void>;
  addIceCandidate: (candidate: unknown) => Promise<void>;
  addTrack: (track: unknown, stream: unknown) => unknown;
  createDataChannel: (label: string, opts?: unknown) => DataChannelLike;
  close: () => void;
  ontrack: ((e: { streams: MediaStreamLike[]; track: unknown }) => void) | null;
  ondatachannel: ((e: { channel: DataChannelLike }) => void) | null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  connectionState: string;
}

export interface DataChannelLike {
  label: string;
  readyState: string;
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
}

export interface MediaStreamLike {
  getTracks: () => unknown[];
  getAudioTracks: () => unknown[];
}

/** react-native-tcp-socket surface used by the signaling layer. */
export interface TcpModule {
  createServer: (onConnection: (socket: TcpSocketLike) => void) => TcpServerLike;
  createConnection: (
    opts: { host: string; port: number },
    onConnect?: () => void,
  ) => TcpSocketLike;
}

export interface TcpServerLike {
  listen: (opts: { port: number; host: string }, cb?: () => void) => void;
  close: () => void;
  address: () => { port: number } | null;
}

export interface TcpSocketLike {
  write: (data: string) => void;
  destroy: () => void;
  on: (event: "data" | "error" | "close", cb: (arg?: unknown) => void) => void;
}

export function loadWebrtc(): WebrtcModule {
  return need("react-native-webrtc") as WebrtcModule;
}

export function loadTcp(): TcpModule {
  return need("react-native-tcp-socket") as TcpModule;
}
