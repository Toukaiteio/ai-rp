export type BlockKind = "narr" | "act" | "dlg" | "scene" | "player";

export interface MessageBlock {
  kind: BlockKind;
  /** dlg 和 act 块可以带说话人 */
  who?: string;
  text: string;
}

const BLOCK_TAG_NAMES = "narr|act|dlg|scene|player";
const BLOCK_TAG = new RegExp(
  `<\\s*(\\/?)\\s*(${BLOCK_TAG_NAMES})\\b((?:"[^"]*"|'[^']*'|[^'">])*)>`,
  "gi",
);
const REPAIR_BLOCK_TAG = new RegExp(
  `<\\s*(\\/?)\\s*(narr|act|dlg|scene|player|diag)\\b((?:"[^"]*"|'[^']*'|[^'">])*)>`,
  "gi",
);
const WHO_ATTRIBUTE = /\bwho\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

export type BlockRepairIssueKind =
  | "nested"
  | "self_closing"
  | "mismatched_close"
  | "unmatched_close"
  | "unclosed"
  | "invalid_tag";

export interface BlockRepairIssue {
  kind: BlockRepairIssueKind;
  detail: string;
  safe: boolean;
}

export interface BlockRepairResult {
  text: string;
  changed: boolean;
  safe: boolean;
  issues: BlockRepairIssue[];
}

export function encodeBlockAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function decodeBlockAttribute(value: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, key: string) => {
    if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? entity;
    const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}

/**
 * 模型没走工具通道时，会把函数调用写成 XML 标签：
 *   <remember_character">Fuka Shikuzaki\n同班同学。\n你\n图书馆</remember_character>
 * 这不是消息块，是它对「结构化输出」的模仿（输出契约通篇在教它用标签），
 * 而且常常是畸形的——属性引号只写一半，字段顺序也乱。
 *
 * 它包着的内容是模型想象的参数，不是剧情，给玩家看只会以为是角色在念乱码。
 * 所以成对的整段剥掉，落单的标签剥掉标签本身，剩下的正文照常渲染。
 * 不试图把内容解析成真记忆：字段都分不清，解析出错数据比没有更糟。
 */
const PSEUDO_TOOL_NAMES =
  "remember_character|remember_place|remember_event|roll_dice|list_memory|read_memory|search_memory|forget_memory";
const PSEUDO_TOOL_BLOCK = new RegExp(
  `<\\s*(?:${PSEUDO_TOOL_NAMES})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*(?:${PSEUDO_TOOL_NAMES})\\s*>`,
  "gi",
);
/** 没写闭合标签的：连它到下一个真消息块（或结尾）之间的内容一起剥掉。 */
const PSEUDO_TOOL_UNCLOSED = new RegExp(
  `<\\s*(?:${PSEUDO_TOOL_NAMES})\\b[^>]*>[\\s\\S]*?(?=<\\s*(?:narr|act|dlg|scene|player)\\b|$)`,
  "gi",
);
const PSEUDO_TOOL_TAG = new RegExp(`<\\s*\\/?\\s*(?:${PSEUDO_TOOL_NAMES})\\b[^>]*>`, "gi");

export function stripPseudoToolTags(raw: string): string {
  return raw
    .replace(PSEUDO_TOOL_BLOCK, "")
    .replace(PSEUDO_TOOL_UNCLOSED, "")
    .replace(PSEUDO_TOOL_TAG, "");
}

interface BlockTagToken {
  index: number;
  end: number;
  closing: boolean;
  kind: string;
  attrs: string;
  selfClosing: boolean;
}

/**
 * 把消息块修成「平级、成对」的最小结构。
 *
 * 能确定的情况只做结构变更：嵌套前先闭合上一个块、缺少闭合时补闭合、
 * diag 作为诊断包装去掉标签但保留里面的正文。遇到没有唯一判断的落单闭合、
 * 顶层自闭合或非法属性时返回原文，并把问题交给质量门拒收。
 */
