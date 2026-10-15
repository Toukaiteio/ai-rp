/**
 * 加密原语。只依赖 WebCrypto（crypto.subtle），不用第三方库，不用弱算法。
 *
 * 三件事必须保证：
 * 1. 口令的任何一个字节都不落盘。派生结果不可导出（extractable: false）。
 *    只有用户打开「自动解锁」时，才把这把不可导出的 CryptoKey 暂存在本机，到期或闲置就删。
 * 2. 盐与校验值可以存，但都不是密钥的可逆形式：盐是随机字节，
 *    校验值是用派生密钥加密的一段固定明文，拿不到密钥就解不开。
 * 3. 每次加密换新的 IV，同样的明文两次加密得到不同的密文。
 */

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH = "SHA-256";
export const AES_LENGTH = 256;
/** 校验值里加密的明文。解出来是这个才算密钥对得上。 */
export const VAULT_MAGIC = "ai-rp-vault";

const IV_BYTES = 12;
const SALT_BYTES = 16;

/** 密文信封。iv 与 data 都是 base64。 */
export interface Envelope {
  v: number;
  iv: string;
  data: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtleCrypto(): SubtleCrypto {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) {
    throw new Error("当前环境不支持 WebCrypto，无法读写加密数据");
  }
  return webcrypto.subtle;
}

/**
 * WebCrypto 的 BufferSource 只接受 ArrayBuffer 支撑的视图。
 * 不带这个参数时 Uint8Array 会退化成 ArrayBufferLike，类型对不上。
 */
type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomSalt(): Bytes {
  return randomBytes(SALT_BYTES);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * PBKDF2 派生 AES-256 密钥。
 * 600,000 次迭代是现在的常识下限，慢一点没关系：这个开销只在解锁时付一次。
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await subtleCrypto().importKey(
    "raw",
    encoder.encode(passphrase) as Uint8Array<ArrayBuffer>,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return subtleCrypto().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH },
    material,
    { name: "AES-GCM", length: AES_LENGTH },
    // 不可导出：拿到 CryptoKey 对象也取不出密钥字节
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Envelope> {
  const iv = randomBytes(IV_BYTES);
  const cipher = await subtleCrypto().encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)) as Uint8Array<ArrayBuffer>,
  );
  return { v: VAULT_VERSION, iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

/** 密钥不对或密文被改过都会抛。调用方统一当成「密钥错误」处理。 */
export async function decryptJson<T>(key: CryptoKey, envelope: Envelope): Promise<T> {
  const plain = await subtleCrypto().decrypt(
    { name: "AES-GCM", iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.data),
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Envelope>;
  return (
    typeof candidate.iv === "string" &&
    typeof candidate.data === "string" &&
    typeof candidate.v === "number"
  );
}

/** 校验值：用派生密钥加密固定明文。存它不会泄露密钥。 */
export async function createVerifier(key: CryptoKey): Promise<Envelope> {
  return encryptJson(key, { magic: VAULT_MAGIC, v: VAULT_VERSION });
}

export async function checkVerifier(
  key: CryptoKey,
  envelope: Envelope,
): Promise<boolean> {
  try {
    const payload = await decryptJson<{ magic?: string }>(key, envelope);
    return payload?.magic === VAULT_MAGIC;
  } catch {
    return false;
  }
}
