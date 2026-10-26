import { estimateTokens, PER_MESSAGE_OVERHEAD } from "./budget";
import type { ChatMessage, LorebookTimingState, WorldBook, WorldBookEntry } from "./types";

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

/* ------------------------------------------------------------------ 来源 */

/**
 * 世界书的三个来源（Phase 8 第二阶段）。
 *
 * 分开的理由：一整套世界设定不该强行应用到所有角色和所有小说线。
 * 全局放「这个中继/这个部署通用」的东西，角色书跟着卡走，聊天书只影响这一场。
 */
export type LorebookSource = "global" | "card" | "chat";

export const LOREBOOK_SOURCES: readonly LorebookSource[] = ["global", "card", "chat"];

export const SOURCE_LABELS: Record<LorebookSource, string> = {
  global: "全局世界书",
  card: "角色世界书",
  chat: "当前聊天世界书",
};

/**
 * 同优先级时谁先入选。越具体的越靠前：聊天 > 角色 > 全局。
 * 一场对话里临时加的设定，应该压过全局的通用背景。
 */
const SOURCE_RANK: Record<LorebookSource, number> = { chat: 0, card: 1, global: 2 };

/* ------------------------------------------------------------------ 优先级 */

/**
 * 条目的优先级（Phase 8 第一阶段）。
 *
 * 常驻规则 → 当前场景相关 → 玩家刚提到的关键词 → 普通背景。
 * 这个顺序决定预算先花在谁身上：预算不够时，先丢背景条目，
 * 而不是让一条超长的背景把常驻规则挤掉。
 */
export type EntryPriority = "constant" | "scene" | "player" | "background";

export const ENTRY_PRIORITIES: readonly EntryPriority[] = [
  "constant",
  "scene",
  "player",
  "background",
];

export const PRIORITY_LABELS: Record<EntryPriority, string> = {
  constant: "常驻规则",
  scene: "当前场景相关",
  player: "玩家刚提到的关键词",
  background: "普通背景",
};

const PRIORITY_RANK: Record<EntryPriority, number> = {
  constant: 0,
  scene: 1,
  player: 2,
  background: 3,
};

export interface MatchedEntry {
  entry: WorldBookEntry;
  /** 命中的关键词，用于递归扫描。不进提示词 */
  matchedKeys: string[];
  /** 来自哪本世界书 */
  source: LorebookSource;
  /** 为什么入选、排在第几档 */
  priority: EntryPriority;
}

/** 一次匹配的观测数据。开发面板和跑批都读它。 */
export interface WorldBookReport {
  /** 命中了几条 */
  matched: number;
  /** 真正注入了几条 */
  injected: number;
  /** 因为预算被丢掉几条 */
  dropped: number;
  /** 各档命中数 */
  byPriority: Record<EntryPriority, number>;
  /** 各来源注入数 */
  bySource: Record<LorebookSource, number>;
  /** 用掉多少 token */
  tokens: number;
  tokenCap: number;
  budgetCap: number;
}

