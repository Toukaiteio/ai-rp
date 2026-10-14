import { estimateTokens, PER_MESSAGE_OVERHEAD } from "./budget";
import type { ChatMessage, WorldBookEntry } from "./types";

/** 位置分组。数值只用来排序，不进提示词。 */
export const POSITION_ORDER = {
  before_char: 0,
  after_char: 1,
  before_scene: 2,
  after_scene: 3,
  in_chat: 4,
} as const;

/** 注入点。组装器按这个顺序把条目摊进提示词。 */
export const INJECTION_GROUPS = [
  "before_char",
  "after_char",
  "before_scene",
  "after_scene",
  "in_chat",
] as const;

export type InjectionGroup = (typeof INJECTION_GROUPS)[number];

export interface MatchedEntry {
  entry: WorldBookEntry;
  /** 命中的关键词，用于递归扫描。不进提示词 */
  matchedKeys: string[];
}

function normalizeKeys(keys: string[]): string[] {
  return keys.map((key) => key.trim()).filter((key) => key.length > 0);
}

/**
 * 扫描窗口：最近 scanDepth 条消息，加上本轮输入。
 * depth 为 0 时不看历史。slice(-0) 会返回全部，这里不能踩进去。
 */
export function buildScanText(
  history: ChatMessage[],
  userMessage: string | undefined,
  scanDepth: number,
): string {
  const depth = Math.max(0, scanDepth);
  const window = (depth === 0 ? [] : history.slice(-depth)).map((m) => m.content);
  if (userMessage) window.push(userMessage);
  return window.join("\n");
}

function matchKeys(entry: WorldBookEntry, scanText: string): string[] {
  const keys = normalizeKeys(entry.keys);
  if (keys.length === 0) return [];

  const hits = keys.filter((key) => scanText.includes(key));
  if (hits.length === 0) return [];
  // 没写 logic 时按 or：角色卡上的触发词是「提到其中任何一个就注入」，
  // 全部都要出现（and）得显式写上，否则一条四个词的设定永远打不中。
  const logic = entry.logic ?? "or";
  if (logic === "and" && hits.length < keys.length) return [];
  return hits;
}

/**
 * 世界书匹配。单次向前扫描，常驻条目优先。
 *
 * 三个关键点：
 * 1. 只有 content 会返回给组装器，keys 永远不进提示词。
 * 2. 概率判定用传入的 seed 做确定性随机，不用 Math.random，
 *    否则同样的输入会得到不同结果，前缀就不稳定了。
 * 3. 预算封顶按条目数和 token 数双重限制。装不下的跳过，继续看后面更小的，
 *    不要因为一条超长就把后面的常驻设定也丢掉。
 *
 * 递归只向前看：已经收下的条目内容可以触发排在后面的条目。
 * 全局 recursiveScan 打开时全部参与，否则只有 cascade 的条目会把自己的内容交出去。
 */
export function matchWorldBook(params: {
  lorebook: { entries: WorldBookEntry[]; scanDepth?: number; recursiveScan?: boolean } | undefined;
  history: ChatMessage[];
  userMessage?: string;
  seed: number;
  budgetCap?: number;
  tokenCap?: number;
}): {
  matched: MatchedEntry[];
  group: Record<InjectionGroup, WorldBookEntry[]>;
  tokens: number;
} {
  const {
    lorebook,
    history,
    userMessage,
    seed,
    budgetCap = 8,
    tokenCap = 2000,
  } = params;

  const group = emptyGroup();
  if (!lorebook?.entries?.length) {
    return { matched: [], group, tokens: 0 };
  }

  const globalDepth = lorebook.scanDepth ?? 4;
  const recursive = lorebook.recursiveScan === true;
  const candidates = lorebook.entries
    .filter((entry) => entry.enabled !== false && entry.content.trim().length > 0)
    .slice()
    .sort((a, b) => {
      const constantDelta = Number(b.constant === true) - Number(a.constant === true);
      if (constantDelta !== 0) return constantDelta;
      return (a.order ?? 100) - (b.order ?? 100);
    });

  const cascaded: string[] = [];
  const matched: MatchedEntry[] = [];

  for (const entry of candidates) {
    const depth = entry.scanDepth ?? globalDepth;
    const base = buildScanText(history, userMessage, depth);
    const scanText = cascaded.length > 0 ? `${base}\n${cascaded.join("\n")}` : base;

    let hits: string[] = [];
    if (entry.constant === true) {
      hits = normalizeKeys(entry.keys);
    } else {
      hits = matchKeys(entry, scanText);
      if (hits.length === 0) continue;
      const probability = entry.probability ?? 100;
      if (probability < 100 && !rollDice(seed, entry.content, probability)) {
        continue;
      }
    }

    matched.push({ entry, matchedKeys: hits });

    if (recursive || entry.cascade === true) {
      cascaded.push(entry.content);
    }
  }

  const { selected, tokens } = capByBudget(matched, budgetCap, tokenCap);
  for (const entry of selected) {
    group[asGroup(entry.position)].push(entry);
  }

  return { matched, group, tokens };
}

function asGroup(position: WorldBookEntry["position"]): InjectionGroup {
  if (position && (INJECTION_GROUPS as readonly string[]).includes(position)) {
    return position;
  }
  return "after_char";
}

function emptyGroup(): Record<InjectionGroup, WorldBookEntry[]> {
  return {
    before_char: [],
    after_char: [],
    before_scene: [],
    after_scene: [],
    in_chat: [],
  };
}

function capByBudget(
  matched: MatchedEntry[],
  budgetCap: number,
  tokenCap: number,
): { selected: WorldBookEntry[]; tokens: number } {
  const selected: WorldBookEntry[] = [];
  let tokens = 0;

  for (const item of matched) {
    if (selected.length >= budgetCap) break;
    const cost = estimateTokens(item.entry.content) + PER_MESSAGE_OVERHEAD;
    if (tokens + cost > tokenCap) continue;
    selected.push(item.entry);
    tokens += cost;
  }

  return { selected, tokens };
}

/**
 * 确定性随机。同样的 seed + key + probability 永远得到同样的结果。
 * 用 FNV-1a 把字符串摊成整数，再取模，不引入随机源。
 */
export function rollDice(seed: number, key: string, probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 100) return true;
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const value = Math.abs(hash) % 100;
  return value < probability;
}
