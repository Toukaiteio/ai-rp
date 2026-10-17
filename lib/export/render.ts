import { parseBlocks, type MessageBlock } from "@/lib/blocks";
import type { ExportMessage } from "./chapters";

export interface RenderOptions {
  includeNarration: boolean;
  includeOoc: boolean;
  userName: string;
  charName: string;
}

/** 玩家随手写的 OOC。默认不进书，开关打开才保留。 */
const OOC_PATTERN = /\(\([\s\S]*?\)\)|（\s*OOC\s*[:：][^）]*）|\(\s*OOC\s*[:：][^)]*\)/gi;

export function stripOoc(text: string): string {
  return text
    .replace(OOC_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const CHAPTER_CSS = [
  ".narr{margin:0.7em 0;line-height:1.7;}",
  // 动作块用淡黄，和旁白的中性灰分开；阅读器底色多为白，色值要压深才够对比
  ".act{margin:0.7em 0 0.7em 1.2em;line-height:1.7;font-style:italic;color:#7d6e24;}",
  ".dlg{margin:0.9em 0 0.9em 1.2em;line-height:1.7;}",
  ".player{margin:0.9em 0;line-height:1.7;text-align:right;}",
  ".who{font-weight:bold;}",
  ".scene{margin:1.2em 0;text-align:center;}",
  ".cg{display:block;max-width:100%;height:auto;margin:1em auto;}",
].join("");

export function renderTitlePageHtml(input: {
  title: string;
  author: string;
  scenario?: string;
}): string {
  const scenario = input.scenario?.trim();
  return [
    `<section class="title-page"><h1>${escapeHtml(input.title)}</h1>`,
    `<p class="author">${escapeHtml(input.author)}</p>`,
    scenario ? `<p class="scenario">${escapeHtml(scenario)}</p>` : "",
    "</section>",
  ].join("");
}

function blocksOf(message: ExportMessage, options: RenderOptions): MessageBlock[] {
  const raw = options.includeOoc ? message.content : stripOoc(message.content);
  if (!raw) return [];
  const blocks = parseBlocks(raw).filter((block) => {
    if (!options.includeNarration && block.kind === "narr") return false;
    return block.text.trim().length > 0;
  });
  return blocks;
}

function renderBlock(block: MessageBlock, options: RenderOptions): string {
  const text = escapeHtml(block.text);
  if (block.kind === "narr") return `<p class="narr">${text}</p>`;
  if (block.kind === "act") return `<p class="act">${text}</p>`;
  if (block.kind === "scene") return `<p class="scene">${text}</p>`;
  if (block.kind === "player") {
    return `<p class="player"><span class="who">${escapeHtml(options.userName)}</span> ${text}</p>`;
  }
  const who = block.who?.trim() || options.charName;
  return `<p class="dlg"><span class="who">${escapeHtml(who)}</span> ${text}</p>`;
}

/**
 * 一章的 XHTML 片段。旁白和对白用不同的 class，阅读器按 CSS 分开排。
 * 图片用 jepub 放进书里之后的相对路径，不嵌原始大图地址。
 */
export function renderChapterHtml(
  messages: ExportMessage[],
  options: RenderOptions,
  images: Map<string, string>,
): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = options.includeOoc ? message.content : stripOoc(message.content);
      const plain = text.replace(/<\/?player>/g, "").trim();
      if (!plain) continue;
      parts.push(
        `<p class="player"><span class="who">${escapeHtml(options.userName)}</span> ${escapeHtml(plain)}</p>`,
      );
      continue;
    }

    for (const block of blocksOf(message, options)) {
      parts.push(renderBlock(block, options));
    }

    const image = message.cgSrc ? images.get(message.cgSrc) : undefined;
    if (image) {
      parts.push(`<img class="cg" src="assets/${image}.jpg" alt="" />`);
    }
  }

  return parts.join("\n");
}
