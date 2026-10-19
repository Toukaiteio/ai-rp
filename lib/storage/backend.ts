/**
 * 存储后端。只存已经加密好的字符串，不理解内容。
 *
 * 桌面 / 安卓壳在时走应用目录里的文件。
 * 浏览器里 IndexedDB 优先，打不开就回退到 localStorage，两个都没有就用内存。
 * 回退对上层完全透明：接口一样，只是容量不同。
 */

import { createNativeBackend, isNativeApp } from "./native";

export type BackendKind = "file" | "indexeddb" | "localstorage" | "memory";

export interface VaultBackend {
  readonly kind: BackendKind;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** 清掉这个后端自己写的全部键，别人的键不动 */
  clear(): Promise<void>;
}

const DB_NAME = "ai-rp";
const DB_VERSION = 1;
const STORE = "vault";
/** IndexedDB 打开卡住时的等待上限，超时就当不支持 */
const OPEN_TIMEOUT_MS = 2_000;

/* ---------------------------------------------------------------- 内存 */

export function createMemoryBackend(): VaultBackend {
  const map = new Map<string, string>();

  return {
    kind: "memory",
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async clear() {
      map.clear();
    },
  };
}

/* ---------------------------------------------------------------- localStorage */

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    // 隐私模式下访问 localStorage 会直接抛
    return false;
  }
}

export function createLocalStorageBackend(): VaultBackend | null {
  if (!hasLocalStorage()) return null;
  const prefix = "ai-rp:enc:";

  const full = (key: string) => `${prefix}${key}`;

  return {
    kind: "localstorage",
    async get(key) {
      return window.localStorage.getItem(full(key));
    },
    async set(key, value) {
      window.localStorage.setItem(full(key), value);
    },
    async remove(key) {
      window.localStorage.removeItem(full(key));
    },
    async keys() {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const name = window.localStorage.key(i);
        if (name?.startsWith(prefix)) out.push(name.slice(prefix.length));
      }
      return out;
    },
    async clear() {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const name = window.localStorage.key(i);
        if (name?.startsWith(prefix)) doomed.push(name);
      }
      for (const name of doomed) window.localStorage.removeItem(name);
    },
  };
}

/* ---------------------------------------------------------------- IndexedDB */

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("IndexedDB 打开超时"));
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error("IndexedDB 打开失败"));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error("IndexedDB 被其他标签页阻塞"));
    };
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 读写失败"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务中断"));
  });
}

/** 隐私模式下光是读 indexedDB 这个属性就可能抛，取值本身要兜住。 */
function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

async function createIndexedDbBackend(): Promise<VaultBackend | null> {
  if (!hasIndexedDb()) return null;

  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    return null;
  }

  return {
    kind: "indexeddb",
    async get(key) {
      const value = await runTransaction(db, "readonly", (store) => store.get(key));
      return typeof value === "string" ? value : null;
    },
    async set(key, value) {
      await runTransaction(db, "readwrite", (store) => store.put(value, key));
    },
    async remove(key) {
      await runTransaction(db, "readwrite", (store) => store.delete(key));
    },
    async keys() {
      const value = await runTransaction(db, "readonly", (store) => store.getAllKeys());
      return (value as IDBValidKey[]).map(String);
    },
    async clear() {
      await runTransaction(db, "readwrite", (store) => store.clear());
    },
  };
}

/* ---------------------------------------------------------------- 选择 */

let configuredData: VaultBackend | null = null;
let configuredLocal: VaultBackend | null = null;
let dataPromise: Promise<VaultBackend> | null = null;

/** 测试用：直接指定后端，不走环境探测。 */
export function configureBackends(data: VaultBackend | null, local: VaultBackend | null): void {
  configuredData = data;
  configuredLocal = local;
  dataPromise = null;
}

/** 聊天记录、角色卡、摘要这类大块数据。 */
export async function getDataBackend(): Promise<VaultBackend> {
  if (configuredData) return configuredData;
  if (!dataPromise) {
    dataPromise = (async () => {
      if (isNativeApp()) return createNativeBackend("data");
      const idb = await createIndexedDbBackend();
      if (idb) return idb;
      return createLocalStorageBackend() ?? createMemoryBackend();
    })();
  }
  return dataPromise;
}

/** 连接设置这类小但敏感的数据。浏览器里固定放 localStorage，壳里跟数据放在一起。 */
export async function getLocalBackend(): Promise<VaultBackend> {
  if (configuredLocal) return configuredLocal;
  if (isNativeApp()) return createNativeBackend("local");
  return createLocalStorageBackend() ?? createMemoryBackend();
}

/** 后端变了（比如清数据之后）时清掉缓存的探测结果。 */
export function resetBackendCache(): void {
  dataPromise = null;
}
