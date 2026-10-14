import type { CharacterCard } from "./types";
import { cardFileName, parseCharacterCard, serializeCard, type ParseResult } from "./validate";

/** 导入上限，避免有人拖进来一个巨大的文件把页面卡住。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

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

/** 读取用户选中的 JSON 文件并解析成卡。 */
export async function readCardFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "文件超过 2MB" };
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
