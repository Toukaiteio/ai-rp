import {
  checkVerifier,
  createVerifier,
  decryptJson,
  deriveKey,
  encryptJson,
  fromBase64,
  isEnvelope,
  PBKDF2_ITERATIONS,
  randomSalt,
  toBase64,
  VAULT_VERSION,
  type Envelope,
} from "./crypto";
import { hydrateVaultData, resetVaultData } from "./registry";
import { blockRememberedSession, forgetRememberedKey, keepRememberedKey, setRememberPref, takeRememberedKey } from "./remember";
import {
  getDataBackend,
  getLocalBackend,
  resetBackendCache,
  type BackendKind,
} from "@/lib/storage/backend";
import type { VaultKdfParams } from "./config";

export * from "./crypto";
export type { VaultKdfParams } from "./config";
export { registerVaultData } from "./registry";

/** 加密头。只有盐和校验值，密钥的任何一个字节都不在这里。 */
const HEADER_KEY = "ai-rp:vault:v1";
/** 阶段 1 到 3 留下的明文键。升级后必须清掉，不能让旧数据留在磁盘上 */
const LEGACY_PLAINTEXT_KEYS = [
  "ai-rp:sessions:v1",
  "ai-rp:provider-config:v1",
  "ai-rp:cards:v1",
];
export const MAX_ATTEMPTS = 5;
/** 密钥最短长度。太短扛不住离线爆破，8 是能接受的地板。 */
export const MIN_PASSPHRASE_LENGTH = 8;

export type VaultStatus = "unknown" | "uninitialized" | "locked" | "unlocked";

export interface VaultSnapshot {
  status: VaultStatus;
  /** 还可以错几次。连续错 5 次会清掉本机数据 */
  attemptsLeft: number;
  /** 大块数据实际落在哪个后端，界面上要能看见是否回退了 */
  backend: BackendKind | null;
  /** 一次性提示，比如「数据已清除」 */
  notice: string | null;
}

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_vault"
      | "has_vault"
      | "weak_passphrase"
      | "mismatch"
      | "bad_passphrase"
      | "wiped"
      | "locked"
      | "no_webcrypto",
    /** 界面按这个词条翻译。message 仍是中文，给没有界面的调用方兜底 */
    readonly phrase?: string,
    readonly vars?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

interface VaultHeader {
  v: number;
  /** base64 的盐。公开存着，不影响安全 */
  salt: string;
  /** 用派生密钥加密固定明文得到的校验值，不是密钥的可逆形式 */
  verifier: Envelope;
  iterations: number;
  /** 连续错误的次数。只是一个数，不携带密钥信息 */
  attempts: number;
}

/* ---------------------------------------------------------------- 状态 */

let status: VaultStatus = "unknown";
let attempts = 0;
let backendKind: BackendKind | null = null;
let notice: string | null = null;
/** 派生出来的密钥只活在这个模块变量里，从不写进任何存储 */
let activeKey: CryptoKey | null = null;

let snapshot: VaultSnapshot = {
  status,
  attemptsLeft: MAX_ATTEMPTS,
  backend: null,
  notice: null,
};
const listeners = new Set<() => void>();

function publish(next: Partial<VaultSnapshot>): void {
  if (next.status !== undefined) status = next.status;
  if (next.attemptsLeft !== undefined) attempts = MAX_ATTEMPTS - next.attemptsLeft;
  if (next.backend !== undefined) backendKind = next.backend;
  if (next.notice !== undefined) notice = next.notice;

  snapshot = {
    status,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
    backend: backendKind,
    notice,
  };
  for (const listener of listeners) listener();
}

export function subscribeVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVaultSnapshot(): VaultSnapshot {
  return snapshot;
}

/** 服务端渲染时什么都不知道，先给 unknown，客户端探测完再切真实值。 */
export function getVaultServerSnapshot(): VaultSnapshot {
  return snapshot;
}

export function getVaultKey(): CryptoKey | null {
  return activeKey;
}

