import { decryptJson, encryptJson, isEnvelope, type Envelope } from "./crypto";

/**
 * 自动解锁。
 *
 * 口令本身不写进任何存储。打开开关时，只把不可导出的派生密钥放进
 * 单独的 IndexedDB，封存的时限就是用户选的那一段，从解锁起算，到点作废。
 * 不另加闲置时限，否则选了 7 天也会在十几分钟后被清掉。
 *
 * 封存被改过、时钟被往回拨、校验对不上，一律删掉。
 * 这不是时间锁密码：有效期内拿到这把密钥的人仍然解得开。
 * 浏览器把不可导出的密钥绑在这个站点上，换一台机器或换一个源就用不了。
 */

const DB_NAME = "ai-rp-remember";
const DB_VERSION = 1;
const STORE = "session";
const RECORD_ID = "current";
const PREF_KEY = "ai-rp:vault-remember:v1";

export const REMEMBER_OPTIONS = [
  { id: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", ms: 60 * 60 * 1000 },
  { id: "8h", ms: 8 * 60 * 60 * 1000 },
  { id: "1d", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type RememberOptionId = (typeof REMEMBER_OPTIONS)[number]["id"];

export interface RememberSeal {
  issuedAt: number;
  maxAgeMs: number;
  idleMs: number;
  lastActive: number;
}

export type RememberDecision = "ok" | "expired" | "clock";

/** 时钟往回拨超过这个量，当成封存被换过时间，直接作废。 */
const CLOCK_SKEW_MS = 60_000;

interface StoredRemember {
  key: CryptoKey;
  seal: Envelope;
}

let generation = 0;
let prefMs = 0;
const prefListeners = new Set<() => void>();

export function rememberDecision(seal: RememberSeal, now: number): RememberDecision {
  if (now + CLOCK_SKEW_MS < seal.issuedAt) return "clock";
  if (now > seal.issuedAt + seal.maxAgeMs) return "expired";
  return "ok";
}

export function isRememberMs(ms: number): boolean {
  return REMEMBER_OPTIONS.some((option) => option.ms === ms);
}

export function subscribeRememberPref(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

export function getRememberPref(): number {
  return prefMs;
}

export function getRememberPrefServer(): number {
  return 0;
}

function publishPref(next: number): void {
  prefMs = next;
  for (const listener of prefListeners) listener();
}

export function loadRememberPref(): void {
  publishPref(readRememberPref());
}

export function readRememberPref(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const ms = Number(localStorage.getItem(PREF_KEY));
    return isRememberMs(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

export function setRememberPref(ms: number): void {
  const next = isRememberMs(ms) ? ms : 0;
  try {
    if (typeof localStorage === "undefined") return;
    if (next === 0) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, String(next));
  } catch {
    // 存不下偏好就只在这一页生效，密钥本身仍然不会落盘
  }
  publishPref(next);
}

function isSeal(value: unknown): value is RememberSeal {
  if (typeof value !== "object" || value === null) return false;
  const seal = value as Partial<RememberSeal>;
  return (
    typeof seal.issuedAt === "number" &&
    typeof seal.maxAgeMs === "number" &&
    typeof seal.idleMs === "number" &&
    typeof seal.lastActive === "number" &&
    seal.maxAgeMs > 0 &&
    seal.idleMs > 0
  );
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, mode);
    const result = await new Promise<T>((resolve, reject) => {
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return result;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function readRow(): Promise<StoredRemember | null> {
  const row = await withStore<StoredRemember>("readonly", (store) => store.get(RECORD_ID));
  if (!row || !row.key || !isEnvelope(row.seal)) return null;
  return row;
}

async function writeRow(row: StoredRemember): Promise<void> {
  await withStore("readwrite", (store) => store.put(row, RECORD_ID));
}

export async function forgetRememberedKey(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(RECORD_ID));
}

/** 锁定或清除时调用。进行中的写入看到代数变了就放弃。 */
export function blockRememberedSession(): void {
  generation += 1;
  void forgetRememberedKey();
}

/** 解锁成功后按用户选的时长留下密钥。传 0 表示关掉，并删掉已经留下的。 */
export async function keepRememberedKey(key: CryptoKey, maxAgeMs: number): Promise<void> {
  const gen = generation;
  if (!isRememberMs(maxAgeMs)) {
    setRememberPref(0);
    await forgetRememberedKey();
    return;
  }
  const now = Date.now();
  const seal = await encryptJson(key, {
    issuedAt: now,
    maxAgeMs,
    idleMs: maxAgeMs,
    lastActive: now,
  } satisfies RememberSeal);
  if (gen !== generation) return;
  setRememberPref(maxAgeMs);
  await writeRow({ key, seal });
}

async function readValidKey(): Promise<CryptoKey | null> {
  const gen = generation;
  const row = await readRow();
  if (!row || gen !== generation) return null;
  let seal: unknown;
  try {
    seal = await decryptJson(row.key, row.seal);
  } catch {
    await forgetIfCurrent(gen);
    return null;
  }
  if (!isSeal(seal) || rememberDecision(seal, Date.now()) !== "ok") {
    await forgetIfCurrent(gen);
    return null;
  }
  return row.key;
}

async function forgetIfCurrent(gen: number): Promise<void> {
  if (gen !== generation) return;
  await forgetRememberedKey();
}

/** 探测时用。时限还在就返回密钥，否则删掉并返回 null。 */
export async function takeRememberedKey(): Promise<CryptoKey | null> {
  return readValidKey();
}

/** 没有留下密钥时返回 absent，调用方不要因此上锁。 */
export async function inspectRememberedSession(): Promise<"absent" | "ok" | "drop"> {
  const gen = generation;
  const row = await readRow();
  if (gen !== generation) return "ok";
  if (!row) return "absent";
  let seal: unknown;
  try {
    seal = await decryptJson(row.key, row.seal);
  } catch {
    await forgetIfCurrent(gen);
    return "drop";
  }
  if (!isSeal(seal) || rememberDecision(seal, Date.now()) !== "ok") {
    await forgetIfCurrent(gen);
    return "drop";
  }
  return "ok";
}

/** 有操作时把闲置计时往后推，绝对时限不动。 */
export async function touchRememberedSession(): Promise<void> {
  const gen = generation;
  const row = await readRow();
  if (!row || gen !== generation) return;
  let seal: unknown;
  try {
    seal = await decryptJson(row.key, row.seal);
  } catch {
    return;
  }
  if (!isSeal(seal) || rememberDecision(seal, Date.now()) !== "ok") return;
  const now = Date.now();
  if (now - seal.lastActive < 60_000) return;
  const next: RememberSeal = { ...seal, lastActive: now };
  const envelope = await encryptJson(row.key, next);
  if (gen !== generation) return;
  await writeRow({ key: row.key, seal: envelope });
}

/** 解锁之后盯着时限。到点或闲置过久就调用 onDrop。 */
export function watchRememberedSession(onDrop: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let lastTouch = 0;

  const check = () => {
    void inspectRememberedSession().then((result) => {
      if (!stopped && result === "drop") onDrop();
    });
  };
  const touch = () => {
    const now = Date.now();
    if (now - lastTouch < 60_000) return;
    lastTouch = now;
    void touchRememberedSession();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };

  window.addEventListener("pointerdown", touch, { passive: true });
  window.addEventListener("keydown", touch);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(check, 30_000);
  check();

  return () => {
    stopped = true;
    window.removeEventListener("pointerdown", touch);
    window.removeEventListener("keydown", touch);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
