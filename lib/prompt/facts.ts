import type { KeyFacts } from "./types";

const MAX_CHARACTERS = 20;
const MAX_PLACES = 20;
const MAX_FLAGS = 40;
const MAX_FACT_KEY = 24;
const MAX_FACT_VALUE = 60;

function clipFact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** 模型偶尔漏掉闭合标签。这里连没闭合的那一段也一起收走，别让 JSON 混进摘要正文。 */
const FACTS_BLOCK = /<facts>\s*([\s\S]*?)\s*(?:<\/facts>|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    const name = clipFact(key, MAX_FACT_KEY);
    const state = clipFact(item, MAX_FACT_VALUE);
    if (!name || !state) continue;
    out[name] = state;
  }
  return out;
}

function flagMap(value: unknown): Record<string, boolean | string> {
  if (!isRecord(value)) return {};
  const out: Record<string, boolean | string> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = clipFact(key, MAX_FACT_KEY);
    if (!name) continue;
    if (typeof item === "boolean") out[name] = item;
    else if (typeof item === "string" && item.trim()) out[name] = clipFact(item, MAX_FACT_VALUE);
  }
  return out;
}

/** 把模型随手吐出来的 JSON 收成关键事实。坏掉的字段丢掉，不让它污染已有记录。 */
export function sanitizeFacts(value: unknown): KeyFacts | null {
  if (!isRecord(value)) return null;
  const facts: KeyFacts = {
    characters: stringMap(value.characters),
    places: stringMap(value.places),
    flags: flagMap(value.flags),
  };
  if (
    Object.keys(facts.characters).length === 0 &&
    Object.keys(facts.places).length === 0 &&
    Object.keys(facts.flags).length === 0
  ) {
    return null;
  }
  return facts;
}

/**
 * 从摘要回复里拆出正文和事实块。
 * 没有 `<facts>` 就整段当正文。JSON 坏了只丢掉事实，正文照留。
 */
export function parseFactsPayload(text: string): { prose: string; facts: KeyFacts | null } {
  const match = FACTS_BLOCK.exec(text);
  if (!match) return { prose: text.trim(), facts: null };
  const prose = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  try {
    return { prose, facts: sanitizeFacts(JSON.parse(match[1])) };
  } catch {
    return { prose, facts: null };
  }
}

/**
 * 合并事实。已有的键可以被更新，但不会被删掉。
 * 超上限时留下先记下的那些，新的挤不进去也不覆盖旧的——事实一漂移，长对话就串了。
 */
export function mergeFacts(base: KeyFacts, patch: KeyFacts | null | undefined): KeyFacts {
  return {
    characters: capMerge(base.characters ?? {}, patch?.characters ?? {}, MAX_CHARACTERS),
    places: capMerge(base.places ?? {}, patch?.places ?? {}, MAX_PLACES),
    flags: capMerge(base.flags ?? {}, patch?.flags ?? {}, MAX_FLAGS),
  };
}

function capMerge<T>(base: Record<string, T>, patch: Record<string, T>, max: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(base)) {
    if (Object.keys(out).length >= max) break;
    out[key] = key in patch ? patch[key] : value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key in out) {
      out[key] = value;
      continue;
    }
    if (Object.keys(out).length >= max) continue;
    out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ 剧情线 */

const MAX_THREADS = 4;
const MAX_THREAD_CHARS = 60;

/**
 * 从关键事实里挑出「还没结束的事」，再并上场景状态里的未收线。
 *
 * 为什么用 flags：记忆工具只分人物、地点、事件三类，其中事件天然对应「发生过的
 * 一件事」。项目规定「不要发明原设定里没有的」，所以这里不新造剧情线数据结构，
 * 而是复用已有的 flags——键是事件名，值是状态字符串。
 *
 * 判定规则：值为 true 或空串表示「还在进行」；值形如「已…/完…/结束/解决」表示已经收尾，
 * 不再挂到回合层里。这样模型记完一件事，把状态改成「已完成」就能让它从剧情线里消失。
 *
 * 场景状态里的 unresolvedThreads 是导演每轮更新的「此刻还没收的线」，
 * 比 flags 更贴近当下，所以排在最前面。
 */
export function activeThreads(
  facts: KeyFacts | undefined,
  limit = MAX_THREADS,
  sceneThreads: string[] = [],
): string[] {
  const threads: string[] = [];
  const seen = new Set<string>();

  const push = (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_THREAD_CHARS);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    threads.push(clean);
  };

  for (const thread of sceneThreads) push(thread);
  for (const [name, state] of Object.entries(facts?.flags ?? {})) {
    if (!isActiveFlag(state)) continue;
    const detail =
      typeof state === "string" && state.trim() ? `（${clipFact(state, MAX_THREAD_CHARS)}）` : "";
    push(`${name}${detail}`);
  }

  return threads.slice(0, limit);
}

/** 收尾词。命中就认为这条线已经结束，不再占回合层的注意力。 */
const CLOSED_FLAG = /(?:已完|完成|结束|解决|了结|收尾|closed|done|resolved)/i;

function isActiveFlag(state: boolean | string): boolean {
  if (state === true) return true;
  if (state === false) return false;
  return !CLOSED_FLAG.test(state);
}