export function repairBlockStructure(raw: string): BlockRepairResult {
  const source = typeof raw === "string" ? raw : "";
  if (!source) return { text: source, changed: false, safe: true, issues: [] };

  const tokens: BlockTagToken[] = [];
  REPAIR_BLOCK_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REPAIR_BLOCK_TAG.exec(source)) !== null) {
    const attrs = match[3] ?? "";
    tokens.push({
      index: match.index,
      end: match.index + match[0].length,
      closing: match[1] === "/",
      kind: match[2].toLowerCase(),
      attrs,
      selfClosing: !match[1] && /\/\s*$/.test(attrs),
    });
  }

  if (tokens.length === 0) {
    return { text: source, changed: false, safe: true, issues: [] };
  }

  const issues: BlockRepairIssue[] = [];
  for (const token of tokens) {
    const invalid = invalidTagDetail(token);
    if (invalid) {
      issues.push({ kind: "invalid_tag", detail: invalid, safe: false });
    }
  }
  if (issues.some((issue) => !issue.safe)) {
    return { text: source, changed: false, safe: false, issues };
  }

  let output = "";
  let cursor = 0;
  let active: string | null = null;
  let diagDepth = 0;
  const suppressedClosings = new Set<string>();
  let changed = false;
  let safe = true;

  const addIssue = (kind: BlockRepairIssueKind, detail: string, issueSafe = true) => {
    issues.push({ kind, detail, safe: issueSafe });
    if (!issueSafe) safe = false;
  };

  for (const token of tokens) {
    output += source.slice(cursor, token.index);

    if (token.kind === "diag") {
      if (token.closing) {
        if (diagDepth === 0) {
          if (active) {
            suppressedClosings.add(active);
            output += `</${active}>`;
            active = null;
            changed = true;
            addIssue("mismatched_close", "diag 闭合时补齐了仍未闭合的消息块");
          } else {
            output += source.slice(token.index, token.end);
            addIssue("unmatched_close", "没有对应开标签的 </diag>", false);
          }
        } else {
          diagDepth -= 1;
          if (active) {
            suppressedClosings.add(active);
            output += `</${active}>`;
            active = null;
            changed = true;
            addIssue("mismatched_close", "diag 闭合时补齐了仍未闭合的消息块");
          }
          changed = true;
        }
      } else if (token.selfClosing) {
        changed = true;
        addIssue("self_closing", "diag 不能使用自闭合标签，已移除空标签");
      } else {
        diagDepth += 1;
        changed = true;
      }
      cursor = token.end;
      continue;
    }

    if (token.closing) {
      if (active === token.kind) {
        output += source.slice(token.index, token.end);
        active = null;
      } else if (active) {
        const previous = active;
        suppressedClosings.add(previous);
        output += `</${active}>`;
        active = null;
        changed = true;
        addIssue("mismatched_close", `</${token.kind}> 与当前 <${previous}> 不匹配，已按当前块闭合`);
      } else {
        if (suppressedClosings.delete(token.kind)) {
          changed = true;
          addIssue("mismatched_close", `</${token.kind}> 对应的外层块已在嵌套修补时闭合`);
        } else {
          output += source.slice(token.index, token.end);
          addIssue("unmatched_close", `没有对应开标签的 </${token.kind}>`, false);
        }
      }
      cursor = token.end;
      continue;
    }

    if (token.selfClosing) {
      if (active) {
        changed = true;
        addIssue("self_closing", `<${token.kind}/> 出现在已打开的 <${active}> 内，已移除空标签`);
      } else {
        output += source.slice(token.index, token.end);
        addIssue("self_closing", `顶层 <${token.kind}/> 无法判断应归属的正文`, false);
      }
      cursor = token.end;
      continue;
    }

    if (active) {
      suppressedClosings.add(active);
      output += `</${active}>`;
      changed = true;
      addIssue("nested", `<${token.kind}> 嵌套在 <${active}> 内，已先闭合外层块`);
      active = null;
    }
    output += source.slice(token.index, token.end);
    active = token.kind;
    cursor = token.end;
  }

  output += source.slice(cursor);
  if (active) {
    output += `</${active}>`;
    changed = true;
    addIssue("unclosed", `<${active}> 缺少闭合标签，已补齐`);
  }
  if (diagDepth > 0) {
    changed = true;
    addIssue("unclosed", `<diag> 缺少闭合标签，已移除诊断包装`);
  }

  if (!safe) return { text: source, changed: false, safe: false, issues };
  return { text: output, changed, safe: true, issues };
}

