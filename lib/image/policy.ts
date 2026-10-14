import { isSimilarScene } from "./brief";

/** 自动生图的硬节流。和评分无关，先过这道再花钱打分。 */
export const AUTO_TURN_GAP = 10;
export const DEFAULT_CG_BUDGET = 3;
export const DEFAULT_CG_THRESHOLD = 7;

export interface AutoCgInput {
  enabled: boolean;
  /** 当前已经进行到第几轮（玩家发言次数） */
  turn: number;
  /** 上一张 CG 是在第几轮，没有就是 null */
  lastCgTurn: number | null;
  /** 本场已经有几张 */
  count: number;
  budget: number;
  sceneKey: string;
  seen: string[];
}

export interface AutoCgDecision {
  ok: boolean;
  reason:
    | "ok"
    | "disabled"
    | "gap"
    | "budget"
    | "similar"
    | "low-score";
}

/** 节流与去重。评分还没出来时用这个。 */
export function allowAutoCg(input: AutoCgInput): AutoCgDecision {
  if (!input.enabled) return { ok: false, reason: "disabled" };
  if (input.count >= input.budget) return { ok: false, reason: "budget" };
  if (input.lastCgTurn !== null && input.turn - input.lastCgTurn < AUTO_TURN_GAP) {
    return { ok: false, reason: "gap" };
  }
  if (input.seen.some((key) => isSimilarScene(key, input.sceneKey))) {
    return { ok: false, reason: "similar" };
  }
  return { ok: true, reason: "ok" };
}

/** 分数过了阈值才值得花钱生图。null 当成没过。 */
export function scoreAllows(score: number | null, threshold: number): boolean {
  if (score === null) return false;
  return score >= threshold;
}
