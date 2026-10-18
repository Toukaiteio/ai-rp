/**
 * 评测指标（Phase 12.3）。
 *
 * 三族指标，全部从**一次跑批的记录**里算出来，不额外调模型：
 *
 * - 结构指标：块协议守没守住（合法块比例、非法 act、错误 who、工具标签泄漏）
 * - 叙事指标：讲得对不对（替玩家行动、人设违背、复读、无依据新设定、过度推进）
 * - 连贯性指标：跨轮次记不记得住（场景位置、时间线、角色状态、未解决剧情线）
 *
 * 设计约束：
 * 1. 纯函数。同样的记录永远算出同样的数，可以离线复现；
 * 2. 每项都返回「分子/分母」，不只给一个百分比——分母是 0 还是 100
 *    对判断问题完全不同，只给比率会把这件事藏起来；
 * 3. 连贯性指标看的是**状态变化有没有依据**，不是「有没有变」。
 *    场景本来就该变，问题是变得有没有道理。
 */
import type { GenerationReport } from "@/lib/engine/types";
import type { SceneState, StateChange } from "@/lib/scene";
import type { StoryThread } from "@/lib/story";

/** 一项指标：分子分母 + 算出来的比率。 */
export interface Metric {
  /** 分子 */
  hits: number;
  /** 分母。0 表示这一轮没有可判定的对象 */
  total: number;
  /** hits / total。分母为 0 时是 null——「无从判定」和「0%」是两回事 */
  ratio: number | null;
  /** 一句话说明这项在看什么 */
  detail: string;
}

function metric(hits: number, total: number, detail: string): Metric {
  return { hits, total, ratio: total > 0 ? Math.round((hits / total) * 1000) / 1000 : null, detail };
}

/** 一轮的完整记录。跑批脚本产出它，指标从这里算。 */
export interface EvalTurn {
  caseId: string;
  /**
   * 这一轮属于哪一次连续会话。
   *
   * 连贯性指标只能比**同一次会话内**相邻的两轮：跨会话比等于拿 A 故事的
   * 场景去要求 B 故事，一定「丢」。第一版没这个字段，按数组顺序比，
   * 结果每条序列的最后一轮和下一序列的第一轮被算成一次丢失——
   * 真机跑批里 threadRetention 因此从 100% 掉到 71%，全是假的。
   */
  run: string;
  /** 第几轮（从 1 开始） */
  turn: number;
  report: GenerationReport;
  /** 这一轮结束后的场景状态 */
  scene?: SceneState;
  /** 这一轮的状态变化 */
  sceneChanges?: StateChange[];
  /** 这一轮结束后的剧情线 */
  threads?: StoryThread[];
  /** 这一轮的正文里有没有明确交代场景切换 */
  sceneShifted?: boolean;
  /** 这一轮正文里的时间词，用来判时间线有没有倒退 */
  timeMarker?: string;
}

export interface MetricFamily {
  structure: Record<string, Metric>;
  narrative: Record<string, Metric>;
  coherence: Record<string, Metric>;
}

/**
 * 结构指标：块协议守没守住。
 *
 * 分母都是「块」或「轮」，不是「字符」——字符数会被长短影响，
 * 块数是离散的，涨跌都说明真问题。
 */
export function structureMetrics(turns: readonly EvalTurn[]): Record<string, Metric> {
  let blocks = 0;
  let validBlocks = 0;
  let acts = 0;
  let invalidActs = 0;
  let whoTargets = 0;
  let whoIssues = 0;
  let toolLeakRounds = 0;

  for (const turn of turns) {
    const report = turn.report;
    blocks += report.blockCount;
    acts += report.actCount;
    invalidActs += report.invalidActCount;
    // 降级过的块 = 不合法的块（soft 档就是「本来不合法、被就地改好了」）
    const degraded = report.degradations.length;
    validBlocks += Math.max(0, report.blockCount - degraded);

    // who 的目标是 act 和 dlg 两类块
    const whoTarget = report.actCount + report.dialogueCount;
    whoTargets += whoTarget;
    whoIssues += report.issues.filter(
      (issue) => issue.code === "who_pronoun" || issue.code === "who_inexact",
    ).length;

    if (report.issues.some((issue) => issue.code === "pseudo_tool_text")) toolLeakRounds += 1;
  }

  return {
    validBlockRatio: metric(
      validBlocks,
      blocks,
      "合法消息块比例：没有被降级或丢弃的块占多少",
    ),
    invalidActRatio: metric(invalidActs, acts, "非法 act 比例：act 里出现多动作、对白、心理或结果的占多少"),
    badWhoRatio: metric(whoIssues, whoTargets, "错误 who 比例：who 写成代词或角色名不准确的占多少"),
    toolTagLeakRatio: metric(
      toolLeakRounds,
      turns.length,
      "工具标签泄漏比例：把函数调用写成标签或 JSON 的轮次占多少",
    ),
  };
}

