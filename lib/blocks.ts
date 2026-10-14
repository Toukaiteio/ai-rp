export type BlockKind = "narr" | "dlg" | "scene" | "player";

export interface MessageBlock {
  kind: BlockKind;
  /** 只有 dlg 块带说话人 */
  who?: string;
  text: string;
}

const TAG = "(narr|dlg|scene|player)";
const OPEN_WITH_CLOSE = new RegExp(
  `<${TAG}(?:\\s+who="([^"]*)")?>([\\s\\S]*?)<\\/\\1>`,
  "g",
);
const OPEN_ONLY = new RegExp(`^\\s*<${TAG}(?:\\s+who="([^"]*)")?>([\\s\\S]*)$`);

/**
 * 把模型输出拆成块。
 *
 * 流式场景下最后一个块常常还没闭合，所以未闭合的开标签也按对应块渲染，
 * 否则打字机打到一半会把旁白显示成对白。
 * 不带任何标记的纯文本按角色对白处理，保证旧回复也能显示。
 */
export function parseBlocks(raw: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  if (!raw) return blocks;

  let last = 0;
  let match: RegExpExecArray | null;

  OPEN_WITH_CLOSE.lastIndex = 0;
  while ((match = OPEN_WITH_CLOSE.exec(raw)) !== null) {
    const before = raw.slice(last, match.index).trim();
    if (before) blocks.push({ kind: "dlg", text: before });
    blocks.push({
      kind: match[1] as BlockKind,
      who: match[2] || undefined,
      text: match[3].trim(),
    });
    last = match.index + match[0].length;
  }

  const tail = raw.slice(last).trim();
  if (tail) {
    const open = OPEN_ONLY.exec(tail);
    if (open) {
      blocks.push({
        kind: open[1] as BlockKind,
        who: open[2] || undefined,
        text: open[3].trim(),
      });
    } else {
      blocks.push({ kind: "dlg", text: tail });
    }
  }

  return blocks;
}

/**
 * 块 → 保留标记的文本。
 *
 * 两个用途，都靠它保住旁白的语义：
 * 1. 回灌模型：让模型看到自己上一轮的输出格式，续写才接得上。
 * 2. EPUB 导出：按 kind 决定排版（旁白正文、对白缩进、场景居中），
 *    或者直接把这段标记文本交给下游渲染器。
 */
export function blocksToRaw(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "dlg") {
        return `<dlg who="${block.who ?? ""}">${block.text}</dlg>`;
      }
      return `<${block.kind}>${block.text}</${block.kind}>`;
    })
    .join("\n");
}

export interface PlainTextOptions {
  /** 对白是否加「」引号 */
  quoteDialogue?: boolean;
  /** 旁白的语义标记，导出成纯文本时用它区分正文与对白；传空串则不标记 */
  narratorMarker?: string;
  /** 场景事件的前后缀 */
  sceneBrackets?: [string, string];
}

/**
 * 块 → 纯文本。标记被抹掉，只留可读内容。
 * 用于阅读、搜索、token 粗算这类不需要结构的场景。
 * 需要保留旁白语义（比如 EPUB 导出）就用 blocksToRaw() 或直接消费块的 kind。
 */
export function blocksToPlainText(
  blocks: MessageBlock[],
  options: PlainTextOptions = {},
): string {
  const {
    quoteDialogue = true,
    narratorMarker = "",
    sceneBrackets = ["〔", "〕"],
  } = options;

  return blocks
    .map((block) => {
      switch (block.kind) {
        case "narr":
          return `${narratorMarker}${block.text}`;
        case "scene":
          return `${sceneBrackets[0]}${block.text}${sceneBrackets[1]}`;
        case "player":
          return quoteDialogue ? `「${block.text}」` : block.text;
        default:
          return quoteDialogue ? `「${block.text}」` : block.text;
      }
    })
    .join("\n");
}

/** 抹掉块标记的快捷方式。 */
export function stripBlocks(raw: string, options?: PlainTextOptions): string {
  return blocksToPlainText(parseBlocks(raw), options);
}
