/**
 * Author's Note（作者注）。
 *
 * 职责只有一个：告诉模型**这一轮怎么写**。
 * 世界设定、人物设定、剧情事实都不属于它——那些在角色卡、世界书、关键事实里，
 * 作者注里再写一遍只会造成两处说法打架。
 *
 * 它放的是：
 * - 当前回合节奏（这一轮慢一点、这一轮要短）
 * - 当前写作重点（只写角色对玩家那句话的直接反应）
 * - 当前格式提醒（act 只留一个可见动作、不要替玩家行动）
 * - 临时风格约束（这一轮别用比喻）
 * - 重新生成时的纠偏信息（上一版替玩家行动了，这一轮注意）
 *
 * 插入位置：**聊天历史之后、最终用户输入之前**。
 * 放在系统提示开头影响力不够——隔了几十轮历史之后早就被冲淡了；
 * 放在最后一条玩家输入之前，它离生成最近，又不会盖过玩家刚说的话。
 *
 * 三层来源，优先级从高到低：
 * 1. 本轮临时注记（重新生成纠偏，或界面上的「只生效一次」）
 * 2. 当前聊天专属（存在会话里）
 * 3. 角色卡默认（跟着卡走）
 */
import type { AuthorNote } from "./types";

/** 默认深度：插在最后一条消息之前，也就是「历史之后、最终用户输入之前」。 */
export const DEFAULT_NOTE_DEPTH = 1;
/** 深度上限。再往前插就开始影响历史本身的连贯性了。 */
export const MAX_NOTE_DEPTH = 6;
/** 作者注的长度上限。它不是第二个系统提示。 */
export const MAX_NOTE_CHARS = 600;

export interface NoteSources {
  /** 本轮临时注记（重新生成纠偏）。优先级最高。 */
  temporary?: string;
  /** 当前聊天专属 */
  session?: AuthorNote;
  /** 角色卡默认 */
  card?: AuthorNote;
}

/**
 * 按优先级挑出这一轮要用的作者注。
 *
 * 临时注记一旦有内容就独占：重新生成时玩家要的是「这一轮纠正什么」，
 * 这时候再叠上常规注记，模型会分不清哪个是当务之急。
 */
export function resolveAuthorNote(sources: NoteSources): AuthorNote | undefined {
  const temporary = cleanNoteText(sources.temporary);
  if (temporary) {
    return {
      text: temporary,
      frequency: 1,
      depth: normalizeDepth(sources.session?.depth ?? sources.card?.depth),
      enabled: true,
    };
  }

  for (const candidate of [sources.session, sources.card]) {
    if (!candidate) continue;
    if (candidate.enabled === false) return undefined; // 显式关掉就不再往下找
    const text = cleanNoteText(candidate.text);
    if (!text) continue;
    return {
      text,
      frequency: normalizeFrequency(candidate.frequency),
      depth: normalizeDepth(candidate.depth),
      enabled: true,
    };
  }

  return undefined;
}

/**
 * 频率判定。0 = 从不，1 = 每轮，N = 每 N 轮。
 * 第 0 轮总是出现，否则开头几轮会没有作者注。
 */
export function selectAuthorNote(
  note: AuthorNote | undefined,
  turn: number,
): AuthorNote | undefined {
  if (!note || note.enabled === false) return undefined;
  if (!cleanNoteText(note.text)) return undefined;
  const frequency = normalizeFrequency(note.frequency);
  if (frequency === 0) return undefined;
  if (frequency === 1) return note;
  return turn % frequency === 0 ? note : undefined;
}

/**
 * 插入下标：历史数组里第几个位置之前插入。
 * depth 1（默认）= 最后一条之前；depth 0 = 最后一条之后。
 */
export function noteInsertIndex(historyLength: number, depth: number | undefined): number {
  const clamped = normalizeDepth(depth);
  return Math.max(0, Math.min(historyLength, historyLength - clamped));
}

/** 重新生成时的纠偏注记。把上一版被判定的问题翻译成「这一轮别这样」。 */
export function correctionNote(reason: string): string {
  const clean = reason.trim().slice(0, 200);
  if (!clean) return "";
  return [
    "重新生成：上一版没有通过校验，被丢弃了。",
    `问题：${clean}`,
    "这一轮重写时避免同样的写法，其余内容照常推进。",
  ].join("\n");
}

function cleanNoteText(text: string | undefined): string {
  return (text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, MAX_NOTE_CHARS);
}

function normalizeFrequency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 1;
  return Math.min(Math.floor(value), 50);
}

function normalizeDepth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_NOTE_DEPTH;
  }
  return Math.min(Math.floor(value), MAX_NOTE_DEPTH);
}
