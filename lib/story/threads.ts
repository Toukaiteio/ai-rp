/**
 * 剧情线的更新与挑选。
 *
 * 两件事，都是纯函数：
 * 1. `applyThreadPatch`：把导演给的剧情线变化合进列表。核心是**已解决的线不能复活**；
 * 2. `selectThreads`：从一堆线里挑出**这一轮值得注入的几条**。
 *
 * 挑选是 Phase 6 的重点。不要每轮注入全部剧情线——那会变成每轮提醒模型
 * 「你还有 7 个悬念」，模型就开始硬推进。只注入四种：
 * 当前场景相关、最近被提到、高重要度、玩家主动追问。
 */
import {
  MAX_IMPORTANCE,
  MAX_THREADS,
  MIN_IMPORTANCE,
  type StoryThread,
  type ThreadPatchEntry,
  type ThreadStatus,
  type ThreadUpdate,
} from "./types";

export { MAX_THREADS };
export type { StoryThread, ThreadStatus, ThreadPatchEntry, ThreadUpdate };

const MAX_TITLE_CHARS = 40;
const MAX_SUMMARY_CHARS = 120;
const MAX_RELATED = 6;
const MAX_REWARD_CHARS = 100;

/** 把外来的 JSON 收成一条剧情线变化。坏字段丢掉，不影响其它线。 */
export function sanitizeThreadPatch(raw: unknown): ThreadPatchEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ThreadPatchEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = text(item.title, MAX_TITLE_CHARS);
    if (!title) continue;
    entries.push({
      ...(text(item.id, 60) ? { id: text(item.id, 60) as string } : {}),
      title,
      ...(text(item.summary, MAX_SUMMARY_CHARS) ? { summary: text(item.summary, MAX_SUMMARY_CHARS) as string } : {}),
      ...(isStatus(item.status) ? { status: item.status } : {}),
      ...(importance(item.importance) !== undefined ? { importance: importance(item.importance) } : {}),
      ...(list(item.relatedCharacters) ? { relatedCharacters: list(item.relatedCharacters) as string[] } : {}),
      ...(item.kind === "goal" ? { kind: "goal" as const } : {}),
      ...(text(item.reward, MAX_REWARD_CHARS) ? { reward: text(item.reward, MAX_REWARD_CHARS) as string } : {}),
    });
  }
  return entries;
}

/**
 * 把一批变化合进剧情线列表。
 *
 * 三条规则：
 * 1. **按 id 或标题认线**：导演不用记住 id，写标题也能更新同一条线；
 * 2. **已解决的线不能复活**：resolved 的线再被提到，只会刷新 lastActiveAt，
 *    状态和内容都不变，并记进 blocked 让人看见；
 * 3. **只写变了的**：没提到的线原样保留。
 */
export function applyThreadPatch(
  threads: readonly StoryThread[],
  patch: readonly ThreadPatchEntry[],
  turn: number,
  options: { now?: number; idFactory?: (title: string) => string } = {},
): ThreadUpdate {
  const next = threads.map((thread) => ({ ...thread, relatedCharacters: [...thread.relatedCharacters] }));
  const created: StoryThread[] = [];
  const updated: StoryThread[] = [];
  const resolved: StoryThread[] = [];
  const blocked: StoryThread[] = [];

  for (const entry of patch) {
    const existing = findThread(next, entry);

    if (!existing) {
      const thread: StoryThread = {
        id: entry.id?.trim() || options.idFactory?.(entry.title) || makeId(entry.title, turn),
        title: entry.title,
        summary: entry.summary ?? "",
        // 新线默认 open：导演提到它，说明它现在悬着
        status: entry.status ?? "open",
        importance: entry.importance ?? 3,
        lastActiveAt: turn,
        relatedCharacters: entry.relatedCharacters ?? [],
        ...(entry.kind ? { kind: entry.kind } : {}),
        ...(entry.reward ? { reward: entry.reward } : {}),
      };
      // 新线直接就是 resolved 的没有意义，不入库
      if (thread.status === "resolved") continue;
      next.push(thread);
      created.push(thread);
      continue;
    }

    existing.lastActiveAt = turn;

    // 已解决的线不能复活：只刷新「最近提到」，内容一个字都不改
    if (existing.status === "resolved") {
      blocked.push(existing);
      continue;
    }

    const before = snapshot(existing);
    if (entry.summary) existing.summary = entry.summary;
    if (entry.importance !== undefined) existing.importance = entry.importance;
    if (entry.relatedCharacters) existing.relatedCharacters = entry.relatedCharacters;
    if (entry.kind) existing.kind = entry.kind;
    if (entry.reward) existing.reward = entry.reward;
    if (entry.status) existing.status = entry.status;

    if (changed(before, existing)) {
      updated.push(existing);
      if (existing.status === "resolved") resolved.push(existing);
    }
  }

  return { threads: capThreads(next), created, updated, resolved, blocked };
}