function invalidTagDetail(token: BlockTagToken): string | null {
  const attrs = token.attrs.replace(/\/\s*$/, "").trim();
  if (token.closing) {
    return attrs ? `</${token.kind}> 不能带属性` : null;
  }
  if (token.kind === "act" || token.kind === "dlg") {
    return attrs && !/^who\s*=\s*(?:"[^"]*"|'[^']*')$/i.test(attrs)
      ? `<${token.kind}> 的标签属性只能是带引号的 who`
      : null;
  }
  return attrs ? `<${token.kind}> 不能带属性` : null;
}

/**
 * 把模型输出拆成块。
 *
 * 流式场景下最后一个块常常还没闭合，所以未闭合的开标签也按对应块渲染，
 * 否则打字机打到一半会把旁白显示成对白。
 * 不带任何标记的纯文本按角色对白处理，保证旧回复也能显示。
 */
export function parseBlocks(raw: string): MessageBlock[] {
  return parseBlocksInternal(repairBlockStructure(stripPseudoToolTags(raw)).text, true);
}

/**
 * 和 parseBlocks 一样，但不做 act 降级：模型写成什么样就是什么样。
 *
 * 只给质量检查用。渲染必须走 parseBlocks（不规范的 act 会降级成 narr，
 * 免得界面把第二段旁白画成金色动作），但检查要看的是模型的原始行为——
 * 被降级掉的那条 act 恰恰是最该计进 invalidActCount 的样本。
 */
export function parseRawBlocks(raw: string): MessageBlock[] {
  return parseBlocksInternal(repairBlockStructure(stripPseudoToolTags(raw)).text, false);
}

function parseBlocksInternal(raw: string, degradeAct: boolean): MessageBlock[] {
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
        pushBlock(blocks, open.kind, raw.slice(open.textStart, match.index), open.who, degradeAct);
        open = null;
        last = match.index + match[0].length;
      }
      continue;
    }

    // If a malformed response starts another block before closing the previous
    // one, keep both blocks visible instead of letting the first one swallow it.
    if (open) {
      pushBlock(blocks, open.kind, raw.slice(open.textStart, match.index), open.who, degradeAct);
    } else {
      pushDialogue(blocks, raw.slice(last, match.index));
    }

    const whoMatch = WHO_ATTRIBUTE.exec(match[3]);
    const who = whoMatch?.[1] ?? whoMatch?.[2];
    open = {
      kind,
      who: who === undefined ? undefined : decodeBlockAttribute(who),
      textStart: match.index + match[0].length,
    };
  }

  if (open) {
    pushBlock(blocks, open.kind, raw.slice(open.textStart), open.who, degradeAct);
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

function pushBlock(
  blocks: MessageBlock[],
  kind: BlockKind,
  text: string,
  who?: string,
  degradeAct = true,
) {
  const value = text.trim();
  if (!value) return;

  // act 是界面上的金色“即时动作”层，不应该成为第二段旁白。
  // 模型偶尔会把连续动作、结果解释或说话内容塞进 act。与其错误地渲染成动作，
  // 不如降级到 narr：内容仍保留，但视觉语义不会误导玩家。
  if (kind === "act" && degradeAct && !isAtomicAct(value)) {
    blocks.push({ kind: "narr", text: value });
    return;
  }
  blocks.push({ kind, who, text: value });
}

/**
 * act 的硬上限。
 *
 * 检查器和解析器共用这一个数：解析器拿它决定「要不要降级成旁白」，
 * 检查器拿它统计 act 过长。两处各写一个数字，基线就会和实际渲染对不上。
 */
export const ACT_MAX_LENGTH = 24;

/** 判断 act 是否仍然是一个旁观者能直接看见的单一动作。 */
export function isAtomicAct(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > ACT_MAX_LENGTH) return false;
  if (/[，,；;：:！？!?]/.test(value)) return false;
  if (/(?:然后|于是|随后|接着|说完|只是|却|便|才|没|不再|因为|所以|好像|似乎|像是|仿佛)/.test(value)) {
    return false;
  }
  if (/(?:说|问|答|回答|开口|补充|解释|喊|叫|低声|轻声|声音|语气|话音)/.test(value)) {
    return false;
  }
  return true;
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
        return `<${block.kind} who="${encodeBlockAttribute(block.who ?? "")}">${block.text}</${block.kind}>`;
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