/** KDF metadata of the current local vault, for the user's export note. */
export function getVaultKdfParams(): VaultKdfParams | null {
  const header = readHeader();
  return header ? { salt: header.salt, iterations: header.iterations } : null;
}

export function requireVaultKey(): CryptoKey {
  if (!activeKey) throw new VaultError("尚未解锁", "locked", "locked");
  return activeKey;
}

/* ---------------------------------------------------------------- 头信息 */

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readHeader(): VaultHeader | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(HEADER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<VaultHeader>;
    if (typeof candidate.salt !== "string" || !isEnvelope(candidate.verifier)) return null;
    return {
      v: typeof candidate.v === "number" ? candidate.v : VAULT_VERSION,
      salt: candidate.salt,
      verifier: candidate.verifier,
      iterations:
        typeof candidate.iterations === "number" && candidate.iterations > 0
          ? candidate.iterations
          : PBKDF2_ITERATIONS,
      attempts:
        typeof candidate.attempts === "number" && candidate.attempts > 0
          ? candidate.attempts
          : 0,
    };
  } catch {
    return null;
  }
}

function writeHeader(header: VaultHeader): void {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(HEADER_KEY, JSON.stringify(header));
}

function dropHeader(): void {
  if (!hasLocalStorage()) return;
  window.localStorage.removeItem(HEADER_KEY);
}

/** 清掉升级前留下的明文，避免旧数据一直躺在磁盘上。 */
function dropLegacyPlaintext(): void {
  if (!hasLocalStorage()) return;
  for (const key of LEGACY_PLAINTEXT_KEYS) window.localStorage.removeItem(key);
}

/* ---------------------------------------------------------------- 生命周期 */

/** 客户端挂载后探测一次：本机有没有设过密钥。 */
export async function probeVault(): Promise<void> {
  if (status === "unlocked") return;
  const header = readHeader();
  if (header) {
    const remembered = await takeRememberedKey();
    if (remembered && (await checkVerifier(remembered, header.verifier))) {
      activeKey = remembered;
      attempts = 0;
      writeHeader({ ...header, attempts: 0 });
      publish({
        status: "unlocked",
        attemptsLeft: MAX_ATTEMPTS,
        backend: await resolveBackendKind(),
        notice: null,
      });
      await hydrateVaultData();
      return;
    }
    if (remembered) await forgetRememberedKey();
    attempts = header.attempts;
    publish({ status: "locked", attemptsLeft: MAX_ATTEMPTS - Math.max(0, attempts) });
    return;
  }
  attempts = 0;
  publish({ status: "uninitialized", attemptsLeft: MAX_ATTEMPTS });
}

async function resolveBackendKind(): Promise<BackendKind> {
  const kind = (await getDataBackend()).kind;
  backendKind = kind;
  return kind;
}

/** 第一次设定密钥。此前本机没有加密头，所以先把旧明文清掉再建。 */
export async function setupVault(
  passphrase: string,
  confirm: string,
  rememberMs = 0,
  params?: VaultKdfParams,
): Promise<void> {
  if (readHeader()) {
    throw new VaultError("本机已经设过密钥，请输入密钥解锁", "has_vault", "has_vault");
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError(
      `密钥至少 ${MIN_PASSPHRASE_LENGTH} 个字符`,
      "weak_passphrase",
      "weak",
      { min: MIN_PASSPHRASE_LENGTH },
    );
  }
  if (passphrase !== confirm) {
    throw new VaultError("两次输入的密钥不一样", "mismatch", "mismatch");
  }
  if (!globalThis.crypto?.subtle) {
    throw new VaultError("当前环境不支持 WebCrypto，无法加密存储", "no_webcrypto", "no_crypto");
  }

  dropLegacyPlaintext();
  await clearStoredData();

  const salt = params ? fromBase64(params.salt) : randomSalt();
  const iterations = params?.iterations ?? PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, fromBase64(toBase64(salt)), iterations);
  writeHeader({
    v: VAULT_VERSION,
    salt: toBase64(salt),
    verifier: await createVerifier(key),
    iterations,
    attempts: 0,
  });

  activeKey = key;
  attempts = 0;
  await keepRememberedKey(key, rememberMs);
  publish({
    status: "unlocked",
    attemptsLeft: MAX_ATTEMPTS,
    backend: await resolveBackendKind(),
    notice: null,
  });
  await hydrateVaultData();
}

