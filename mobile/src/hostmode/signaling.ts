// Serverless LAN signaling for phone-host mode.
//
// WebRTC needs a channel to trade SDP + ICE before the peer connection exists.
// With no computer and no cloud, the HOST phone provides the rendezvous: a tiny
// on-device TCP listener that joining phones connect to, plus a Bonjour
// advertisement so they can find it. Once the WebRTC connection is up, the
// `ctrl` DataChannel takes over and these sockets can close.
//
// Frames are newline-delimited JSON (see protocol.ts). A TCP stream has no
// message boundaries, so we buffer and split on "\n".

import Zeroconf from "react-native-zeroconf";
import { encodeFrame, parseFrame } from "./protocol";
import type { SignalMsg } from "./protocol";
import { loadTcp } from "./native";
import type { TcpServerLike, TcpSocketLike } from "./native";

const SERVICE_TYPE = "surroundhost"; // Bonjour: _surroundhost._tcp
const DEFAULT_PORT = 41235; // distinct from the computer host's 3000/41234

/** A live signaling link to one peer: send frames, receive parsed frames. */
export interface SignalLink {
  readonly peerKey: string;
  send: (msg: SignalMsg) => void;
  onMessage: (cb: (msg: SignalMsg) => void) => void;
  close: () => void;
}

/** Wrap a raw TCP socket as a framed SignalLink. */
function linkFromSocket(socket: TcpSocketLike, peerKey: string): SignalLink {
  let buffer = "";
  let onMsg: (msg: SignalMsg) => void = () => {};

  socket.on("data", (chunk) => {
    buffer += String(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const msg = parseFrame<SignalMsg>(line);
      if (msg) onMsg(msg);
    }
  });

  return {
    peerKey,
    send: (msg) => socket.write(encodeFrame(msg)),
    onMessage: (cb) => {
      onMsg = cb;
    },
    close: () => {
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Host side: listen for guests on a TCP port and advertise via Bonjour. Each
 * accepted connection surfaces as a SignalLink the session uses to run the
 * WebRTC offer/answer with that guest.
 */
export class LanSignalHost {
  private server: TcpServerLike | null = null;
  private zeroconf: Zeroconf | null = null;
  private seq = 0;

  constructor(
    private hostName: string,
    private port: number = DEFAULT_PORT,
  ) {}

  /** Start listening + advertising. `onGuest` fires once per new connection. */
  start(onGuest: (link: SignalLink) => void): void {
    const tcp = loadTcp();
    this.server = tcp.createServer((socket) => {
      const key = `guest-${++this.seq}`;
      const link = linkFromSocket(socket, key);
      socket.on("close", () => link.close());
      onGuest(link);
    });
    this.server.listen({ port: this.port, host: "0.0.0.0" }, () => {
      this.advertise();
    });
  }

  private advertise(): void {
    try {
      this.zeroconf = new Zeroconf();
      // publishService(type, protocol, domain, name, port, txt)
      this.zeroconf.publishService(
        SERVICE_TYPE,
        "tcp",
        "local.",
        this.hostName,
        this.port,
        { name: this.hostName },
      );
    } catch {
      // Discovery degrades to manual QR (ip:port) if mDNS publish is blocked.
    }
  }

  stop(): void {
    try {
      this.zeroconf?.unpublishService(this.hostName);
      this.zeroconf?.stop();
    } catch {
      /* ignore */
    }
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    this.zeroconf = null;
    this.server = null;
  }
}

export interface DiscoveredHost {
  name: string;
  host: string;
  port: number;
}

/**
 * Guest side: browse for `_surroundhost._tcp` advertisements and dial the chosen
 * one. Discovery reuses react-native-zeroconf (already used for the computer
 * host browse on the onboarding screen).
 */
export class LanSignalGuest {
  private zeroconf: Zeroconf | null = null;

  /** Browse for phone hosts. `onFound` fires per resolved host. */
  browse(onFound: (h: DiscoveredHost) => void): () => void {
    try {
      this.zeroconf = new Zeroconf();
      this.zeroconf.on(
        "resolved",
        (s: { name?: string; addresses?: string[]; port?: number }) => {
          const ip = (s.addresses ?? []).find((a) =>
            /^\d+\.\d+\.\d+\.\d+$/.test(a),
          );
          if (ip && s.port) {
            onFound({ name: s.name ?? "Phone host", host: ip, port: s.port });
          }
        },
      );
      this.zeroconf.scan(SERVICE_TYPE, "tcp", "local.");
    } catch {
      /* mDNS unavailable; caller falls back to manual ip:port entry */
    }
    return () => this.stopBrowse();
  }

  stopBrowse(): void {
    try {
      this.zeroconf?.stop();
      this.zeroconf?.removeDeviceListeners?.();
    } catch {
      /* ignore */
    }
    this.zeroconf = null;
  }

  /** Open a signaling link to a host's ip:port. */
  connect(host: string, port: number): Promise<SignalLink> {
    const tcp = loadTcp();
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = tcp.createConnection({ host, port }, () => {
        settled = true;
        resolve(linkFromSocket(socket, `host-${host}:${port}`));
      });
      socket.on("error", (err) => {
        if (!settled) reject(err instanceof Error ? err : new Error("connect failed"));
      });
    });
  }
}

export { DEFAULT_PORT, SERVICE_TYPE };
