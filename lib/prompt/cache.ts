import type { ChatMessage } from "./types";

/**
 * 前缀指纹。
 *
 * 缓存靠的就是这个：只要 System、角色卡、风格包、世界书、摘要这些
 * 前缀内容字节级不变，这个哈希就不变，可以直接当缓存版本用。
 *
 * 用 FNV-1a 而不是 crypto：组装器要在纯函数环境里跑，
 * 不能依赖 Node 的 crypto 模块，也不能有异步。
 */
export function hashString(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 转无符号再取 16 进制，避免负数
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 拼前缀指纹时用的分隔。用不可见字符降低和正文撞车的概率。 */
const SEP = "\u0001";

export function prefixFingerprint(parts: Array<string | undefined>): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    chunks.push(hashString(part));
  }
  return hashString(chunks.join(SEP));
}

/**
 * 给缓存块末尾打断点。
 *
 * Anthropic 需要显式的 cache_control，OpenAI 是自动前缀缓存，
 * 但两者都要求断点之前的内容完全一致——所以前缀绝不能带时间戳、
 * 随机数、请求 ID 这类变量内容。
 */
export function markCache(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.cache_control) return messages;
  return [
    ...messages.slice(0, -1),
    { ...last, cache_control: { type: "ephemeral" } },
  ];
}

/**
 * 一次组装的缓存观测数据。
 * 只用于内测统计，不展示给玩家——把命中率摆到界面上是调试信息，不是玩法。
 */
export interface CacheObservation {
  key: string;
  prefixTokens: number;
  totalTokens: number;
}

/** 命中率计数器。进程内累加，够内测观察用。 */
export class CacheStats {
  private hits = 0;
  private misses = 0;
  private lastKey: string | null = null;

  /** 同一 key 连续出现即视为命中前缀缓存 */
  observe(key: string): boolean {
    const hit = this.lastKey === key;
    if (hit) this.hits++;
    else this.misses++;
    this.lastKey = key;
    return hit;
  }

  /** 换卡或改卡时调用，避免把不同卡的前缀算成命中 */
  invalidate(): void {
    this.lastKey = null;
  }

  rate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  snapshot(): { hits: number; misses: number; rate: number } {
    return { hits: this.hits, misses: this.misses, rate: this.rate() };
  }
}

/** 按会话维度记，避免不同会话互相污染命中率 */
const bySession = new Map<string, CacheStats>();

export function cacheStatsFor(sessionId: string): CacheStats {
  let stats = bySession.get(sessionId);
  if (!stats) {
    stats = new CacheStats();
    bySession.set(sessionId, stats);
  }
  return stats;
}

export function resetCacheStats(): void {
  bySession.clear();
}
