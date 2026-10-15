/**
 * 聊天附件里的文档。只在浏览器里读成纯文本，不上传到本项目的服务器。
 * PDF 没有解析器，不接受。
 */

export interface ChatDocument {
  name: string;
  text: string;
}

const MAX_CHARS = 8_000;
const MAX_BYTES = 2_000_000;
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "json", "log"]);

function extension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

function cleanName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  return cleaned || "document";
}

function clipText(raw: string): string {
  const text = raw.replace(/\u0000/g, "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("empty");
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n…`;
}

/** 文档里的块标记不能把玩家消息拆开。 */
function neutralize(text: string): string {
  return text.replace(/<\/?(narr|dlg|scene|player)\b/gi, (tag) => tag.replace("<", "＜"));
}

export function normalizeDocument(value: unknown): ChatDocument | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as { name?: unknown; text?: unknown };
  if (typeof raw.name !== "string" || typeof raw.text !== "string") return undefined;
  const name = cleanName(raw.name);
  const text = raw.text.replace(/\u0000/g, "").slice(0, MAX_CHARS + 2).trim();
  if (!text) return undefined;
  return { name, text };
}

/** 拼进发给模型的那条玩家消息。界面上仍只显示玩家自己写的字。 */
export function embedDocument(content: string, document: ChatDocument | undefined): string {
  if (!document?.text) return content;
  const block = `【附件：${document.name}】\n${neutralize(document.text)}`;
  return content ? `${content}\n\n${block}` : block;
}

export function docxXmlToText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/g, "&");
}

function isTextFile(file: File): boolean {
  const ext = extension(file.name);
  if (TEXT_EXT.has(ext)) return true;
  return file.type === "text/plain" || file.type === "text/markdown" || file.type === "text/csv" || file.type === "application/json";
}

function isDocx(file: File): boolean {
  return (
    extension(file.name) === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export async function readChatDocument(file: File): Promise<ChatDocument> {
  if (file.size > MAX_BYTES) throw new Error("too-large");
  const name = cleanName(file.name);
  if (isTextFile(file)) {
    return { name, text: clipText(await file.text()) };
  }
  if (!isDocx(file)) throw new Error("unsupported");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("unsupported");
  return { name, text: clipText(docxXmlToText(xml)) };
}
