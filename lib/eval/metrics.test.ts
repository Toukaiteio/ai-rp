import { describe, expect, it } from "vitest";
import { EVAL_SEQUENCES } from "./sequences";
import {
  CATEGORY_LABELS,
  EVAL_CASES,
  EVAL_CATEGORIES,
  casesByCategory,
  type MetricKey,
} from "./cases";
import {
  METRIC_DIRECTIONS,
  allMetrics,
  coherenceMetrics,
  findRegressions,
  formatMetrics,
  narrativeMetrics,
  structureMetrics,
  timeWentBackwards,
  type EvalTurn,
} from "./metrics";
import type { GenerationReport } from "@/lib/engine/types";
import { emptySceneState, type SceneState } from "@/lib/scene";
import type { StoryThread } from "@/lib/story";

/** 造一份最小的报告，只填指标用得上的字段。 */
function report(over: Partial<GenerationReport> = {}): GenerationReport {
  return {
    responseLength: 120,
    blockCount: 4,
    actCount: 1,
    invalidActCount: 0,
    dialogueCount: 2,
    playerControlViolation: false,
    repeatedPhraseCount: 0,
    repairAttempted: false,
    repairSucceeded: false,
    turn: 1,
    language: "zh",
    sceneCount: 0,
    issues: [],
    checks: [],
    verdict: "pass",
    severity: "none",
    decision: "accepted",
    degradations: [],
    promptVersion: "test",
    replyHash: "hash",
    generatedAt: 0,
    qualityGateEnabled: true,
    ...over,
  };
}

function turn(over: Partial<EvalTurn> = {}): EvalTurn {
  return { caseId: "c1", run: "c1", turn: 1, report: report(), ...over };
}

function scene(over: Partial<SceneState> = {}): SceneState {
  return { ...emptySceneState(0), ...over };
}

function thread(over: Partial<StoryThread> & { id: string }): StoryThread {
  return {
    title: "线",
    summary: "",
    status: "open",
    importance: 3,
    lastActiveAt: 1,
    relatedCharacters: [],
    ...over,
  };
}

