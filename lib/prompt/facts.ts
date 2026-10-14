import type { KeyFacts } from "./types";

const MAX_CHARACTERS = 20;
const MAX_PLACES = 20;
const MAX_FLAGS = 40;

const FACTS_BLOCK = /<facts>\s*([\s\S]*?)\s*<\/facts>/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    const name = key.trim();
    const state = item.trim();
    if (!name || !state) continue;
    out[name] = state;
  }
  return out;
}

function flagMap(value: unknown): Record<string, boolean | string> {
  if (!isRecord(value)) return {};
  const out: Record<string, boolean | string> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = key.trim();
    if (!name) continue;
    if (typeof item === "boolean") out[name] = item;
    else if (typeof item === "string" && item.trim()) out[name] = item.trim();
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
