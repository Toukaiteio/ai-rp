/**
 * 未完成的剧情线。
 *
 * 它回答一个问题：**有哪些事还没交代完**。
 *
 * 和场景状态的分工：场景状态是「此刻」（在哪儿、谁在场），每轮覆盖；
 * 剧情线是「悬着的事」，会跨很多轮，有开有合。
 * 和记忆的分工：记忆记「发生过什么」，剧情线记「还欠着什么」。
 */

/** open = 还开着；resolved = 已经交代完；dormant = 暂时搁下，以后还能捡起来。 */
export type ThreadStatus = "open" | "resolved" | "dormant";

export const THREAD_STATUSES: readonly ThreadStatus[] = ["open", "resolved", "dormant"];

/** 重要度 1 到 5。5 是主线悬念，1 是随口一提。 */
export const MIN_IMPORTANCE = 1;
export const MAX_IMPORTANCE = 5;

export interface StoryThread {
  id: string;
  title: string;
  summary: string;
  status: ThreadStatus;
  /** 1 到 5，默认 3 */
  importance: number;
  /** 最后一次被提到的轮次。用来判断它有多旧 */
  lastActiveAt: number;
  relatedCharacters: string[];
  /** Optional RPG-like objective metadata; ordinary threads remain unchanged. */
  kind?: "thread" | "goal";
  reward?: string;
}

/**
 * 导演给出的剧情线变化。只写变了的那些，没提到的线保持原样。
 *
 * 认线的方式：给了 id 就按 id 认；没给 id 就按标题认（完全一致或互相包含）；
 * 都认不出来就当成新线。这样导演不用记住 id，也能稳定更新同一条线。
 */
export interface ThreadPatchEntry {
  id?: string;
  title: string;
  summary?: string;
  status?: ThreadStatus;
  importance?: number;
  relatedCharacters?: string[];
  kind?: "thread" | "goal";
  reward?: string;
}

export interface ThreadUpdate {
  threads: StoryThread[];
  /** 新建的线 */
  created: StoryThread[];
  /** 更新过的线 */
  updated: StoryThread[];
  /** 这次被标记为已解决的线 */
  resolved: StoryThread[];
  /** 被挡下来的复活：已解决的线不能被重新打开 */
  blocked: StoryThread[];
}

/** 最多记多少条线。超过就丢最旧的已解决项，再丢最旧的低重要度项。 */
export const MAX_THREADS = 40;

export function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}
