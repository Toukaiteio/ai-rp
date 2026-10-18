/**
 * 记忆写入规则与冲突处理。
 *
 * 7.2：不是每个模型提到的事实都自动记忆。写进长期记忆至少要满足一条：
 * 玩家明确确认、同一事实多次出现、对后续剧情有明显影响、来自角色卡或世界书、
 * 被工具调用明确写入。
 *
 * 7.3：新旧事实冲突时**保留旧事实**、标记冲突、等玩家确认。
 * 绝不让最新一次模型输出直接覆盖长期记忆——那是长对话里最伤的一种漂移：
 * 玩家会看到「上周说好的事，这周被模型随口改了」。
 *
 * 这个模块只做判断和记账，不碰存储。谁调用它，谁决定要不要落盘。
 */
import type { MemoryLayerId } from "./layers";

/** 一条写入理由。前四条是自动判定，最后一条来自函数调用。 */
export type MemoryReason =
  | "player_confirmed"
  | "repeated"
  | "plot_relevant"
  | "card_source"
  | "tool_call";

export const REASON_LABELS: Record<MemoryReason, string> = {
  player_confirmed: "玩家明确确认",
  repeated: "同一事实多次出现",
  plot_relevant: "对后续剧情有明显影响",
  card_source: "来自角色卡或世界书",
  tool_call: "被工具调用明确写入",
};

/** 一条待写入的记忆。 */
export interface MemoryCandidate {
  layer: MemoryLayerId;
  /** 条目名（人物名、地点名、事件名） */
  key: string;
  /** 一句话内容 */
  detail: string;
  /** 已经确认过的旧内容。有它就说明这条不是新的 */
  current?: string;
  /** 这条内容在本段对话里出现过几次 */
  occurrences?: number;
  /** 玩家这一轮有没有明确确认（「对」「就是这样」「没错」） */
  playerConfirmed?: boolean;
  /**
   * 玩家确认过这条**改动**（不只是确认事实存在）。
   * 只有它能让一条冲突正常落库——7.3 说的是「等玩家确认」，不是「永远不能改」。
   */
  overwriteConfirmed?: boolean;
  /** 来自角色卡或世界书 */
  fromCard?: boolean;
  /** 由函数调用写入 */
  fromTool?: boolean;
  /** 是不是和主线相关：有重要度 4 以上的剧情线，或涉及已知人物 */
  plotRelevant?: boolean;
}

export interface MemoryDecision {
  /** 要不要写 */
  write: boolean;
  /** 命中了哪些理由。空数组说明一条都没满足 */
  reasons: MemoryReason[];
  /** 是不是一次冲突（新旧内容不同） */
  conflict: boolean;
  /** 冲突时给出的说明，给界面和日志看 */
  note: string;
}

/** 同一事实出现几次才算「多次出现」。 */
export const REPEAT_THRESHOLD = 2;

/**
 * 判断一条候选该不该写进长期记忆。
 *
 * 五条理由满足任意一条即可。一条都不满足就不写——宁可少记，
 * 也不要把模型随口一句推断变成以后每一轮都要背着的设定。
 */
export function decideWrite(candidate: MemoryCandidate): MemoryDecision {
  const reasons: MemoryReason[] = [];
  if (candidate.fromTool) reasons.push("tool_call");
  if (candidate.fromCard) reasons.push("card_source");
  if (candidate.playerConfirmed) reasons.push("player_confirmed");
  if (candidate.plotRelevant) reasons.push("plot_relevant");
  if ((candidate.occurrences ?? 0) >= REPEAT_THRESHOLD) reasons.push("repeated");

  const conflict = isConflict(candidate);
  return {
    write: reasons.length > 0,
    reasons,
    conflict,
    note: reasons.length > 0 ? reasons.map((reason) => REASON_LABELS[reason]).join("、") : "没有满足任何写入条件",
  };
}

/** 新旧内容是否冲突。旧内容为空（首次写入）不算冲突。 */
export function isConflict(candidate: MemoryCandidate): boolean {
  const current = candidate.current?.trim();
  const detail = candidate.detail.trim();
  if (!current || !detail) return false;
  return current !== detail;
}

export interface MemoryConflict {
  layer: MemoryLayerId;
  key: string;
  /** 保留的旧内容 */
  kept: string;
  /** 被挡下的新内容 */
  proposed: string;
  turn: number;
  /** 命中的写入理由 */
  reasons: MemoryReason[];
}

export interface MemoryWriteResult {
  /** 真正写进去的条目 */
  written: Array<{ layer: MemoryLayerId; key: string; detail: string; reasons: MemoryReason[] }>;
  /** 被挡下的冲突 */
  conflicts: MemoryConflict[];
  /** 因为没满足写入条件而跳过的 */
  skipped: Array<{ layer: MemoryLayerId; key: string; note: string }>;
}

/**
 * 把一批候选过一遍写入规则。
 *
 * 冲突时**保留旧事实**：`written` 里不会出现这一条，它进 `conflicts` 等人确认。
 * 调用方拿 `written` 去落盘，拿 `conflicts` 去提示玩家。
 */
export function applyWriteRules(
  candidates: readonly MemoryCandidate[],
  turn: number,
): MemoryWriteResult {
  const written: MemoryWriteResult["written"] = [];
  const conflicts: MemoryConflict[] = [];
  const skipped: MemoryWriteResult["skipped"] = [];

  for (const candidate of candidates) {
    const key = candidate.key.trim();
    const detail = candidate.detail.trim();
    if (!key || !detail) continue;

    const decision = decideWrite(candidate);

    if (!decision.write) {
      skipped.push({ layer: candidate.layer, key, note: decision.note });
      continue;
    }

    // 内容没变就是「又提了一次」，不需要写，也不用报冲突
    if (candidate.current?.trim() === detail) {
      skipped.push({ layer: candidate.layer, key, note: "内容没变" });
      continue;
    }

    if (decision.conflict && !candidate.overwriteConfirmed) {
      conflicts.push({
        layer: candidate.layer,
        key,
        kept: candidate.current?.trim() ?? "",
        proposed: detail,
        turn,
        reasons: decision.reasons,
      });
      continue;
    }

    written.push({ layer: candidate.layer, key, detail, reasons: decision.reasons });
  }

  return { written, conflicts, skipped };
}

/**
 * 给模型看的一句提示：它想写的那条被挡住了。
 *
 * 措辞要明确「旧的是对的」，否则模型会换个说法再试一次，
 * 一轮一轮地把同一条记忆反复顶。
 */
export function conflictNotice(conflict: MemoryConflict): string {
  return [
    `「${conflict.key}」已经有记录：${conflict.kept}。`,
    `你这次想写的是：${conflict.proposed}。`,
    "两者不一致，已保留原来的记录，等玩家确认后再改。不要重复尝试覆盖它。",
  ].join("\n");
}

/** 玩家确认之后要写的内容。确认本身就是最强理由，而且允许覆盖旧内容。 */
export function confirmCandidate(
  conflict: MemoryConflict,
  options: { playerSaid?: boolean } = {},
): MemoryCandidate {
  return {
    layer: conflict.layer,
    key: conflict.key,
    detail: conflict.proposed,
    current: conflict.kept,
    playerConfirmed: options.playerSaid ?? true,
    overwriteConfirmed: true,
  };
}
