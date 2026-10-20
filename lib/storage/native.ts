import { configureBackends, type StorageAdapter } from "./backend";

type AndroidBridge = {
  storageGet(scope: string, key: string): string | null;
  storageSet(scope: string, key: string, value: string): void;
  storageRemove(scope: string, key: string): void;
  storageKeys(scope: string): string;
  storageClear(scope: string): void;
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
