import { applyMacros } from "./macros";
import { blocksToPlainText, parseBlocks } from "@/lib/blocks";
import {
  estimateTokens,
  PER_MESSAGE_OVERHEAD,
  trimHistory,
} from "./budget";
import {
  BASE_RULES,
  DEFAULT_RESPONSE_TOKENS,
  OUTPUT_CONTRACT,
  STYLE_PROMPTS,
} from "./system";
import { markCache, prefixFingerprint } from "./cache";
import { formatFacts, needsSummarize } from "./summarize";
import {
  INJECTION_GROUPS,
  matchWorldBook,
  type InjectionGroup,
} from "./worldbook";
import type {
  AssembleInput,
  AssembleResult,
  BudgetReport,
  ChatMessage,
  NotePosition,
  WorldBookEntry,
} from "./types";

/* ---------------------------------------------------------------- 类型导出 */

export * from "./types";
export { applyMacros } from "./macros";
export {
  parseBlocks,
  blocksToRaw,
  blocksToPlainText,
  stripBlocks,
} from "@/lib/blocks";
export type { BlockKind, MessageBlock, PlainTextOptions } from "@/lib/blocks";
export {
  estimateTokens,
  estimateMessages,
  trimHistory,
  PER_MESSAGE_OVERHEAD,
} from "./budget";
export {
  BASE_RULES,
  OUTPUT_CONTRACT,
  STYLE_PROMPTS,
  DEFAULT_RESPONSE_TOKENS,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_USER_NAME,
  SUMMARIZE_THRESHOLD_TOKENS,
} from "./system";
export { matchWorldBook, rollDice, buildScanText } from "./worldbook";
export {
  buildSummarizeMessages,
  formatFacts,
  needsSummarize,
  applySummary,
  appendSummary,
  emptySummary,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_TARGET_TOKENS,
} from "./summarize";
export { mergeFacts, parseFactsPayload, sanitizeFacts } from "./facts";
export {
  buildSuggestionMessages,
  parseSuggestions,
  SUGGESTION_SYSTEM_PROMPT,
} from "@/lib/suggest";
export {
  hashString,
  prefixFingerprint,
  markCache,
  cacheStatsFor,
  resetCacheStats,
  CacheStats,
} from "./cache";
export type { CacheObservation } from "./cache";

/* ---------------------------------------------------------------- 预算 */

/**
 * 可用预算：maxContext - responseTokens - 3。
 * 那 3 个 token 给结尾收尾留的，照减就行。
 */
export function planBudget(
  maxContext: number,
  responseTokens = DEFAULT_RESPONSE_TOKENS,
): number {
  return Math.max(0, maxContext - responseTokens - 3);
}

/* ---------------------------------------------------------------- 组装 */

/** 只放 content。keys 是命中索引，永远不进提示词。 */
function contents(entries: WorldBookEntry[]): string[] {
  return entries.map((entry) => entry.content).filter((text) => text.length > 0);
}

/**
 * 常驻条目进前缀，关键词条目放到历史后面。
 * 关键词命中会随对话变，若塞进前缀，缓存每换一个词就失效。
 */
function stableContents(entries: WorldBookEntry[]): string[] {
  return contents(entries.filter((entry) => entry.constant === true));
}

function triggeredContents(entries: WorldBookEntry[]): string[] {
  return contents(entries.filter((entry) => entry.constant !== true));
}

/**
 * 提示词组装。纯函数：同样的输入永远得到同样的输出。
 *
 * 顺序固定，字节级稳定：
 *   System（核心规则 + 输出协议 + 卡上的 system_prompt）
 *   → [世界书 before_char]
 *   → 角色卡（description + personality + 对话示例，persona 紧跟）
 *   → [世界书 after_char]
 *   → Author's Note（after_char）
 *   → 场景
 *   → [世界书 before_scene / after_scene]
 *   → Author's Note（after_scenario）
 *   → 风格包
 *   → 关键事实
 *   → 滚动摘要
 *   → 最近历史（最新优先，先丢中间；in_chat 的 Author's Note 按 depth 插进历史）
 *   → [世界书 in_chat]
 *   → post_history_instructions
 *
 * 前缀（System 到摘要）不含任何变量内容——没有时间戳、随机数、请求 ID——
 * 所以字节级稳定，各家的前缀缓存才打得中。缓存断点打在前缀最后一条上。
 */