/** 一条线的一轮上下文。挑选和拼提示词都用它。 */
export interface ThreadContext {
  /** 这一轮的玩家输入 */
  playerInput: string;
  /** 最近若干轮的正文（含玩家和角色），用来判断「最近被提到」 */
  recentText: string;
  /** 当前场景里的人和地点，用来判断「当前场景相关」 */
  presentCharacters: string[];
  location: string;
  /** 当前轮次 */
  turn: number;
  /** 最多注入几条 */
  limit?: number;
}

/** 注入条数上限。三条是刻意压的：多了就变成每轮提醒「你还有一堆悬念」。 */
export const DEFAULT_THREAD_LIMIT = 3;
/** 超过这么多轮没被提到，就不再算「最近提到」。 */
export const RECENT_TURNS = 8;

export interface SelectedThread {
  thread: StoryThread;
  /** 为什么选中它，开发面板和日志用 */
  reason: string;
  score: number;
}

/**
 * 挑出这一轮值得注入的剧情线。
 *
 * 四个入选理由，对应 5.2 里「只注入」的四条：
 * - `玩家追问`：玩家这句话里出现了线的标题或相关角色 —— 最强信号，直接入选；
 * - `最近提到`：最近几轮的正文里出现过；
 * - `当前场景相关`：相关角色在场，或者线的摘要里提到了当前地点；
 * - `高重要度`：重要度 4 以上，即使最近没提到也留一条。
 *
 * 其余的一律不注入。宁可让模型忘掉几条线，也不要每轮把「还有几个悬念」
 * 摆在它面前——那会把它逼成一个急着收线的写手。
 */
export function selectThreads(
  threads: readonly StoryThread[],
  context: ThreadContext,
): SelectedThread[] {
  const limit = context.limit ?? DEFAULT_THREAD_LIMIT;
  const present = context.presentCharacters.map((name) => name.toLowerCase());
  const location = context.location.trim().toLowerCase();

  const scored: SelectedThread[] = [];

  for (const thread of threads) {
    // 已解决的不再注入；搁置的只在玩家追问时注入
    if (thread.status === "resolved") continue;

    const summary = thread.summary.toLowerCase();
    const related = thread.relatedCharacters.map((name) => name.toLowerCase());

    // 玩家主动追问：最强信号
    const asked =
      context.playerInput.length > 0 &&
      (related.some((name) => name.length > 0 && context.playerInput.toLowerCase().includes(name)) ||
        sharedTopic(context.playerInput, thread.title));
    if (asked) {
      scored.push({ thread, reason: "玩家追问", score: 100 });
      continue;
    }

    if (thread.status === "dormant") continue;

    const mentioned = sharedTopic(context.recentText, thread.title);
    const inScene =
      related.some((name) => present.includes(name)) || (location.length > 0 && summary.includes(location));
    const hot = thread.importance >= 4;
    // 「最近提到」要同时满足：正文里出现过，而且这条线本身也够新。
    // 只看正文会出现「几十轮没动的线因为一次回顾被当成当前剧情」。
    const fresh = context.turn - thread.lastActiveAt <= RECENT_TURNS;
    const recentlyMentioned = mentioned && fresh;

    if (!recentlyMentioned && !inScene && !hot) continue;

    let score = thread.importance * 10;
    const reasons: string[] = [];
    if (recentlyMentioned) {
      score += 30;
      reasons.push("最近提到");
    }
    if (inScene) {
      score += 25;
      reasons.push("当前场景相关");
    }
    if (hot) {
      score += 10;
      reasons.push("高重要度");
    }
    scored.push({ thread, reason: reasons.join("·") || "重要度", score });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.thread.lastActiveAt - a.thread.lastActiveAt)
    .slice(0, limit);
}

/**
 * 拼进提示词的一段。
 *
 * 措辞上有意压着：只说「这些事还没交代完，合适的时候再接」，
 * 不说「请推进这些剧情线」。前者让模型把它当背景，后者会让它急着收线。
 */
export function formatThreads(selected: readonly SelectedThread[]): string {
  if (selected.length === 0) return "";
  const lines = selected.map((item) => {
    const detail = item.thread.summary.trim();
    const goal = item.thread.kind === "goal" ? "【目标】" : "";
    const reward = item.thread.reward ? `（完成后：${item.thread.reward}）` : "";
    return `- ${goal}${item.thread.title}${detail ? `：${detail}` : ""}${reward}`;
  });
  return [
    "还没交代完的几件事（只是背景，不要为了它们硬推进，也不要在正文里提起这个列表）：",
    ...lines,
  ].join("\n");
}

