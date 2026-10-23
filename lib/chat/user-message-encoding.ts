export const USER_MESSAGE_BASE64_INSTRUCTION = [
  "隐私传输提示：玩家的新消息中可能有部分词语使用 [[b64:utf8:...]] 标记。",
  "标记内部是 UTF-8 Base64；只解码标记内部后理解，标记外内容保持原样。",
  "这些片段仍属于玩家原话。不要把标记或 Base64 字符串原样展示给玩家，也不要把普通回复重新编码。",
].join("\n");

const MARKED_BASE64 = /\[\[b64:utf8:([A-Za-z0-9+/]+={0,2})\]\]/g;
const FALLBACK_WORD = /[A-Za-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu;
const ENCODE_RATE = 0.35;

export interface EncodedUserMessage {
  text: string;
  encodedWords: number;
}

export interface EncodeUserMessageOptions {
  random?: () => number;
}

interface WordRange {
  start: number;
  end: number;
}

export function encodeRandomUserWords(
  text: string,
  options: EncodeUserMessageOptions = {},
): EncodedUserMessage {
  const ranges = wordRanges(text);
  if (ranges.length === 0) return { text, encodedWords: 0 };

  const random = options.random ?? secureRandom;
  const count = Math.max(1, Math.round(ranges.length * ENCODE_RATE));
  const order = ranges.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(clampRandom(random()) * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const selected = new Set(order.slice(0, count));
  let cursor = 0;
  let encodedWords = 0;
  let result = "";
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    result += text.slice(cursor, range.start);
    const word = text.slice(range.start, range.end);
    if (selected.has(index)) {
      result += `[[b64:utf8:${encodeUtf8Base64(word)}]]`;
      encodedWords += 1;
    } else {
      result += word;
    }
    cursor = range.end;
  }
  result += text.slice(cursor);
  return { text: result, encodedWords };
}

export function hasMarkedBase64(text: string): boolean {
  MARKED_BASE64.lastIndex = 0;
  return MARKED_BASE64.test(text);
}

export function decodeMarkedBase64(text: string): string {
  return text.replace(MARKED_BASE64, (_, encoded: string) => {
    try {
      return decodeUtf8Base64(encoded);
    } catch {
      return _;
    }
  });
}

export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeUtf8Base64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function wordRanges(text: string): WordRange[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const ranges: WordRange[] = [];
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike || !/[\p{L}\p{N}]/u.test(segment.segment)) continue;
      ranges.push({ start: segment.index, end: segment.index + segment.segment.length });
    }
    if (ranges.length > 0) return ranges;
  }

  return [...text.matchAll(FALLBACK_WORD)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function secureRandom(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    return cryptoObject.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  }
  return Math.random();
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
}