/**
 * 叙事指标：讲得对不对。
 *
 * 这几项都是「一轮里犯一次就算」，不按次数累加——
 * 同一轮里替玩家行动三次和一次，对读者的伤害是一样的。
 */
export function narrativeMetrics(turns: readonly EvalTurn[]): Record<string, Metric> {
  const has = (turn: EvalTurn, code: string) =>
    turn.report.issues.some((issue) => issue.code === code);

  return {
    playerControlRatio: metric(
      turns.filter((turn) => has(turn, "player_control")).length,
      turns.length,
      "替玩家行动比例：代写玩家的话、决定或心情的轮次占多少",
    ),
    characterDriftRatio: metric(
      turns.filter((turn) => has(turn, "character_drift")).length,
      turns.length,
      "角色设定违背比例：行为脱离卡上设定的轮次占多少",
    ),
    repeatedRatio: metric(
      turns.filter((turn) => turn.report.repeatedPhraseCount > 0).length,
      turns.length,
      "重复句比例：和上一轮表达撞车的轮次占多少",
    ),
    /**
     * 「无依据新设定」用两个信号合起来判：
     * 一次性推进太多剧情，或者角色名写得不准（说明它在现编）。
     * 单独一个都不够——推进快不等于编设定，who 写错也不等于编设定。
     */
    unsupportedSettingRatio: metric(
      turns.filter((turn) => has(turn, "plot_overreach") || has(turn, "who_inexact")).length,
      turns.length,
      "无依据新设定比例：一次性推进太多剧情或现编角色名的轮次占多少",
    ),
    plotOverreachRatio: metric(
      turns.filter((turn) => has(turn, "plot_overreach")).length,
      turns.length,
      "过度推进剧情比例：一轮里把悬念或冲突一次解决掉的轮次占多少",
    ),
  };
}

/**
 * 连贯性指标：跨轮次记不记得住。
 *
 * 四项都是「该保持的有没有保持住」。关键是**看变化有没有依据**：
 * 场景本来就该变，玩家说了「我们换地方」就该变；
 * 没有依据地换地方才是问题。
 */
export function coherenceMetrics(turns: readonly EvalTurn[]): Record<string, Metric> {
  let locationKept = 0;
  let locationTotal = 0;
  let timeKept = 0;
  let timeTotal = 0;
  let castKept = 0;
  let castTotal = 0;
  let threadsKept = 0;
  let threadsTotal = 0;

  for (let i = 1; i < turns.length; i += 1) {
    const prev = turns[i - 1];
    const now = turns[i];

    /*
     * 只比同一次会话内相邻的两轮。
     *
     * 跨会话比等于拿 A 故事的场景去要求 B 故事——每条序列的最后一轮和
     * 下一序列的第一轮会被算成一次「场景丢了」和一次「剧情线丢了」。
     * 真机跑批里这一条让 threadRetention 从 100% 掉到 71%，全是假的。
     */
    if (prev.run !== now.run) continue;

    /*
     * 三块判定各自独立，不能因为缺场景就整轮跳过。
     *
     * 场景和剧情线是两套数据：某一轮没有场景状态（旧存档、或者没接导演），
     * 不代表它的剧情线也不能判。第一版把场景检查放在最前面 early-continue，
     * 结果没有场景的轮次连剧情线保留率都算不出来——测试里抓到的。
     */
    if (prev.scene && now.scene) {
      // 地点：没变算保持；变了的话，正文里得有个 scene 块交代过
      locationTotal += 1;
      const locationChanged = prev.scene.location !== now.scene.location;
      if (!locationChanged || now.sceneShifted) locationKept += 1;

      // 时间：没变算保持；变了不算倒退就行
      timeTotal += 1;
      if (prev.scene.time === now.scene.time || !timeWentBackwards(prev.scene.time, now.scene.time)) {
        timeKept += 1;
      }

      /*
       * 在场的人：允许减少（有人走了很正常），但不允许**凭空多出没提过的人**。
       * 从无到有必须有正文依据，否则就是把没出场的人塞进了场景。
       */
      castTotal += 1;
      const added = now.scene.presentCharacters.filter(
        (name) => !prev.scene!.presentCharacters.includes(name),
      );
      if (added.length === 0 || now.sceneShifted) castKept += 1;
    }

    const prevOpen = (prev.threads ?? []).filter((thread) => thread.status === "open");
    if (prevOpen.length === 0) continue;
    const nowAll = now.threads ?? [];
    // 只要这条线还在表里（不管现在是 open 还是 dormant 还是 resolved），就不算丢。
    // 只有整个条目消失才算——那才是「上一轮开着的线这一轮无声无息地没了」。
    const lost = prevOpen.filter((thread) => !nowAll.some((item) => item.id === thread.id));
    threadsTotal += prevOpen.length;
    threadsKept += prevOpen.length - lost.length;
  }

  return {
    sceneLocationKept: metric(
      locationKept,
      locationTotal,
      "场景位置保持率：地点没变，或者变了但正文里有 scene 块交代过",
    ),
    timelineConsistent: metric(
      timeKept,
      timeTotal,
      "时间线一致率：时间没倒退（没变或往前推都算一致）",
    ),
    characterStateKept: metric(
      castKept,
      castTotal,
      "角色状态保持率：没有凭空往场景里塞没提过的人",
    ),
    threadRetention: metric(
      threadsKept,
      threadsTotal,
      "未解决剧情线保留率：上一轮开着的线这一轮没有无声消失",
    ),
  };
}

