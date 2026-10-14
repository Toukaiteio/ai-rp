import EpubBuilder from "jepub/dist/jepub.es.js";
import { selectedSwipe, splitChapters, type ExportMessage } from "./chapters";
import { compressImage, renderNameCover } from "./image";
import { renderChapterHtml, type RenderOptions } from "./render";

export interface EpubInput {
  title: string;
  author: string;
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    swipes?: string[];
    swipeIndex?: number;
    chapterBreak?: boolean;
    cgSrc?: string;
  }>;
  options: RenderOptions;
}

/**
 * 在浏览器里生成 EPUB。文件只通过下载交给用户，不上传、不在服务端留副本。
 * 这里没有、也不提供从 EPUB 读回会话的路径。
 */
export async function buildEpub(input: EpubInput): Promise<Blob> {
  const prepared: ExportMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: selectedSwipe(message),
    chapterBreak: message.chapterBreak,
    cgSrc: message.cgSrc,
  }));

  const chapters = splitChapters(prepared);
  const Book = (EpubBuilder as { default?: typeof EpubBuilder }).default ?? EpubBuilder;
  const book = new Book();
  book.init({
    i18n: "zh",
    title: input.title,
    author: input.author,
    publisher: "ai-rp",
    description: input.description || input.title,
  });
  book.date(new Date());

  const imageNames = new Map<string, string>();
  let imageIndex = 0;
  let coverSet = false;

  for (const message of prepared) {
    if (!message.cgSrc || imageNames.has(message.cgSrc)) continue;
    const blob = await compressImage(message.cgSrc);
    if (!blob) continue;
    const name = `cg${imageIndex}`;
    imageIndex += 1;
    book.image(blob, name);
    imageNames.set(message.cgSrc, name);
    if (!coverSet) {
      book.cover(blob);
      coverSet = true;
    }
  }

  if (!coverSet) {
    book.cover(await renderNameCover(input.title));
  }

  for (const chapter of chapters) {
    book.add(
      chapter.title,
      renderChapterHtml(chapter.messages, input.options, imageNames) || "<p></p>",
    );
  }

  const result = await book.generate("blob");
  if (!(result instanceof Blob)) {
    throw new Error("EPUB 生成失败");
  }
  return result;
}

export function epubFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || "story";
  return `${safe}.epub`;
}