/** 一本世界书加上它的来源。 */
export interface SourcedLorebook {
  source: LorebookSource;
  book: Pick<WorldBook, "entries" | "scanDepth" | "budgetCap" | "tokenCap" | "recursiveScan">;
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
 * 把三本世界书合成一条候选列表。
 *
 * 只做合并和过滤，不排序也不判预算——那些在 matchWorldBook 里统一做，
 * 免得两个地方各有一套顺序。
 */
export function mergeLorebooks(books: readonly SourcedLorebook[]): Array<{
  entry: WorldBookEntry;
  source: LorebookSource;
  /** 条目在原书 entries 里的下标，时效状态拿它当稳定键 */
  index: number;
}> {
  const merged: Array<{ entry: WorldBookEntry; source: LorebookSource; index: number }> = [];
  for (const { source, book } of books) {
    (book?.entries ?? []).forEach((entry, index) => {
      if (entry.enabled === false) return;
      if (!entry.content.trim()) return;
      merged.push({ entry, source, index });
    });
  }
  return merged;
}

/**
 * 世界书匹配。单次向前扫描，按优先级抢预算。
 *
 * 五个关键点：
 * 1. 只有 content 会返回给组装器，keys 永远不进提示词。
 * 2. 概率判定用传入的 seed 做确定性随机，不用 Math.random，
 *    否则同样的输入会得到不同结果，前缀就不稳定了。
 * 3. **先分档再花预算**：常驻 → 场景相关 → 玩家刚提到 → 背景。
 *    预算不够时丢的是背景条目，不是常驻规则。
 * 4. 预算封顶按条目数和 token 数双重限制。装不下的跳过，继续看后面更小的，
 *    不要因为一条超长就把后面的常驻设定也丢掉。
 * 5. 递归只向前看：已经收下的条目内容可以触发排在后面的条目。
 *    全局 recursiveScan 打开时全部参与，否则只有 cascade 的条目会把自己的内容交出去。
 */
export function matchWorldBook(params: {
  /** 单本世界书，等价于只传角色世界书。旧调用点用这个。 */
  lorebook?: SourcedLorebook["book"];
  /** 多来源世界书。给了就忽略 lorebook。 */
  books?: readonly SourcedLorebook[];
  history: ChatMessage[];
  userMessage?: string;
  /**
   * 当前场景的文字（地点、在场的人）。条目的关键词命中这里就算「当前场景相关」，
   * 比命中几十轮前的历史更该入选。
   */
  sceneText?: string;
  seed: number;
  budgetCap?: number;
  tokenCap?: number;
  /** 当前轮次。sticky / cooldown / delay 都按它计数，不传按第 0 轮。 */
  turn?: number;
  /** 上一轮结束后的时效状态，用于 sticky 续期与 cooldown 判定 */
  timing?: LorebookTimingState;
}): {
  matched: MatchedEntry[];
  group: Record<InjectionGroup, WorldBookEntry[]>;
  tokens: number;
  report: WorldBookReport;
  /** 本轮结束后的时效状态，调用方原样带回下一轮 */
  timing: LorebookTimingState;
} {
  const {
    lorebook,
    books,
    history,
    userMessage,
    sceneText,
    seed,
    budgetCap = 8,
    tokenCap = 2000,
    turn = 0,
    timing: previousTiming,
  } = params;

  const sources: SourcedLorebook[] = books?.length
    ? [...books]
    : lorebook
      ? [{ source: "card", book: lorebook }]
      : [];

  const group = emptyGroup();
  const report = emptyReport(budgetCap, tokenCap);
  // 继承上一轮的记录：本轮没被激活的条目（cooldown 计时中、sticky 续期中）状态要原样带下去
  const timing: LorebookTimingState = { ...previousTiming };
  if (sources.length === 0) return { matched: [], group, tokens: 0, report, timing };

  // 扫描深度和递归开关取「最宽松的那一本」：三本世界书各配一套只会让人困惑
  const globalDepth = Math.max(...sources.map((item) => item.book?.scanDepth ?? 4));
  const recursive = sources.some((item) => item.book?.recursiveScan === true);

  const candidates = mergeLorebooks(sources);
  const sceneScan = sceneText ?? "";
  const playerScan = userMessage ?? "";

  const cascaded: string[] = [];
  const matched: MatchedEntry[] = [];

  candidates.forEach(({ entry, source, index }, flatIndex) => {
    /*
     * 时效门（酒馆 sticky / cooldown / delay 的移植）：
     * 只作用于关键词条目；常驻条目本来就每轮都在，不吃这套。
     * delay 管开头几轮，cooldown 管连续触发，sticky 管激活后多留几轮。
     */
    const turnNo = Math.max(0, Math.floor(turn));
    const timingKey = `${source}#${index}`;
    const prev = previousTiming?.[timingKey];
    const sticky = Math.max(0, Math.floor(entry.sticky ?? 0));
    const cooldown = Math.max(0, Math.floor(entry.cooldown ?? 0));
    const delay = Math.max(0, Math.floor(entry.delay ?? 0));

    if (entry.constant !== true) {
      if (turnNo < delay) return;
      // sticky 续期：上一轮激活过、窗口还没走完，关键词没中也不算断
      const stickyActive =
        sticky > 0 &&
        prev !== undefined &&
        prev.stickyLeft > 0 &&
        turnNo > prev.lastTurn &&
        turnNo <= prev.lastTurn + prev.stickyLeft;
      // 冷却从 sticky 窗口走完才开始算
      if (
        cooldown > 0 &&
        prev !== undefined &&
        !stickyActive &&
        turnNo > prev.lastTurn &&
        turnNo <= prev.lastTurn + prev.stickyLeft + cooldown
      ) {
        return;
      }
    }

    const depth = entry.scanDepth ?? globalDepth;
    const base = buildScanText(history, userMessage, depth);
    /*
     * 扫描文本 = 最近历史 + 本轮输入 + 当前场景 + 已收下的递归内容。
     *
     * 场景必须参与扫描：不然「当前场景相关」这一档永远命不中——
     * 只在场景里出现、历史里没提过的条目（比如角色刚走进的那间屋子）
     * 根本进不了候选，也就谈不上优先级。
     */
    const scanText = [base, sceneScan, ...cascaded].filter(Boolean).join("\n");

    let hits: string[] = [];
    let stickyRenewal = false;
    if (entry.constant === true) {
      hits = normalizeKeys(entry.keys);
    } else {
      const stickyActive =
        sticky > 0 &&
        prev !== undefined &&
        prev.stickyLeft > 0 &&
        turnNo > prev.lastTurn &&
        turnNo <= prev.lastTurn + prev.stickyLeft;
      hits = matchKeys(entry, scanText);
      if (hits.length === 0) {
        if (!stickyActive) return;
        // sticky 续期不再掷概率：上一轮既然激活了，这几轮就保持
        stickyRenewal = true;
        hits = normalizeKeys(entry.keys);
      } else {
        const probability = entry.probability ?? 100;
        if (probability < 100 && !rollDice(seed, entry.content, probability)) {
          return;
        }
      }
    }

    const priority = entryPriority(entry, { sceneScan, playerScan, index: flatIndex });
    report.byPriority[priority] += 1;
    matched.push({ entry, matchedKeys: hits, source, priority });

    // 全新激活才写时效；sticky 续期不刷新窗口，不然它会自己续命到天荒地老
    if (entry.constant !== true && !stickyRenewal && (sticky > 0 || cooldown > 0)) {
      timing[timingKey] = { lastTurn: turnNo, stickyLeft: sticky };
    }

    if (recursive || entry.cascade === true) {
      cascaded.push(entry.content);
    }
  });

  // 先按优先级排，再按 order、来源具体程度、原始顺序。
  // 排序必须发生在花预算之前，否则「优先级」只是个标签。
  const ordered = matched
    .map((item, index) => ({ item, weight: sortWeight(item, index) }))
    .sort((a, b) => a.weight - b.weight)
    .map((item) => item.item);

  const { selected, tokens, dropped } = capByBudget(ordered, budgetCap, tokenCap);
  for (const item of selected) {
    group[asGroup(item.entry.position)].push(item.entry);
    report.bySource[item.source] += 1;
  }

  report.matched = matched.length;
  report.injected = selected.length;
  report.dropped = dropped;
  report.tokens = tokens;

  return { matched, group, tokens, report, timing };
}

/**
 * 排序权重：优先级第一，同档里再比 order、来源具体程度和原始顺序。
 *
 * 拼成一个数字而不是多级比较，是因为预算分配要遍历这条排序结果，
 * 多级比较写成一次 sort 容易在改动时错位。
 */
function sortWeight(item: MatchedEntry, index: number): number {
  return (
    PRIORITY_RANK[item.priority] * 1_000_000 +
    Math.max(0, Math.min(999, item.entry.order ?? 100)) * 1_000 +
    SOURCE_RANK[item.source] * 100 +
    Math.min(99, index)
  );
}
/**
 * 判断一条命中的条目属于哪一档。
 *
 * 顺序不能反：常驻永远第一；场景相关排在玩家提到之前——
 * 玩家刚说的话和当前场景高度重叠，把场景排在前面更符合「现在正在发生的事优先」。
 */
function entryPriority(
  entry: WorldBookEntry,
  scan: { sceneScan: string; playerScan: string; index: number },
): EntryPriority {
  if (entry.constant === true) return "constant";
  const keys = normalizeKeys(entry.keys);
  if (keys.length === 0) return "background";
  // 场景和玩家输入常常重叠，两边都看，但场景优先
  if (scan.sceneScan && keys.some((key) => scan.sceneScan.includes(key))) return "scene";
  if (scan.playerScan && keys.some((key) => scan.playerScan.includes(key))) return "player";
  return "background";
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

function emptyReport(budgetCap: number, tokenCap: number): WorldBookReport {
  return {
    matched: 0,
    injected: 0,
    dropped: 0,
    byPriority: { constant: 0, scene: 0, player: 0, background: 0 },
    bySource: { global: 0, card: 0, chat: 0 },
    tokens: 0,
    tokenCap,
    budgetCap,
  };
}

function capByBudget(
  matched: MatchedEntry[],
  budgetCap: number,
  tokenCap: number,
): { selected: MatchedEntry[]; tokens: number; dropped: number } {
  const selected: MatchedEntry[] = [];
  let tokens = 0;
  let dropped = 0;

  for (const item of matched) {
    if (selected.length >= budgetCap) {
      dropped += 1;
      continue;
    }
    const cost = estimateTokens(item.entry.content) + PER_MESSAGE_OVERHEAD;
    if (tokens + cost > tokenCap) {
      // 装不下就跳过，继续看后面更小的：不要因为一条超长把常驻设定也丢掉
      dropped += 1;
      continue;
    }
    selected.push(item);
    tokens += cost;
  }

  return { selected, tokens, dropped };
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