describe("评测集：结构自检（12.1）", () => {
  it("正好 50 组", () => {
    expect(EVAL_CASES).toHaveLength(50);
  });

  it("覆盖 12.1 的全部输入类型，每类至少 3 组", () => {
    const groups = casesByCategory();
    for (const category of EVAL_CATEGORIES) {
      expect(groups[category].length, `${category} 至少要有 3 组`).toBeGreaterThanOrEqual(3);
    }
    // 15 类 = 14 个输入类型 + 重新生成（它是动作，需要自己的用例）
    expect(EVAL_CATEGORIES).toHaveLength(15);
  });

  it("id 唯一", () => {
    const ids = EVAL_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个类别都有中文标签", () => {
    for (const category of EVAL_CATEGORIES) {
      expect(CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(EVAL_CATEGORIES.length);
  });

  it("每组都写了期望行为和要盯的指标", () => {
    for (const item of EVAL_CASES) {
      expect(item.expect.length, `${item.id} 缺 expect`).toBeGreaterThan(8);
      expect(item.checks.length, `${item.id} 缺 checks`).toBeGreaterThan(0);
      expect(item.card.name.length, `${item.id} 缺角色卡`).toBeGreaterThan(0);
    }
  });

  it("checks 里的指标名都是真实存在的", () => {
    const known = new Set(Object.keys(METRIC_DIRECTIONS) as MetricKey[]);
    for (const item of EVAL_CASES) {
      for (const key of item.checks) {
        expect(known.has(key), `${item.id} 里的 ${key} 不是有效指标`).toBe(true);
      }
    }
  });

  it("每一类都至少被一组 checks 盯到", () => {
    const covered = new Set(EVAL_CASES.flatMap((item) => item.checks));
    // 结构 + 叙事 + 连贯性三族的核心项都要有组盯
    for (const key of [
      "validBlockRatio",
      "invalidActRatio",
      "badWhoRatio",
      "toolTagLeakRatio",
      "playerControlRatio",
      "characterDriftRatio",
      "repeatedRatio",
      "unsupportedSettingRatio",
      "plotOverreachRatio",
      "sceneLocationKept",
      "timelineConsistent",
      "characterStateKept",
    ] as MetricKey[]) {
      expect(covered.has(key), `没有一组盯 ${key}`).toBe(true);
    }
  });

  it("重新生成那几组带上了被弃用的版本和纠偏说明", () => {
    const regen = EVAL_CASES.filter((item) => item.category === "regenerate");
    for (const item of regen) {
      expect(item.regenerate?.discard.length).toBeGreaterThan(0);
      expect(item.regenerate?.note.length).toBeGreaterThan(0);
    }
  });

  it("附件那几组标了附件类型", () => {
    const attachments = EVAL_CASES.filter((item) => item.category === "attachment");
    for (const item of attachments) {
      expect(item.attachment?.kind).toMatch(/^(image|document)$/);
    }
  });
});

describe("连贯性序列（12.3）", () => {
  it("每条序列至少 4 轮，否则算不出连贯性", () => {
    expect(EVAL_SEQUENCES.length).toBeGreaterThanOrEqual(4);
    for (const sequence of EVAL_SEQUENCES) {
      expect(sequence.playerInputs.length, `${sequence.id} 轮数不够`).toBeGreaterThanOrEqual(4);
    }
  });

  it("每条序列都写了在测什么", () => {
    for (const sequence of EVAL_SEQUENCES) {
      expect(sequence.expect.length, `${sequence.id} 缺 expect`).toBeGreaterThan(8);
      expect(sequence.card.name.length).toBeGreaterThan(0);
    }
  });

  it("id 不重复，和单轮用例也不撞", () => {
    const seqIds = EVAL_SEQUENCES.map((item) => item.id);
    expect(new Set(seqIds).size).toBe(seqIds.length);
    const caseIds = new Set(EVAL_CASES.map((item) => item.id));
    for (const id of seqIds) expect(caseIds.has(id)).toBe(false);
  });

  it("序列能真的产出连贯性判定：造两轮状态比一比", () => {
    const turns: EvalTurn[] = [
      turn({ scene: scene({ location: "酒堂", time: "深夜" }) }),
      turn({ caseId: "s#2", turn: 2, scene: scene({ location: "酒堂", time: "深夜" }) }),
    ];
    const metrics = coherenceMetrics(turns);
    expect(metrics.sceneLocationKept.ratio).not.toBeNull();
    expect(metrics.timelineConsistent.ratio).not.toBeNull();
  });
});

describe("结构指标（12.3）", () => {
  it("合法块比例：降级过的块不算合法", () => {
    const metrics = structureMetrics([
      turn({
        report: report({
          blockCount: 4,
          degradations: [{ index: 1, from: "act", to: "narr", code: "act_overlong", detail: "太长" }],
        }),
      }),
    ]);
    expect(metrics.validBlockRatio.hits).toBe(3);
    expect(metrics.validBlockRatio.total).toBe(4);
    expect(metrics.validBlockRatio.ratio).toBe(0.75);
  });

  it("非法 act 比例：按 act 总数算", () => {
    const metrics = structureMetrics([
      turn({ report: report({ actCount: 4, invalidActCount: 1 }) }),
    ]);
    expect(metrics.invalidActRatio.ratio).toBe(0.25);
  });

  it("错误 who 比例：只看 act 和 dlg", () => {
    const metrics = structureMetrics([
      turn({
        report: report({
          actCount: 1,
          dialogueCount: 1,
          issues: [{ code: "who_pronoun", severity: "block", detail: "who 用了代词" }],
        }),
      }),
    ]);
    expect(metrics.badWhoRatio.hits).toBe(1);
    expect(metrics.badWhoRatio.total).toBe(2);
  });

  it("工具标签泄漏：一轮里犯一次就算一次", () => {
    const metrics = structureMetrics([
      turn({
        report: report({
          issues: [
            { code: "pseudo_tool_text", severity: "block", detail: "写成标签" },
            { code: "pseudo_tool_text", severity: "block", detail: "又一处" },
          ],
        }),
      }),
      turn({ caseId: "c2", report: report() }),
    ]);
    expect(metrics.toolTagLeakRatio.hits).toBe(1);
    expect(metrics.toolTagLeakRatio.total).toBe(2);
    expect(metrics.toolTagLeakRatio.ratio).toBe(0.5);
  });

  it("没有块时比例是 null，不是 0", () => {
    const metrics = structureMetrics([turn({ report: report({ blockCount: 0, actCount: 0 }) })]);
    expect(metrics.validBlockRatio.ratio).toBeNull();
    expect(metrics.invalidActRatio.ratio).toBeNull();
  });

  it("一轮记录都没有时不崩", () => {
    const metrics = structureMetrics([]);
    expect(metrics.validBlockRatio.total).toBe(0);
    expect(metrics.validBlockRatio.ratio).toBeNull();
  });
});

describe("叙事指标（12.3）", () => {
  it("替玩家行动：按轮次算，同一轮犯三次也只算一次", () => {
    const metrics = narrativeMetrics([
      turn({
        report: report({
          issues: [
            { code: "player_control", severity: "block", detail: "a" },
            { code: "player_control", severity: "block", detail: "b" },
          ],
        }),
      }),
      turn({ caseId: "c2", report: report() }),
    ]);
    expect(metrics.playerControlRatio.hits).toBe(1);
    expect(metrics.playerControlRatio.ratio).toBe(0.5);
  });

  it("无依据新设定：过度推进或现编角色名都算", () => {
    const metrics = narrativeMetrics([
      turn({ report: report({ issues: [{ code: "plot_overreach", severity: "warn", detail: "太快" }] }) }),
      turn({
        caseId: "c2",
        report: report({ issues: [{ code: "who_inexact", severity: "block", detail: "名字不对" }] }),
      }),
      turn({ caseId: "c3", report: report() }),
    ]);
    expect(metrics.unsupportedSettingRatio.hits).toBe(2);
    expect(metrics.unsupportedSettingRatio.ratio).toBe(0.667);
  });

  it("重复句：看报告里的计数", () => {
    const metrics = narrativeMetrics([
      turn({ report: report({ repeatedPhraseCount: 2 }) }),
      turn({ caseId: "c2", report: report({ repeatedPhraseCount: 0 }) }),
    ]);
    expect(metrics.repeatedRatio.ratio).toBe(0.5);
  });

  it("人设违背单独一项", () => {
    const metrics = narrativeMetrics([
      turn({ report: report({ issues: [{ code: "character_drift", severity: "block", detail: "崩了" }] }) }),
    ]);
    expect(metrics.characterDriftRatio.ratio).toBe(1);
    expect(metrics.plotOverreachRatio.ratio).toBe(0);
  });
});

describe("连贯性指标（12.3）", () => {
  it("地点没变算保持", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ location: "酒堂" }) }),
    ]);
    expect(metrics.sceneLocationKept.ratio).toBe(1);
  });

  it("地点变了但没有 scene 块交代，算没保持", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ location: "后山" }), sceneShifted: false }),
    ]);
    expect(metrics.sceneLocationKept.hits).toBe(0);
    expect(metrics.sceneLocationKept.total).toBe(1);
  });

  it("地点变了且有 scene 块交代，算保持", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ location: "后山" }), sceneShifted: true }),
    ]);
    expect(metrics.sceneLocationKept.ratio).toBe(1);
  });

  it("时间倒退才算不一致", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ time: "深夜" }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ time: "清晨" }) }),
    ]);
    expect(metrics.timelineConsistent.hits).toBe(0);
  });

  it("时间往前推算一致", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ time: "傍晚" }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ time: "深夜" }) }),
    ]);
    expect(metrics.timelineConsistent.ratio).toBe(1);
  });

  it("认不出时间顺序时不判倒退，避免假警报", () => {
    expect(timeWentBackwards("某个说不清的时候", "深夜")).toBe(false);
    expect(timeWentBackwards("深夜", "说不清")).toBe(false);
    expect(timeWentBackwards("深夜", "清晨")).toBe(true);
    expect(timeWentBackwards("清晨", "深夜")).toBe(false);
  });

  it("凭空往场景里塞人算没保持", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ presentCharacters: ["林晚晴"] }) }),
      turn({
        caseId: "c2",
        turn: 2,
        scene: scene({ presentCharacters: ["林晚晴", "陌生剑客"] }),
      }),
    ]);
    expect(metrics.characterStateKept.hits).toBe(0);
  });

  it("有人离开不算没保持", () => {
    const metrics = coherenceMetrics([
      turn({ scene: scene({ presentCharacters: ["林晚晴", "老周"] }) }),
      turn({ caseId: "c2", turn: 2, scene: scene({ presentCharacters: ["林晚晴"] }) }),
    ]);
    expect(metrics.characterStateKept.ratio).toBe(1);
  });

  it("未解决剧情线保留：开着的线不能无声消失", () => {
    const metrics = coherenceMetrics([
      turn({ threads: [thread({ id: "t1" }), thread({ id: "t2" })] }),
      turn({ caseId: "c2", turn: 2, threads: [thread({ id: "t1" })] }),
    ]);
    expect(metrics.threadRetention.hits).toBe(1);
    expect(metrics.threadRetention.total).toBe(2);
  });

  it("被标成 resolved 是有依据的收线，不算丢", () => {
    const metrics = coherenceMetrics([
      turn({ threads: [thread({ id: "t1" })] }),
      turn({ caseId: "c2", turn: 2, threads: [thread({ id: "t1", status: "resolved" })] }),
    ]);
    expect(metrics.threadRetention.ratio).toBe(1);
  });

  it("搁置的线不算丢", () => {
    const metrics = coherenceMetrics([
      turn({ threads: [thread({ id: "t1" })] }),
      turn({ caseId: "c2", turn: 2, threads: [thread({ id: "t1", status: "dormant" })] }),
    ]);
    expect(metrics.threadRetention.ratio).toBe(1);
  });

  it("没有上一轮可比时返回 null，不报 0", () => {
    const metrics = coherenceMetrics([turn({ scene: scene({ location: "酒堂" }) })]);
    expect(metrics.sceneLocationKept.ratio).toBeNull();
    expect(metrics.threadRetention.ratio).toBeNull();
  });

  it("不跨会话比：两条序列接在一起不该算成一次丢失", () => {
    // 真机跑批里抓到过：seq-01 的最后一轮和 seq-02 的第一轮被算成一次丢失，
    // 因为那时按数组顺序比，没看它们属不属于同一次会话。
    const metrics = coherenceMetrics([
      turn({
        caseId: "s1#4",
        run: "s1",
        turn: 4,
        scene: scene({ location: "酒堂" }),
        threads: [thread({ id: "t1" })],
      }),
      turn({ caseId: "s2#1", run: "s2", turn: 1, scene: scene({ location: "西阁" }) }),
    ]);
    expect(metrics.sceneLocationKept.ratio).toBeNull();
    expect(metrics.threadRetention.ratio).toBeNull();
  });

  it("同一次会话内仍然照常比", () => {
    const metrics = coherenceMetrics([
      turn({ caseId: "s1#1", run: "s1", turn: 1, scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "s1#2", run: "s1", turn: 2, scene: scene({ location: "西阁" }) }),
    ]);
    expect(metrics.sceneLocationKept.total).toBe(1);
    expect(metrics.sceneLocationKept.hits).toBe(0);
  });
});

