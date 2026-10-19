import { beforeEach, describe, expect, it } from "vitest";
import { configureBackends, getDataBackend, getLocalBackend, resetBackendCache } from "./backend";

let storage = new Map<string, string>();

class FakeLocalStorage {
  get length() {
    return storage.size;
  }
  key(index: number) {
    return [...storage.keys()][index] ?? null;
  }
  getItem(key: string) {
    return storage.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    storage.set(key, value);
  }
  removeItem(key: string) {
    storage.delete(key);
  }
}

/** 存得住东西的 IndexedDB 替身，用来确认有 IndexedDB 时优先用它。 */
class FakeObjectStore {
  private map = new Map<string, string>();
  put(value: string, key: string) {
    this.map.set(key, value);
    return this.request();
  }
  get(key: string) {
    return this.request(this.map.get(key));
  }
  delete(key: string) {
    this.map.delete(key);
    return this.request();
  }
  getAllKeys() {
    return this.request([...this.map.keys()]);
  }
  clear() {
    this.map.clear();
    return this.request();
  }
  private request<T>(result?: T) {
    return { result, onsuccess: null, onerror: null } as unknown as IDBRequest<T>;
  }
}

function installIndexedDb(kind: "ok" | "throws" | "timeout"): void {
  if (kind === "ok") {
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        const request = {
          result: {
            transaction: () => ({
              objectStore: () => new FakeObjectStore(),
              onabort: null,
            }),
            objectStoreNames: { contains: () => true },
          },
          onupgradeneeded: null,
          onsuccess: null as (() => void) | null,
          onerror: null,
          onblocked: null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request as unknown as IDBOpenDBRequest;
      },
    };
    return;
  }

  if (kind === "timeout") {
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        const request = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
        // 永不回调，靠超时判定不支持
        return request as unknown as IDBOpenDBRequest;
      },
    };
    return;
  }

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      throw new Error("IndexedDB 被禁用");
    },
  };
}

beforeEach(() => {
  storage = new Map();
  resetBackendCache();
  configureBackends(null, null);
  (globalThis as { window?: unknown }).window = { localStorage: new FakeLocalStorage() };
});

describe("后端选择", () => {
  it("有 IndexedDB 就用它", async () => {
    installIndexedDb("ok");
    expect((await getDataBackend()).kind).toBe("indexeddb");
  });

  it("IndexedDB 抛异常时回退到 localStorage，读写照常", async () => {
    installIndexedDb("throws");
    const backend = await getDataBackend();
    expect(backend.kind).toBe("localstorage");

    await backend.set("session:1", "密文");
    expect(await backend.get("session:1")).toBe("密文");
    expect(await backend.keys()).toEqual(["session:1"]);
    await backend.clear();
    expect(await backend.keys()).toEqual([]);
  });

  it("IndexedDB 打不开（超时）也回退", async () => {
    installIndexedDb("timeout");
    const backend = await getDataBackend();
    expect(backend.kind).toBe("localstorage");
    await backend.set("card:1", "密文");
    expect(await backend.get("card:1")).toBe("密文");
  });

  it("完全没有持久化存储时用内存，不抛异常", async () => {
    installIndexedDb("throws");
    (globalThis as { window?: unknown }).window = {};
    const backend = await getDataBackend();
    expect(backend.kind).toBe("memory");
    await backend.set("a", "密文");
    expect(await backend.get("a")).toBe("密文");
  });

  it("原生壳里数据与本地设置都走文件桥，不打开 IndexedDB", async () => {
    installIndexedDb("ok");
    const files = { data: new Map<string, string>(), local: new Map<string, string>() };
    const host = window as Window & {
      __AI_RP_NATIVE__?: boolean;
      __AI_RP_CALL__?: (message: { op: string; bucket: "data" | "local"; key?: string; value?: string | null }) => Promise<{ ok: boolean; value?: string | null; keys?: string[] }>;
    };
    host.__AI_RP_NATIVE__ = true;
    host.__AI_RP_CALL__ = async (message) => {
      const bucket = files[message.bucket];
      if (message.op === "get") return { ok: true, value: bucket.get(message.key ?? "") ?? null };
      if (message.op === "set") {
        bucket.set(message.key ?? "", message.value ?? "");
        return { ok: true };
      }
      if (message.op === "remove") {
        bucket.delete(message.key ?? "");
        return { ok: true };
      }
      if (message.op === "keys") return { ok: true, keys: [...bucket.keys()] };
      bucket.clear();
      return { ok: true };
    };

    const data = await getDataBackend();
    const local = await getLocalBackend();
    expect(data.kind).toBe("file");
    expect(local.kind).toBe("file");
    await data.set("session:1", "密文");
    expect(await data.get("session:1")).toBe("密文");
    expect(await data.keys()).toEqual(["session:1"]);
    await local.set("settings", "设置");
    expect(files.local.get("settings")).toBe("设置");
    await data.clear();
    expect(await data.keys()).toEqual([]);
    expect(files.local.get("settings")).toBe("设置");
  });

  it("local 范围固定用 localStorage，且只清自己的键", async () => {
    installIndexedDb("ok");
    const backend = await getLocalBackend();
    expect(backend.kind).toBe("localstorage");

    storage.set("ai-rp:enc:settings", "密文");
    storage.set("someone-else:key", "别人的东西");
    await backend.clear();
    expect(storage.has("ai-rp:enc:settings")).toBe(false);
    expect(storage.get("someone-else:key")).toBe("别人的东西");
  });
});
