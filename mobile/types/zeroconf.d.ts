declare module "react-native-zeroconf" {
  export interface Service {
    name?: string;
    fullName?: string;
    host?: string;
    port?: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
  }

  export default class Zeroconf {
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners?(): void;
    on(event: "resolved", cb: (service: Service) => void): void;
    on(event: "error", cb: (err: unknown) => void): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
}