describe("指标汇总与回归判定", () => {
  const healthy: EvalTurn[] = [
    turn({
      scene: scene({ location: "酒堂", time: "深夜", presentCharacters: ["林晚晴"] }),
      threads: [thread({ id: "t1" })],
    }),
    turn({
      caseId: "c2",
      turn: 2,
      scene: scene({ location: "酒堂", time: "深夜", presentCharacters: ["林晚晴"] }),
      threads: [thread({ id: "t1" })],
    }),
  ];

  it("三族指标一起出来", () => {
    const family = allMetrics(healthy);
    expect(Object.keys(family.structure)).toHaveLength(4);
    expect(Object.keys(family.narrative)).toHaveLength(5);
    expect(Object.keys(family.coherence)).toHaveLength(4);
  });

  it("压成文本时带上分子分母和说明", () => {
    const text = formatMetrics(allMetrics(healthy));
    expect(text).toContain("—— 结构 ——");
    expect(text).toContain("—— 叙事 ——");
    expect(text).toContain("—— 连贯性 ——");
    expect(text).toContain("validBlockRatio");
    // 两轮各 4 块，加起来 8 块。括号是全角，和面板里其它文案一致
    expect(text).toContain("（8/8）");
  });

  it("无从判定的项在文本里写明，不显示成 0%", () => {
    const text = formatMetrics(allMetrics([turn()]));
    expect(text).toContain("无从判定");
  });

  it("指标变差会被找出来", () => {
    const before = allMetrics(healthy);
    const worse = allMetrics([
      turn({
        report: report({ issues: [{ code: "player_control", severity: "block", detail: "替玩家行动" }] }),
        scene: scene({ location: "酒堂" }),
      }),
      turn({ caseId: "c2", turn: 2, report: report(), scene: scene({ location: "后山" }) }),
    ]);
    const found = findRegressions(before, worse);
    expect(found.map((item) => item.key)).toContain("playerControlRatio");
    expect(found.map((item) => item.key)).toContain("sceneLocationKept");
  });

  it("小幅波动不算退化", () => {
    const before = allMetrics(healthy);
    const slightlyWorse = allMetrics([
      turn({ report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c2", turn: 2, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c3", turn: 3, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c4", turn: 4, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c5", turn: 5, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c6", turn: 6, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c7", turn: 7, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c8", turn: 8, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c9", turn: 9, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c10", turn: 10, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c11", turn: 11, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c12", turn: 12, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c13", turn: 13, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c14", turn: 14, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c15", turn: 15, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c16", turn: 16, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c17", turn: 17, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c18", turn: 18, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c19", turn: 19, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({ caseId: "c20", turn: 20, report: report(), scene: scene({ location: "酒堂" }) }),
      turn({
        caseId: "c21",
        turn: 21,
        report: report({
          issues: [{ code: "player_control", severity: "block", detail: "一次" }],
        }),
        scene: scene({ location: "酒堂" }),
      }),
    ]);
    // 1/21 ≈ 4.8%，低于 5% 的容忍度
    expect(findRegressions(before, slightlyWorse)).toHaveLength(0);
  });

  it("无从判定的项不参与回归判定", () => {
    const before = allMetrics([turn()]);
    const after = allMetrics([turn({ report: report({ issues: [{ code: "player_control", severity: "block", detail: "x" }] }) })]);
    // 结构族两边都是 null，不该被算成退化
    expect(findRegressions(before, after).every((item) => item.key !== "validBlockRatio")).toBe(true);
  });

  it("退化按幅度排序，最严重的在前", () => {
    const before = allMetrics(healthy);
    const worse = allMetrics([
      turn({
        report: report({ issues: [{ code: "player_control", severity: "block", detail: "x" }] }),
        scene: scene({ location: "酒堂" }),
      }),
      turn({ caseId: "c2", turn: 2, report: report(), scene: scene({ location: "后山" }) }),
    ]);
    const found = findRegressions(before, worse);
    for (let i = 1; i < found.length; i += 1) {
      expect(Math.abs(found[i - 1].delta)).toBeGreaterThanOrEqual(Math.abs(found[i].delta));
    }
  });
});
