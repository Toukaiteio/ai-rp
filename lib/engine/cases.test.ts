import { describe, expect, it } from "vitest";
import { parseRawBlocks } from "@/lib/blocks";
import { BASELINE_CASES } from "./cases";
import { checkGeneration } from "./report";
import { ISSUE_CODES, type IssueCode } from "./types";

/** Phase 0 的验收标准之一：至少 20 组人工测试输入，每组都有预期行为。 */
describe("基线用例表", () => {
  it("至少 20 组", () => {
    expect(BASELINE_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it("用例 id 唯一，标题和目标都写清楚了", () => {
    const ids = new Set<string>();
    for (const testCase of BASELINE_CASES) {
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);
      expect(testCase.title.trim().length).toBeGreaterThan(0);
      expect(testCase.goal.trim().length).toBeGreaterThan(0);
      expect(testCase.rubric.trim().length).toBeGreaterThan(0);
      expect(testCase.playerInput.trim().length).toBeGreaterThan(0);
    }
  });

  it("每张卡都有名字、设定、性格和开场白", () => {
    for (const testCase of BASELINE_CASES) {
      const card = testCase.card;
      expect(card.name.trim().length, testCase.id).toBeGreaterThan(0);
      expect(card.description.trim().length, testCase.id).toBeGreaterThan(0);
      expect(card.personality.trim().length, testCase.id).toBeGreaterThan(0);
      expect(card.scenario.trim().length, testCase.id).toBeGreaterThan(0);
      expect(card.first_mes.trim().length, testCase.id).toBeGreaterThan(0);
    }
  });

  it("预期里用到的问题码都是真实存在的", () => {
    const known = new Set<string>(ISSUE_CODES);
    for (const testCase of BASELINE_CASES) {
      for (const code of [...(testCase.expect.mustFlag ?? []), ...(testCase.expect.mustNotFlag ?? [])]) {
        expect(known.has(code), `${testCase.id} 用了未知问题码 ${code}`).toBe(true);
      }
    }
  });

  it("Phase 0 要求统计的错误类型每一种都有用例覆盖", () => {
    const required: IssueCode[] = [
      "act_overlong",
      "act_multi_action",
      "act_has_dialogue",
      "act_has_thought",
      "dlg_has_action",
      "player_control",
      "repeated_expression",
      "plot_overreach",
      "language_switch",
      "character_drift",
    ];
    // 允许出现在 mustFlag 或 mustNotFlag 里：有些用例是「不该犯这个错」的反向样本，
    // 但每组至少要在目标里点名它，这样跑批时能按错误类型归档。
    for (const code of required) {
      const covered = BASELINE_CASES.some(
        (testCase) =>
          testCase.expect.mustFlag?.includes(code) ||
          testCase.expect.mustNotFlag?.includes(code) ||
          testCase.goal.includes(goalHint(code)),
      );
      expect(covered, `没有用例覆盖 ${code}`).toBe(true);
    }
  });

  it("每张卡的开场白都是合法的消息块，检查器不会在起手就报错", () => {
    for (const testCase of BASELINE_CASES) {
      const blocks = parseRawBlocks(testCase.card.first_mes);
      expect(blocks.length, testCase.id).toBeGreaterThan(0);
      const report = checkGeneration({
        raw: testCase.card.first_mes,
        cardName: testCase.card.name,
        userName: "你",
        playerInput: "",
        now: 0,
      });
      // 开场白本身不该触发替玩家行动或语言切换
      expect(report.playerControlViolation, testCase.id).toBe(false);
    }
  });
});

/** 用例 goal 里描述这类问题时用的说法。 */
function goalHint(code: IssueCode): string {
  switch (code) {
    case "act_overlong":
      return "act 过长";
    case "act_multi_action":
      return "act 含多个动作";
    case "act_has_dialogue":
      return "act 混入对白";
    case "act_has_thought":
      return "act 混入心理解释";
    case "dlg_has_action":
      return "dlg 混入动作";
    case "player_control":
      return "替玩家";
    case "repeated_expression":
      return "重复上一轮";
    case "plot_overreach":
      return "一次性推进太多剧情";
    case "language_switch":
      return "角色语言切换错误";
    case "character_drift":
      return "角色行为脱离设定";
    default:
      return code;
  }
}