/**
 * 解锁。密钥错一次记一次，连续 5 次清掉本机全部数据。
 *
 * 失败文案不区分「密钥错」和「密文坏了」，也不透露还差几位，
 * 只说还剩几次机会——次数是给正常用户看的，对攻击者没有密钥信息。
 */
export async function unlockVault(passphrase: string, rememberMs = 0): Promise<void> {
  const header = readHeader();
  if (!header) {
    throw new VaultError("本机还没有设过密钥，先设一个", "no_vault", "no_vault");
  }

  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, fromBase64(header.salt), header.iterations);
  } catch {
    throw new VaultError("当前环境不支持 WebCrypto，无法解锁", "no_webcrypto", "no_crypto");
  }

  if (!(await checkVerifier(key, header.verifier))) {
    const next = header.attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await wipeVaultData();
      throw new VaultError(
        `密钥连续错误 ${MAX_ATTEMPTS} 次，本机数据已全部清除，请重新设置密钥`,
        "wiped",
        "wiped",
        { max: MAX_ATTEMPTS },
      );
    }
    writeHeader({ ...header, attempts: next });
    publish({ status: "locked", attemptsLeft: MAX_ATTEMPTS - next });
    throw new VaultError(
      `密钥错误，还可以再试 ${MAX_ATTEMPTS - next} 次`,
      "bad_passphrase",
      "bad_passphrase",
      { left: MAX_ATTEMPTS - next },
    );
  }

  activeKey = key;
  writeHeader({ ...header, attempts: 0 });
  await keepRememberedKey(key, rememberMs);
  publish({
    status: "unlocked",
    attemptsLeft: MAX_ATTEMPTS,
    backend: await resolveBackendKind(),
    notice: null,
  });
  await hydrateVaultData();
}

/** 锁定：内存里的密钥和各数据镜像一起丢掉，磁盘上的密文留着。 */
export function lockVault(): void {
  activeKey = null;
  blockRememberedSession();
  resetVaultData();
  const header = readHeader();
  publish({
    status: header ? "locked" : "uninitialized",
    attemptsLeft: MAX_ATTEMPTS - (header?.attempts ?? 0),
    notice: null,
  });
}

/** 只清密文与镜像，不动加密头（密钥与错误计数留着）。 */
async function clearStoredData(): Promise<void> {
  await (await getLocalBackend()).clear();
  await (await getDataBackend()).clear();
  resetVaultData();
  resetBackendCache();
}

/**
 * 清除本机数据：密文、加密头、旧明文全部清掉，回到「还没设过密钥」的状态。
 * 口令本身没存过。打开过自动解锁的话，暂存的派生密钥也在这一步删掉。
 */
export async function wipeVaultData(): Promise<void> {
  activeKey = null;
  blockRememberedSession();
  setRememberPref(0);
  await clearStoredData();
  dropHeader();
  dropLegacyPlaintext();
  publish({
    status: "uninitialized",
    attemptsLeft: MAX_ATTEMPTS,
    backend: null,
    notice: "wiped",
  });
}

/* ---------------------------------------------------------------- 加密槽位 */

export type VaultScope = "local" | "data";

async function backendFor(scope: VaultScope) {
  return scope === "local" ? getLocalBackend() : getDataBackend();
}

/**
 * 读一条加密数据。
 * 未解锁、没有、解不开，一律返回 null——调用方不需要区分，
 * 反正都是「现在读不到」。
 */
export async function readSlot<T>(scope: VaultScope, id: string): Promise<T | null> {
  const key = activeKey;
  if (!key) return null;
  const backend = await backendFor(scope);
  const raw = await backend.get(id);
  if (!raw) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isEnvelope(envelope)) return null;
    return await decryptJson<T>(key, envelope);
  } catch {
    return null;
  }
}

