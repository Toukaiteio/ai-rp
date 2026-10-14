import type { ChatMessage } from "./types";

/**
 * 中日韩字符与全角标点。
 * 只为预算裁剪服务，不追求与真实分词器一致：
 * 中文约 1 字 0.75 token，其余按 4 字符 1 token 粗估。
 */
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

/** 每条消息的角色标记与分隔符开销。 */
export const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK) ?? []).length;
  return Math.ceil(cjk * 0.75 + (text.length - cjk) / 4);
}

export function estimateMessages(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD,
    0,
  );
}

export interface TrimResult {
  kept: ChatMessage[];
  dropped: number;
  tokens: number;
}

/**
 * 保留开头与结尾，从中间开始丢。
 *
 * 开头是开场白（角色第一印象），结尾是最近几轮（当前语境），
 * 中间被丢掉的部分由滚动摘要兜住，所以丢了也不算真的丢。
 * headCount / tailCount 是硬保留条数，超了也不再让。
 */
export function trimHistory(
  history: ChatMessage[],
  budget: number,
  headCount = 1,
  tailCount = 2,
): TrimResult {
  if (history.length === 0) return { kept: [], dropped: 0, tokens: 0 };
  if (budget <= 0) return { kept: [], dropped: history.length, tokens: 0 };

  const total = estimateMessages(history);
  if (total <= budget) return { kept: history, dropped: 0, tokens: total };

  const head = Math.min(headCount, history.length);
  const tailStart = Math.max(head, history.length - tailCount);
  const headPart = history.slice(0, head);
  const tailPart = history.slice(tailStart);

  let tokens = estimateMessages(headPart) + estimateMessages(tailPart);
  // 连头尾都装不下时，只留最近的部分，宁可丢开场也不要超预算
  if (tokens > budget) {
    const onlyTail: ChatMessage[] = [];
    let used = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const cost = estimateTokens(history[i].content) + PER_MESSAGE_OVERHEAD;
      if (used + cost > budget) break;
      onlyTail.unshift(history[i]);
      used += cost;
    }
    return {
      kept: onlyTail,
      dropped: history.length - onlyTail.length,
      tokens: used,
    };
  }

  // 从「最新优先」往里填中段：越近的中段越值钱
  const middle: ChatMessage[] = [];
  for (let i = tailStart - 1; i >= head; i--) {
    const cost = estimateTokens(history[i].content) + PER_MESSAGE_OVERHEAD;
    if (tokens + cost > budget) break;
    middle.unshift(history[i]);
    tokens += cost;
  }

  const kept = [...headPart, ...middle, ...tailPart];
  return { kept, dropped: history.length - kept.length, tokens };
}
