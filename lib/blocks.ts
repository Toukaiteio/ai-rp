export type BlockKind = "narr" | "act" | "dlg" | "scene" | "player";

export interface MessageBlock {
  kind: BlockKind;
  /** dlg 和 act 块可以带说话人 */
  who?: string;
  text: string;
}

const BLOCK_TAG = /<\s*(\/?)\s*(narr|act|dlg|scene|player)\b([^>]*)>/gi;
const WHO_ATTRIBUTE = /\bwho\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

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
  let open: { kind: BlockKind; who?: string; textStart: number } | null = null;
  let match: RegExpExecArray | null;

  BLOCK_TAG.lastIndex = 0;
  while ((match = BLOCK_TAG.exec(raw)) !== null) {
    const closing = match[1] === "/";
    const kind = match[2].toLowerCase() as BlockKind;

    if (closing) {
      if (open?.kind === kind) {
        pushBlock(blocks, open.kind, raw.slice(open.textStart, match.index), open.who);
        open = null;
        last = match.index + match[0].length;
      }
      continue;
    }

    // If a malformed response starts another block before closing the previous
    // one, keep both blocks visible instead of letting the first one swallow it.
    if (open) {
      pushBlock(blocks, open.kind, raw.slice(open.textStart, match.index), open.who);
    } else {
      pushDialogue(blocks, raw.slice(last, match.index));
    }

    const whoMatch = WHO_ATTRIBUTE.exec(match[3]);
    open = {
      kind,
      who: whoMatch?.[1] ?? whoMatch?.[2] ?? undefined,
      textStart: match.index + match[0].length,
    };
  }

  if (open) {
    pushBlock(blocks, open.kind, raw.slice(open.textStart), open.who);
  } else {
    pushDialogue(blocks, raw.slice(last));
  }

  return blocks;
}

function speakerName(block: MessageBlock, cardName: string): string {
  return block.who?.trim() || cardName;
}

/**
 * 这段对白要不要接着上一句，省掉头像和名字。
 * 中间只隔动作块，还是同一个人，就接着写。
 * 隔了旁白、换场或玩家发言，要重新报一次名字。
 */
export function dialogueContinues(blocks: MessageBlock[], index: number, cardName: string): boolean {
  const block = blocks[index];
  if (!block || block.kind !== "dlg") return false;
  const speaker = speakerName(block, cardName);
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = blocks[i];
    if (prev.kind === "act") continue;
    if (prev.kind !== "dlg") return false;
    return speakerName(prev, cardName) === speaker;
  }
  return false;
}

function pushDialogue(blocks: MessageBlock[], text: string) {
  const value = text.trim();
  if (value) blocks.push({ kind: "dlg", text: value });
}

function pushBlock(blocks: MessageBlock[], kind: BlockKind, text: string, who?: string) {
  const value = text.trim();
  if (value) blocks.push({ kind, who, text: value });
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
      if (block.kind === "dlg" || block.kind === "act") {
        return `<${block.kind} who="${block.who ?? ""}">${block.text}</${block.kind}>`;
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
        case "act":
          return block.text;
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
