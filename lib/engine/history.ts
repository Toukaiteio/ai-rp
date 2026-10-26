/**
 * 「这一轮要不要写进历史」的唯一决定点。
 *
 * ChatScreen 只负责画界面和攒流式文本；能不能进历史由这里说了算，
 * 所以这条规则是纯函数、可以单独测。
 */

/** 历史里的一条消息。泛型只要求有 role 和 content，别的字段（图片、CG）原样保留。 */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PendingTurn<T> {
  user: T;
  assistant: T;
}

/**
 * 提交进历史的一轮。质量门已从生成路径摘除（酒馆式直出），
 * 生成侧只会传 accepted；rejected 分支保留给仍然想用引擎校验的调用方。
 */
export type CommitCandidate =
  | { status: "accepted" | "repaired"; content: string }
  | { status: "rejected"; reason: string };

export interface CommitOutcome<T> {
  /** 这一轮之后的历史 */
  turns: T[];
  /** 有没有写进去。false 表示调用方必须把界面也恢复到这一轮之前。 */
  written: boolean;
  /** 实际写进去的正文。拒收时是空串。 */
  content: string;
}

/**
 * 把一轮候选内容提交进历史。
 *
 * 拒收时返回**原样的 base**，一个字段都不改：调用方不可能「顺手」把
 * 候选内容接在后面，因为返回的数组里根本没有它。
 */
export function commitTurn<T extends HistoryTurn>(
  base: readonly T[],
  pending: PendingTurn<T>,
  result: CommitCandidate,
): CommitOutcome<T> {
  if (result.status === "rejected") {
    return { turns: [...base], written: false, content: "" };
  }

  const assistant: T = { ...pending.assistant, content: result.content };
  return {
    turns: [...base, pending.user, assistant],
    written: true,
    content: result.content,
  };
}

/**
 * 重跑时该用哪段历史当起点。
 *
 * 被拒收的那一轮必须从 base 重来，而不是从当前画面重来——
 * 当前画面上那半条回复是错误内容，接上去就等于把污染写进提示词。
 */
export function retryBase<T extends HistoryTurn>(rejected: { baseTurns: readonly T[] }): T[] {
  return [...rejected.baseTurns];
}
