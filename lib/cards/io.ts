import type { CharacterCard } from "./types";
import { cardFileName, parseCharacterCard, serializeCard, type ParseResult } from "./validate";
import { extractCardJson } from "./png";

/** 导入上限，避免有人拖进来一个巨大的文件把页面卡住。 */
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PNG_BYTES = 10 * 1024 * 1024;

/** 导出成 JSON 文件。纯浏览器行为，不经过服务端。 */
export function downloadCard(card: CharacterCard): void {
  const blob = new Blob([serializeCard(card)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = cardFileName(card);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会在下载真正开始前把 blob 释放掉，导致浏览器取消这次下载。
  // 等一拍再释放。
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isPngFile(file: File): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return chunk;
}

const EMPTY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);

function cardForPng(card: CharacterCard): CharacterCard {
  const extensions = { ...(card.data.extensions ?? {}) };
  const local = extensions._local;
  if (local && typeof local === "object" && !Array.isArray(local)) {
    const nextLocal = { ...(local as Record<string, unknown>) };
    delete nextLocal.portrait;
    if (Object.keys(nextLocal).length > 0) extensions._local = nextLocal;
    else delete extensions._local;
  }
  return { ...card, data: { ...card.data, extensions } };
}

function embedCardInPng(image: Uint8Array, card: CharacterCard): Uint8Array {
  const cardText = new TextEncoder().encode(`chara\0${bytesToBase64(new TextEncoder().encode(JSON.stringify(card)))}`);
  let iendOffset = image.length - 12;
  let offset = 8;
  while (offset + 12 <= image.length) {
    const length = new DataView(image.buffer, image.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(...image.subarray(offset + 4, offset + 8));
    if (type === "IEND") {
      iendOffset = offset;
      break;
    }
    offset += 12 + length;
  }
  const beforeIend = image.slice(0, iendOffset);
  const iend = image.slice(iendOffset);
  const chunk = pngChunk("tEXt", cardText);
  const output = new Uint8Array(beforeIend.length + chunk.length + iend.length);
  output.set(beforeIend);
  output.set(chunk, beforeIend.length);
  output.set(iend, beforeIend.length + chunk.length);
  return output;
}

function coverPngBytes(card: CharacterCard): Uint8Array {
  const local = card.data.extensions?._local;
  if (!local || typeof local !== "object" || Array.isArray(local)) return EMPTY_PNG;
  const portrait = (local as Record<string, unknown>).portrait;
  if (typeof portrait !== "string") return EMPTY_PNG;
  const match = /^data:image\/png;base64,(.+)$/i.exec(portrait);
  if (!match) return EMPTY_PNG;
  try {
    const bytes = base64ToBytes(match[1]);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte) ? bytes : EMPTY_PNG;
  } catch {
    return EMPTY_PNG;
  }
}

/** 生成酒馆兼容的 PNG：卡 JSON 写入 tEXt/chara，封面优先复用 PNG 本地封面。 */
export function encodeCardPng(card: CharacterCard): Uint8Array {
  return embedCardInPng(coverPngBytes(card), cardForPng(card));
}

/** 导出为酒馆兼容的 PNG。 */
export async function downloadCardPng(card: CharacterCard): Promise<void> {
  const png = encodeCardPng(card);
  const blob = new Blob([png.buffer as ArrayBuffer], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${cardFileName(card).replace(/\.json$/i, "")}.png`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function attachPngPortrait(result: ParseResult, bytes: Uint8Array): ParseResult {
  if (!result.ok) return result;
  const extensions = { ...(result.card.data.extensions ?? {}) };
  const local = extensions._local && typeof extensions._local === "object" && !Array.isArray(extensions._local)
    ? { ...(extensions._local as Record<string, unknown>) }
    : {};
  local.portrait = `data:image/png;base64,${bytesToBase64(bytes)}`;
  delete local.portraitUrl;
  extensions._local = local;
  return {
    ok: true,
    card: { ...result.card, data: { ...result.card.data, extensions } },
  };
}

/** 读取 JSON，或读取酒馆常用的 PNG 内嵌角色卡。 */
export async function readCardFile(file: File): Promise<ParseResult> {
  const png = isPngFile(file);
  if (file.size > (png ? MAX_PNG_BYTES : MAX_JSON_BYTES)) {
    return { ok: false, error: png ? "PNG 文件超过 10MB" : "文件超过 2MB" };
  }

  if (png) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const raw = extractCardJson(bytes);
      if (raw === null) return { ok: false, error: "PNG 中没有找到酒馆角色卡数据" };
      return attachPngPortrait(parseCharacterCard(raw), bytes);
    } catch {
      return { ok: false, error: "读取 PNG 角色卡失败" };
    }
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "读不到文件内容" };
  }
  try {
    return parseCharacterCard(JSON.parse(text));
  } catch {
    return { ok: false, error: "不是合法的 JSON 文件" };
  }
}