/** 常见的中文时间词，从早到晚。用来判时间有没有倒退。 */
const TIME_ORDER = [
  "凌晨",
  "清晨",
  "早上",
  "上午",
  "中午",
  "午休",
  "下午",
  "傍晚",
  "黄昏",
  "晚上",
  "夜里",
  "深夜",
  "半夜",
];

/**
 * 时间是不是倒退了。
 *
 * 只在两边都能认出顺序时判定——认不出来就返回 false（不算倒退）。
 * 宁可漏判也不要误判：时间词写法千变万化，硬判会制造假警报。
 */
export function timeWentBackwards(prev: string, now: string): boolean {
  const a = TIME_ORDER.findIndex((word) => prev.includes(word));
  const b = TIME_ORDER.findIndex((word) => now.includes(word));
  if (a < 0 || b < 0) return false;
  return b < a;
}

export function allMetrics(turns: readonly EvalTurn[]): MetricFamily {
  return {
    structure: structureMetrics(turns),
    narrative: narrativeMetrics(turns),
    coherence: coherenceMetrics(turns),
  };
}

/** 把所有指标压成一段纯文本，跑批结束打出来。 */
export function formatMetrics(family: MetricFamily): string {
  const lines: string[] = [];
  const groups: Array<[string, Record<string, Metric>]> = [
    ["结构", family.structure],
    ["叙事", family.narrative],
    ["连贯性", family.coherence],
  ];
  for (const [title, metrics] of groups) {
    lines.push(`—— ${title} ——`);
    for (const [key, item] of Object.entries(metrics)) {
      const percent = item.ratio === null ? "无从判定" : `${Math.round(item.ratio * 1000) / 10}%`;
      lines.push(`  ${key} ${percent}（${item.hits}/${item.total}）· ${item.detail}`);
    }
  }
  return lines.join("\n");
}

/**
 * 和上一轮的基线比，判断有没有变差。
 *
 * 只比「越大越好」的指标里下降的，以及「越小越好」的指标里上升的。
 * 结构指标里的 validBlockRatio 越大越好，其余全是越小越好；
 * 连贯性四项全是越大越好。
 */
export type MetricDirection = "higher-better" | "lower-better";

export const METRIC_DIRECTIONS: Record<string, MetricDirection> = {
  validBlockRatio: "higher-better",
  invalidActRatio: "lower-better",
  badWhoRatio: "lower-better",
  toolTagLeakRatio: "lower-better",
  playerControlRatio: "lower-better",
  characterDriftRatio: "lower-better",
  repeatedRatio: "lower-better",
  unsupportedSettingRatio: "lower-better",
  plotOverreachRatio: "lower-better",
  sceneLocationKept: "higher-better",
  timelineConsistent: "higher-better",
  characterStateKept: "higher-better",
  threadRetention: "higher-better",
};

/** 超过这个幅度才算退化。跑批有噪声，小波动不该报警。 */
export const REGRESSION_TOLERANCE = 0.05;

export interface Regression {
  key: string;
  before: number;
  after: number;
  direction: MetricDirection;
  delta: number;
}

/**
 * 和基线比，找出退化的指标。
 *
 * 分母为 0（无从判定）的项跳过——拿一个「没测到」去报警只会让人不再信任报告。
 */
export function findRegressions(
  baseline: MetricFamily,
  current: MetricFamily,
  tolerance = REGRESSION_TOLERANCE,
): Regression[] {
  const found: Regression[] = [];
  for (const family of ["structure", "narrative", "coherence"] as const) {
    for (const [key, now] of Object.entries(current[family])) {
      const before = baseline[family][key];
      if (!before || before.ratio === null || now.ratio === null) continue;
      const direction = METRIC_DIRECTIONS[key] ?? "lower-better";
      const delta = now.ratio - before.ratio;
      const worse =
        direction === "higher-better" ? delta < -tolerance : delta > tolerance;
      if (worse) {
        found.push({ key, before: before.ratio, after: now.ratio, direction, delta });
      }
    }
  }
  return found.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
