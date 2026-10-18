/**
 * 编辑历史消息（Phase 11.2）。
 *
 * 玩家改了一条旧消息之后，**后面的状态全都可能是过时的**：
 * 场景状态、剧情线、摘要都是从那之后的正文里推出来的，
 * 而那段正文已经不作数了。
 *
 * 这个模块做两件事：
 * 1. 标出「哪些东西过时了」，让界面能提示、让调用方能决定怎么办；
 * 2. 给出一个**安全的默认动作**——不猜、不自动重算，先标记。
 *
 * 为什么不自动重算：重算要么再叫一次模型（花钱、还会漂），要么本地推
 * （推不出来，因为状态是从正文里读的）。两样都比「留着旧值但明确标注」
 * 更容易把事情搞坏。
 */

/** 被编辑的那条消息在历史里的位置。 */
export interface EditedMessage {
  /** 在历史数组里的下标 */
  index: number;
  /** 是玩家说的还是角色说的 */
  role: "user" | "assistant" | "system";
}

export type StaleKind = "scene" | "threads" | "summary" | "facts";

export const STALE_LABELS: Record<StaleKind, string> = {
  scene: "场景状态",
  threads: "剧情线",
  summary: "滚动摘要",
  facts: "关键事实",
};

export interface StaleReport {
  /** 哪些东西过时了 */
  stale: StaleKind[];
  /** 被编辑消息的下标 */
  index: number;
  /**
   * 过时之后建议做什么。三种：
   * `none` 什么都不用做（改的是最新一条，或者没接状态）；
   * `mark` 标记过时，继续用（默认，最安全）；
   * `resummarize` 建议重新生成摘要（改的是很早的消息，后面的总结已经不可信）。
   */
  action: "none" | "mark" | "resummarize";
  /** 给玩家看的一句话 */
  note: string;
}

/**
 * 编辑一条消息之后，判断有哪些状态过时了。
 *
 * `throughIndex` 是这些状态有效到第几条消息为止——也就是最后一次成功落地的
 * 历史长度。四种状态都是从已落地的正文里推出来的，所以它们共用同一个界。
 *
 * 为什么不给每种状态各记一个界：那需要每轮分别记「场景更新到第几条」
 * 「摘要覆盖到第几条」，而现在的实现里它们本来就是同一批正文推出来的。
 * 分开记只会造出一个看起来更精确、实际对不上的数字。
 *
 * 编辑的位置越靠前，受影响越多：改最新一条几乎没影响；
 * 改很早的一条会把后面所有从正文里推出来的东西都废掉。
 */
export function reportStale(
  edited: EditedMessage,
  throughIndex: number,
  totalTurns: number,
): StaleReport {
  /*
   * 判断标准是「状态是在被编辑那条之后推出来的」。
   * 等于的情况不算：状态是在那一轮结束时算的，编辑的是那一轮的输入，
   * 严格说过时了，但影响很小，标成过时会让每次编辑都弹提示。
   */
  if (throughIndex <= edited.index) {
    return {
      stale: [],
      index: edited.index,
      action: "none",
      note: "这条消息之后还没有推出过状态，可以直接继续。",
    };
  }

  const stale: StaleKind[] = ["scene", "threads", "summary", "facts"];
  // 改的是很早的消息：后面的摘要已经不可信，建议重算
  const early = totalTurns - edited.index >= RESUMMARIZE_DISTANCE;
  const names = stale.map((kind) => STALE_LABELS[kind]).join("、");

  return {
    stale,
    index: edited.index,
    action: early ? "resummarize" : "mark",
    note: early
      ? `改了较早的一条消息，${names}可能已经对不上，建议重新生成摘要。`
      : `${names}可能已经过时，后面的内容按新的写法继续。`,
  };
}

/** 距离末尾超过这么多轮，就建议重算摘要而不是只标记。 */
export const RESUMMARIZE_DISTANCE = 6;

/**
 * 编辑一条消息，返回新的历史。
 *
 * 只改那一条的正文，别的字段（图片、文档）原样保留——
 * 编辑文字不该顺手把附件弄丢。
 */
export function applyEdit<T extends { id: string; content: string }>(
  turns: readonly T[],
  id: string,
  content: string,
): { turns: T[]; edited?: T; index: number } {
  const index = turns.findIndex((turn) => turn.id === id);
  if (index < 0) return { turns: [...turns], index: -1 };
  const next = [...turns];
  next[index] = { ...next[index], content };
  return { turns: next, edited: next[index], index };
}
