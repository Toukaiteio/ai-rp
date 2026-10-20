import { configureBackends, type StorageAdapter } from "./backend";

type AndroidBridge = {
  storageGet(scope: string, key: string): string | null;
  storageSet(scope: string, key: string, value: string): void;
  storageRemove(scope: string, key: string): void;
  storageKeys(scope: string): string;
  storageClear(scope: string): void;
  /** Native code should resolve with JSON: { name, type, data: base64 }. */
  pickFile?: (accept: string) => string | null | Promise<string | null>;
};

export type NativeFile = {
  name: string;
  type: string;
  data: string;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridge;
  }
}

function bridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  return window.AndroidBridge ?? null;
}

export function isAndroidApp(): boolean {
  return bridge() !== null;
}

export function hasNativeFilePicker(): boolean {
  return isAndroidApp() && typeof bridge()?.pickFile === "function";
}

export async function pickNativeFile(accept: string): Promise<File | null> {
  const api = bridge();
  if (!api?.pickFile) return null;
  const raw = await api.pickFile(accept);
  if (!raw) return null;
  let payload: NativeFile;
  try {
    payload = JSON.parse(raw) as NativeFile;
  } catch {
    throw new Error("Android 文件选择器返回了无效数据");
  }
  if (!payload || typeof payload.name !== "string" || typeof payload.data !== "string") {
    throw new Error("Android 文件选择器返回了不完整数据");
  }
  const bytes = Uint8Array.from(atob(payload.data), (char) => char.charCodeAt(0));
  return new File([bytes], payload.name, { type: typeof payload.type === "string" ? payload.type : "" });
}

function createNativeBackend(scope: "data" | "local", api: AndroidBridge): StorageAdapter {
  return {
    kind: "native",
    get: async (key) => api.storageGet(scope, key),
    set: async (key, value) => api.storageSet(scope, key, value),
    remove: async (key) => api.storageRemove(scope, key),
    keys: async () => JSON.parse(api.storageKeys(scope)) as string[],
    clear: async () => api.storageClear(scope),
  };
}

/** Configure the encrypted Vault to use the Android app-private store when hosted in WebView. */
export function configureAndroidStorage(): boolean {
  const api = bridge();
  if (!api) return false;
  configureBackends(createNativeBackend("data", api), createNativeBackend("local", api));
  return true;
}