export function assemble(input: AssembleInput): AssembleResult {
  const {
    card,
    lorebook,
    persona,
    history,
    seed,
    turn = 0,
    summary,
    facts,
    authorNote,
    style,
    userName = "你",
  } = input;

  const apply = (text: string) =>
    applyMacros(text, { char: card.name, user: userName });

  const book = matchWorldBook({
    lorebook,
    history,
    seed,
    budgetCap: lorebook?.budgetCap,
    tokenCap: lorebook?.tokenCap,
  });

  const note = selectAuthorNote(authorNote, turn);
  const notePosition = note?.position ?? "after_scenario";
  const noteMessage: ChatMessage | undefined = note
    ? { role: "system", content: apply(note.text) }
    : undefined;

  /* ---- 前缀：字节级稳定 ---- */

  const prefix: ChatMessage[] = [];

  // 1. 核心规则
  prefix.push({ role: "system", content: BASE_RULES });
  prefix.push({ role: "system", content: OUTPUT_CONTRACT });
  if (card.system_prompt?.trim()) {
    prefix.push({ role: "system", content: apply(card.system_prompt) });
  }

  // 2. 常驻世界书 before_char。关键词条目不进前缀，免得缓存跟着命中闪断
  for (const text of stableContents(book.group.before_char)) {
    prefix.push({ role: "system", content: apply(text) });
  }

  // 3. 角色卡
  prefix.push({
    role: "system",
    content: [
      `角色名：${card.name}`,
      `设定：${apply(card.description)}`,
      `性格：${apply(card.personality)}`,
    ].join("\n"),
  });

  if (card.mes_example?.trim()) {
    prefix.push({ role: "system", content: `对话示例：\n${apply(card.mes_example)}` });
  }

  if (persona?.trim()) {
    prefix.push({ role: "system", content: `玩家设定：${apply(persona)}` });
  }

  // 4. 世界书 after_char，然后是挂在角色后面的作者注
  for (const text of stableContents(book.group.after_char)) {
    prefix.push({ role: "system", content: apply(text) });
  }
  if (noteMessage && notePosition === "after_char") {
    prefix.push(noteMessage);
  }

  // 5. 场景
  if (card.scenario.trim()) {
    prefix.push({
      role: "system",
      content: `当前场景：${apply(card.scenario)}`,
    });
  }

  // 6. 世界书 before_scene / after_scene，然后是挂在场景后面的作者注
  for (const text of stableContents(book.group.before_scene)) {
    prefix.push({ role: "system", content: apply(text) });
  }
  for (const text of stableContents(book.group.after_scene)) {
    prefix.push({ role: "system", content: apply(text) });
  }
  if (noteMessage && notePosition === "after_scenario") {
    prefix.push(noteMessage);
  }

  // 7. 风格包
  if (style) {
    prefix.push({ role: "system", content: STYLE_PROMPTS[style] });
  }

  // 8. 关键事实
  if (facts) {
    const text = formatFacts(facts);
    if (text) {
      prefix.push({ role: "system", content: `已确认的事实：\n${text}` });
    }
  }

  // 9. 滚动摘要
  if (summary?.text) {
    prefix.push({
      role: "system",
      content: `之前的剧情：\n${apply(summary.text)}`,
    });
  }

  const markedPrefix = input.cache === false ? prefix : markCache(prefix);
  const prefixTokens = tokenSum(markedPrefix);

  /* ---- 后置：不进前缀，避免影响缓存 ---- */

  const post: ChatMessage[] = [];
  for (const group of [
    book.group.before_char,
    book.group.after_char,
    book.group.before_scene,
    book.group.after_scene,
  ]) {
    for (const text of triggeredContents(group)) {
      post.push({ role: "system", content: apply(text) });
    }
  }
  for (const text of contents(book.group.in_chat)) {
    post.push({ role: "system", content: apply(text) });
  }
  if (card.post_history_instructions?.trim()) {
    post.push({
      role: "system",
      content: apply(card.post_history_instructions),
    });
  }
  const inChatNote = noteMessage && notePosition === "in_chat" ? noteMessage : undefined;
  const postTokens = tokenSum(post) + (inChatNote ? tokenSum([inChatNote]) : 0);

  /* ---- 历史：最新优先，先丢中间 ---- */

  const historyBudget = Math.max(0, input.budget - prefixTokens - postTokens);
  // 玩家那几轮在存储里带 <player> 标记（导出时要能区分），
  // 但模型只需要看到玩家说了什么，role 已经说明是谁说的了
  const trimmed = trimHistory(normalizeHistory(history), historyBudget);
  const kept = inChatNote
    ? insertAtDepth(trimmed.kept, inChatNote, authorNote?.depth ?? 0)
    : trimmed.kept;

  const messages: ChatMessage[] = [...markedPrefix, ...kept, ...post];

  const used = prefixTokens + trimmed.tokens + postTokens;

  const budget: BudgetReport = {
    max: input.budget,
    used,
    remaining: Math.max(0, input.budget - used),
    blocks: {
      prefix: prefixTokens,
      history: trimmed.tokens,
      post: postTokens,
      lorebook: book.tokens,
    },
    dropped: trimmed.dropped,
    kept: trimmed.kept.length,
    lorebookEntries: countEntries(book.group),
  };

  // 指纹只覆盖前缀正文：角色卡一改这个值就变，缓存自然失效，不会串卡。
  // cache_control 是标记，不参与指纹。
  const cacheKey = prefixFingerprint(markedPrefix.map((m) => m.content));

  return {
    messages,
    budget,
    cacheKey,
    needsSummarize: needsSummarize(history, summary),
  };
}

function tokenSum(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD,
    0,
  );
}

/** 抹掉玩家消息里的 <player> 标记。assistant 的块标记保留，模型要照着格式续写。 */
function normalizeHistory(history: ChatMessage[]): ChatMessage[] {
  return history.map((message) =>
    message.role === "user"
      ? {
          ...message,
          content: blocksToPlainText(parseBlocks(message.content), {
            quoteDialogue: false,
          }),
        }
      : message,
  );
}

/** depth 0 贴在历史最末，depth 1 插在最后一条之前，以此类推。 */
function insertAtDepth(history: ChatMessage[], note: ChatMessage, depth: number): ChatMessage[] {
  const index = Math.max(0, history.length - Math.max(0, depth));
  return [...history.slice(0, index), note, ...history.slice(index)];
}

function countEntries(group: Record<InjectionGroup, WorldBookEntry[]>): number {
  return INJECTION_GROUPS.reduce((sum, key) => sum + group[key].length, 0);
}

/**
 * Author's Note 的频率判定。0 = 从不，1 = 每轮，N = 每 N 轮。
 * 第 0 轮总是出现，否则开头几轮会没有作者注。
 */
export function selectAuthorNote(
  note: { text: string; frequency?: number; position?: NotePosition } | undefined,
  turn: number,
): { text: string; position?: NotePosition } | undefined {
  if (!note?.text?.trim()) return undefined;
  const frequency = note.frequency ?? 1;
  if (frequency === 0) return undefined;
  if (frequency === 1) return note;
  return turn % frequency === 0 ? note : undefined;
}
