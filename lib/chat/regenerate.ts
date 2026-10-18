/**
 * 重新生成（Phase 11.1）。
 *
 * 三条硬规则：
 * 1. **删掉上一条错误回复**——它不能留在历史里；
 * 2. **不把错误回复放进新请求**——这一条最容易漏：只要它还在 messages 里，
 *    模型就会顺着它写，纠偏指令再强也没用；
 * 3. **保留同一个玩家输入**——重新生成的是回复，不是那一轮玩家说的话。
 *
 * 再加一条软规则：允许带一句临时纠偏。上一版为什么被弃用，
 * 是重新生成时最有用的信息。
 *
 * 这个模块只算「重跑要用什么」，不碰 React 状态，所以能离线测。
 */

/** 一条历史消息里，重新生成需要看的那几个字段。 */
export interface RetryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RegeneratePlan {
  /** 要发给模型的历史：**不含**被弃用的那一版回复 */
  history: RetryMessage[];
  /** 重跑用的玩家输入 */
  playerInput: string;
  /** 被弃用回复的 id，界面要拿它去找回旧版本 */
  discardedId?: string;
  /** 被弃用回复的正文。旧版本列表要用 */
  discarded?: string;
  /** 无法重跑时的原因 */
  blocked?: "no_reply" | "no_user_input";
}

/**
 * 算出「重新生成最后一条回复」要用什么。
 *
 * 从末尾往前找最后一条 assistant，把它连同它之后的内容一起丢掉，
 * 再用它前面最近的一条 user 当输入。
 *
 * 为什么不是简单 `slice(0, -1)`：一条回复后面可能还跟着别的消息
 * （比如玩家已经又发了一句），那种情况下重跑的不是最后一条。
 */
export function planRegenerate(turns: readonly RetryMessage[]): RegeneratePlan {
  const lastReplyIndex = findLastIndex(turns, (turn) => turn.role === "assistant");
  if (lastReplyIndex < 0) {
    return { history: [], playerInput: "", blocked: "no_reply" };
  }

  const userIndex = findLastIndex(
    turns.slice(0, lastReplyIndex),
    (turn) => turn.role === "user",
  );
  if (userIndex < 0) {
    return { history: [], playerInput: "", blocked: "no_user_input" };
  }

  const discarded = turns[lastReplyIndex];
  return {
    // 截到玩家那一句为止：错误回复以及它之后的东西一律不进新请求
    history: turns.slice(0, userIndex),
    playerInput: turns[userIndex].content,
    discardedId: discarded.id,
    discarded: discarded.content,
  };
}

/**
 * 重新生成时的临时纠偏。
 *
 * 措辞要具体到「别复用哪些东西」，泛泛的「重写一遍」等于没说。
 * 这一句只影响这一轮，不落盘、不进历史。
 */
export function regenerateNote(previous?: string): string {
  const lines = [
    "上一版回复未采用，请重写这一轮。",
    "不要复用上一版的动作表达和句式，换一个角度写。",
    "保持单一动作和短对白，不要一次推进太多。",
  ];
  // 带上上一版的开头一小段：让模型知道「别重复的是什么」，
  // 但只给片段，不给全文——给全文它就顺着抄了
  if (previous?.trim()) {
    lines.push(`上一版是这样开头的：「${preview(previous)}」，不要再这样写。`);
  }
  return lines.join("\n");
}

/** 旧回复开头的短预览。够模型认出「别重复」，又不至于被照抄。 */
export const PREVIEW_CHARS = 24;

export function preview(text: string, limit = PREVIEW_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/**
 * 往旧版本列表里追加一条，并返回新的列表和当前下标。
 *
 * 重复的正文不再追加——同一个版本被重跑两次（比如第一次失败又重试）
 * 不该在切换器里出现两遍。
 */
export function pushSwipe(
  swipes: readonly string[] | undefined,
  content: string,
): { swipes: string[]; index: number } {
  const list = swipes ? [...swipes] : [];
  const body = content.trim();
  const existing = list.findIndex((item) => item.trim() === body);
  if (existing >= 0) return { swipes: list, index: existing };
  list.push(content);
  return { swipes: list, index: list.length - 1 };
}

/** 重新生成失败时把旧版本放回去。 */
export function restoreSwipe(
  swipes: readonly string[] | undefined,
  previous: string | undefined,
): { swipes: string[] | undefined; index: number } {
  if (!previous) return { swipes: swipes ? [...swipes] : undefined, index: 0 };
  const list = swipes ? [...swipes] : [];
  if (!list.some((item) => item.trim() === previous.trim())) list.push(previous);
  return { swipes: list, index: list.length - 1 };
}

function findLastIndex<T>(list: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return i;
  }
  return -1;
}
