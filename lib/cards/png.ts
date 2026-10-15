/**
 * 从 PNG 里拆出角色卡 JSON。
 *
 * 酒馆系的角色卡是「一张 PNG，tEXt 块里塞 base64 的 chara JSON」。
 * 在线卡源交出来的就是这种文件，服务端拉下来先在这里拆，再走和本地
 * JSON 导入完全相同的解析链路，两边的校验、报错、字段映射只有一份。
 * 只认 tEXt：卡数据的规范写法就是 base64 后放进 keyword 为 chara 的 tEXt。
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 每个块：长度 4 字节 + 类型 4 字节 + 数据 + CRC 4 字节 */
const CHUNK_HEADER = 8;
const CHUNK_CRC = 4;

function hasSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** PNG 的长度字段是大端四字节，不引 DataView，手算就四则运算。 */
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

/** base64 可能是 UTF-8 的中文，不能直接把 atob 的二进制串当字符串用。 */
function base64ToText(text: string): string | null {
  let binary: string;
  try {
    binary = atob(text.trim());
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 拆出卡数据。不是角色卡 PNG、或里面没有 chara 块时返回 null，
 * 由调用方决定报什么错。
 */
export function extractCardJson(bytes: Uint8Array): unknown | null {
  if (!hasSignature(bytes)) return null;

  let offset = PNG_SIGNATURE.length;
  while (offset + CHUNK_HEADER <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = decodeLatin1(bytes.subarray(offset + 4, offset + CHUNK_HEADER));
    const start = offset + CHUNK_HEADER;
    const end = start + length;
    if (end > bytes.length) break;

    if (type === "tEXt") {
      const data = bytes.subarray(start, end);
      const split = data.indexOf(0);
      if (split > 0) {
        const keyword = decodeLatin1(data.subarray(0, split));
        if (keyword === "chara") {
          const payload = data.subarray(split + 1);
          // 规范是 base64。base64 只含 ASCII，按 latin1 解出来就是原文；
          // 少数卡直接把 JSON 塞进来，那得按 UTF-8 解，两条路分开走才不会互相污染。
          const decoded = base64ToText(decodeLatin1(payload));
          if (decoded !== null) {
            const fromBase64 = parseJson(decoded);
            if (fromBase64 !== null) return fromBase64;
          }
          const raw = parseJson(new TextDecoder().decode(payload));
          if (raw !== null) return raw;
          return null;
        }
      }
    }

    offset = end + CHUNK_CRC;
    if (type === "IEND") break;
  }

  return null;
}