/* ------------------------------------------------------------------ 内部 */

function findThread(threads: StoryThread[], entry: ThreadPatchEntry): StoryThread | undefined {
  const id = entry.id?.trim();
  if (id) {
    const byId = threads.find((thread) => thread.id === id);
    if (byId) return byId;
  }
  const title = entry.title.toLowerCase();
  const exact = threads.find((thread) => thread.title.toLowerCase() === title);
  if (exact) return exact;
  // 互相包含：模型把「左手绷带的来历」写成「绷带」也能认回同一条线。
  // 只挡掉单字标题（「她」这种会匹配到一切），两个字以上就允许模糊匹配。
  if (title.length < 2) return undefined;
  return threads.find((thread) => {
    const other = thread.title.toLowerCase();
    if (other.length < 2) return false;
    if (other.length < 4 && title.length < 4) return false;
    return other.includes(title) || title.includes(other);
  });
}

/**
 * 判断两段中文是不是在说同一件事。
 *
 * 中文没有空格，没法按词比对，只能按字。先用 3 字片段找，找不到再退到 2 字片段，
 * 并且跳过「什么、怎么、这个」这类虚词——否则任何一句问话都会命中一堆剧情线。
 * 这一步决定「玩家是不是在追问这条线」，宁可漏一条，也不要每轮都把线硬塞进去。
 */
const TOPIC_STOPWORDS = new Set([
  "什么", "怎么", "这个", "那个", "我们", "你们", "他们", "她们", "现在", "已经",
  "可以", "因为", "所以", "但是", "然后", "一个", "没有", "不是", "就是", "还是",
  "自己", "时候", "知道", "觉得", "这样", "那样", "东西", "事情",
]);

function sharedTopic(text: string, title: string): boolean {
  const haystack = text.toLowerCase().slice(0, 400);
  const needle = title.toLowerCase().trim();
  if (!haystack || !needle) return false;
  if (needle.length <= 3) return haystack.includes(needle);

  for (let size = 3; size >= 2; size -= 1) {
    for (let i = 0; i + size <= needle.length; i += 1) {
      const piece = needle.slice(i, i + size);
      if (size === 2 && TOPIC_STOPWORDS.has(piece)) continue;
      if (haystack.includes(piece)) return true;
    }
  }
  return false;
}

function snapshot(thread: StoryThread): string {
  return [thread.title, thread.summary, thread.status, thread.importance, thread.relatedCharacters.join("、")].join(
    "\u0001",
  );
}

function changed(before: string, thread: StoryThread): boolean {
  return snapshot(thread) !== before;
}

function capThreads(threads: StoryThread[]): StoryThread[] {
  if (threads.length <= MAX_THREADS) return threads;
  // 先丢最旧的已解决项，再丢最旧的搁置项，最后才动 open 的
  const rank = (thread: StoryThread) =>
    thread.status === "resolved" ? 0 : thread.status === "dormant" ? 1 : 2;
  return [...threads]
    .sort((a, b) => rank(a) - rank(b) || a.lastActiveAt - b.lastActiveAt)
    .slice(-MAX_THREADS)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
}

function makeId(title: string, turn: number): string {
  let hash = 2166136261;
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `t${(hash >>> 0).toString(16).slice(0, 6)}-${turn}`;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
  return clean || undefined;
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => text(item, 24))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items.slice(0, MAX_RELATED) : undefined;
}

function isStatus(value: unknown): value is ThreadStatus {
  return value === "open" || value === "resolved" || value === "dormant";
}

function importance(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_IMPORTANCE, Math.max(MIN_IMPORTANCE, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 旧存档补全。坏值丢掉，缺字段按默认值补。 */
export function normalizeThreads(value: unknown): StoryThread[] {
  if (!Array.isArray(value)) return [];
  const threads: StoryThread[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const title = text(item.title, MAX_TITLE_CHARS);
    if (!title) continue;
    threads.push({
      id: text(item.id, 60) ?? makeId(title, 0),
      title,
      summary: text(item.summary, MAX_SUMMARY_CHARS) ?? "",
      status: isStatus(item.status) ? item.status : "open",
      importance: importance(item.importance) ?? 3,
      lastActiveAt: typeof item.lastActiveAt === "number" ? Math.floor(item.lastActiveAt) : 0,
      relatedCharacters: list(item.relatedCharacters) ?? [],
    });
  }
  return capThreads(threads);
}