export async function writeSlot<T>(scope: VaultScope, id: string, value: T): Promise<void> {
  const key = requireVaultKey();
  const backend = await backendFor(scope);
  await backend.set(id, JSON.stringify(await encryptJson(key, value)));
}

export async function removeSlot(scope: VaultScope, id: string): Promise<void> {
  const backend = await backendFor(scope);
  await backend.remove(id);
}

/** 列出某个前缀下的全部条目，坏掉的条目跳过。 */
export async function listSlots<T>(
  scope: VaultScope,
  prefix: string,
): Promise<Array<{ id: string; value: T }>> {
  const key = activeKey;
  if (!key) return [];
  const backend = await backendFor(scope);
  const keys = (await backend.keys()).filter((name) => name.startsWith(prefix));
  const out: Array<{ id: string; value: T }> = [];
  for (const id of keys) {
    const raw = await backend.get(id);
    if (!raw) continue;
    try {
      const envelope: unknown = JSON.parse(raw);
      if (!isEnvelope(envelope)) continue;
      out.push({ id, value: await decryptJson<T>(key, envelope) });
    } catch {
      // 解不开的条目不进内存，也不写日志
    }
  }
  return out;
}

/** 清掉某个前缀下的全部条目。 */
export async function clearSlots(scope: VaultScope, prefix: string): Promise<void> {
  const backend = await backendFor(scope);
  for (const id of await backend.keys()) {
    if (id.startsWith(prefix)) await backend.remove(id);
  }
}

/* ---------------------------------------------------------------- 存档 */

export interface VaultArchive {
  kind: "ai-rp-archive";
  v: number;
  /** 导出时的时间戳，只用于界面显示 */
  exportedAt: number;
  payload: unknown;
}

/** 导出存档：整包用当前密钥加密，文件本身不带任何明文。 */
export async function exportArchive(payload: unknown): Promise<string> {
  const key = requireVaultKey();
  const archive: VaultArchive = {
    kind: "ai-rp-archive",
    v: VAULT_VERSION,
    exportedAt: Date.now(),
    payload,
  };
  return JSON.stringify(await encryptJson(key, archive), null, 2);
}

/**
 * 导入存档。密钥不对、文件不是本项目存档、内容被改过都会抛，
 * 绝不静默吞掉——静默失败会让人以为导入成功，然后发现数据没了。
 */
export async function importArchive(text: string): Promise<{ payload: unknown; exportedAt: number }> {
  return decryptArchive(text, requireVaultKey());
}

/** Import an archive before the local vault exists, using explicit KDF metadata. */
export async function importArchiveWithPassphrase(
  text: string,
  passphrase: string,
  params: VaultKdfParams,
): Promise<{ payload: unknown; exportedAt: number }> {
  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, fromBase64(params.salt), params.iterations);
  } catch {
    throw new VaultError("无法使用这组盐和迭代次数解密存档", "bad_passphrase", "archive_key");
  }
  return decryptArchive(text, key);
}

async function decryptArchive(text: string, key: CryptoKey): Promise<{ payload: unknown; exportedAt: number }> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new VaultError("这个文件不是有效的存档", "bad_passphrase", "archive_invalid");
  }
  if (!isEnvelope(envelope)) {
    throw new VaultError("这个文件不是本项目导出的加密存档", "bad_passphrase", "archive_foreign");
  }

  let archive: VaultArchive;
  try {
    archive = await decryptJson<VaultArchive>(key, envelope);
  } catch {
    throw new VaultError("密钥错误，解不开这个存档", "bad_passphrase", "archive_key");
  }

  if (archive?.kind !== "ai-rp-archive") {
    throw new VaultError("这个文件不是本项目导出的存档", "bad_passphrase", "archive_kind");
  }
  return { payload: archive.payload, exportedAt: archive.exportedAt ?? 0 };
}
