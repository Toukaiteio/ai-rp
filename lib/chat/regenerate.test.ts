import { describe, expect, it } from "vitest";
import {
  PREVIEW_CHARS,
  planRegenerate,
  preview,
  pushSwipe,
  regenerateNote,
  restoreSwipe,
  type RetryMessage,
} from "./regenerate";

function turns(list: Array<[RetryMessage["role"], string]>): RetryMessage[] {
  return list.map(([role, content], i) => ({ id: `m${i}`, role, content }));
}

describe("重新生成：算出重跑用什么", () => {
  it("丢掉最后一条回复，用它前面那句玩家输入重跑", () => {
    const plan = planRegenerate(
      turns([
        ["assistant", "开场白"],
        ["user", "我问她看的是什么书。"],
        ["assistant", "……你又没事干了？"],
      ]),
    );
    expect(plan.blocked).toBeUndefined();
    expect(plan.playerInput).toBe("我问她看的是什么书。");
    // 历史截到玩家那一句之前：错误回复一个字都不在里面
    expect(plan.history.map((turn) => turn.content)).toEqual(["开场白"]);
    expect(plan.discarded).toBe("……你又没事干了？");
  });

  it("错误回复绝不进新请求", () => {
    const plan = planRegenerate(
      turns([
        ["assistant", "开场白"],
        ["user", "你好"],
        ["assistant", "坏回复"],
      ]),
    );
    const all = [...plan.history.map((t) => t.content), plan.playerInput].join("\n");
    expect(all).not.toContain("坏回复");
  });

  it("回复后面还跟着别的消息时，重跑的是那条回复而不是最后一条", () => {
    const plan = planRegenerate(
      turns([
        ["user", "第一句"],
        ["assistant", "第一版回复"],
        ["user", "第二句"],
        ["assistant", "第二版回复"],
      ]),
    );
    expect(plan.playerInput).toBe("第二句");
    expect(plan.discarded).toBe("第二版回复");
    expect(plan.history.map((t) => t.content)).toEqual(["第一句", "第一版回复"]);
  });

  it("没有回复时给出原因，不瞎跑", () => {
    expect(planRegenerate(turns([["user", "你好"]])).blocked).toBe("no_reply");
    expect(planRegenerate([]).blocked).toBe("no_reply");
  });

  it("有回复但前面没有玩家输入时也给出原因", () => {
    const plan = planRegenerate(turns([["assistant", "开场白"], ["assistant", "回复"]]));
    expect(plan.blocked).toBe("no_user_input");
  });

  it("被弃用回复的 id 带出来，界面要拿它找回旧版本", () => {
    const list = turns([
      ["user", "你好"],
      ["assistant", "回复"],
    ]);
    expect(planRegenerate(list).discardedId).toBe(list[1].id);
  });
});

describe("重新生成：临时纠偏", () => {
  it("措辞具体：说清不要复用动作和句式、保持单一动作", () => {
    const note = regenerateNote();
    expect(note).toContain("上一版回复未采用");
    expect(note).toContain("不要复用上一版的动作表达和句式");
    expect(note).toContain("保持单一动作和短对白");
  });

  it("带上一版的开头片段，但只给片段不给全文", () => {
    const long = "她抬眼看过来，手里的书页停在半空，窗外的雨声压过了走廊里的脚步。";
    const note = regenerateNote(long);
    expect(note).toContain("不要再这样写");
    expect(note).toContain(preview(long));
    // 只给片段：全文不出现
    expect(note).not.toContain(long);
    expect(preview(long).length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
  });

  it("没有上一版时也能用，不留空句子", () => {
    const note = regenerateNote("");
    expect(note).not.toContain("上一版是这样开头的");
    expect(note.split("\n")).toHaveLength(3);
  });
});

describe("重新生成：旧版本列表", () => {
  it("追加一条新版本，下标指向它", () => {
    const result = pushSwipe(["第一版"], "第二版");
    expect(result.swipes).toEqual(["第一版", "第二版"]);
    expect(result.index).toBe(1);
  });

  it("从零开始也能追加", () => {
    expect(pushSwipe(undefined, "第一版")).toEqual({ swipes: ["第一版"], index: 0 });
  });

  it("正文一样的版本不重复追加", () => {
    const result = pushSwipe(["第一版", "第二版"], "第一版");
    expect(result.swipes).toHaveLength(2);
    expect(result.index).toBe(0);
  });

  it("重新生成失败时把旧版本放回去", () => {
    const result = restoreSwipe(["第一版"], "第一版");
    expect(result.swipes).toEqual(["第一版"]);
    expect(result.index).toBe(0);
  });

  it("放回一条原本不在列表里的旧版本时会补上", () => {
    const result = restoreSwipe([], "旧的那版");
    expect(result.swipes).toEqual(["旧的那版"]);
    expect(result.index).toBe(0);
  });

  it("没有任何版本时返回空，不崩", () => {
    expect(restoreSwipe(undefined, undefined).swipes).toBeUndefined();
  });
});
