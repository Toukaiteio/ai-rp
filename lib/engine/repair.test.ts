import { describe, expect, it } from "vitest";
import {
  buildRepairMessages,
  extractRepairedText,
  summarizeReasons,
  REPAIR_SYSTEM_PROMPT,
} from "./repair";
import { resolveGeneration, validateResponseBlocks } from "./validate";
import { checkGeneration } from "./report";
import type { GenerationIssue } from "./types";

/** 造一条硬错误，和真机跑批里抓到的那条一样。 */
const PLAYER_CONTROL: GenerationIssue = {
  code: "player_control",
  severity: "block",
  blockIndex: 1,
  detail: "narr 里替玩家做动作：你坐下",
};

describe("自动修复：提示词", () => {
  it("明确列出不许改的东西，防止模型顺手重写剧情", () => {
    for (const forbidden of [
      "已经发生的事件",
      "角色关系",
      "人物设定",
      "玩家说过的话",
      "场景地点",
      "时间线",
    ]) {
      expect(REPAIR_SYSTEM_PROMPT).toContain(forbidden);
    }
  });

  it("明确列出允许做的六件事", () => {
    for (const allowed of ["改成 narr", "拆成 dlg", "只留说出口的原话", "替玩家", "who"]) {
      expect(REPAIR_SYSTEM_PROMPT).toContain(allowed);
    }
  });

  it("强调不扩写、不润色，宁可删一句也不补一句", () => {
    expect(REPAIR_SYSTEM_PROMPT).toContain("宁可删掉一句，也不要补一句");
    expect(REPAIR_SYSTEM_PROMPT).toContain("不要扩写");
  });

  it("带上块协议，修复模型不用猜格式", () => {
    const messages = buildRepairMessages({
      candidate: "<narr>她抬眼。你坐下。</narr>",
      playerInput: "我推门进来。",
      cardName: "林晚晴",
      issues: [PLAYER_CONTROL],
    });
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("<narr>");
    expect(system).toContain("<act who=");
    expect(system).toContain("<dlg who=");
    expect(system).toContain("player 块只用来标记玩家输入");
    expect(system).toContain("绝不嵌套");
    expect(system).toContain("每个开标签都必须有同名闭合标签");
  });

  it("请求里只有候选正文、玩家这一句和角色名，没有聊天历史", () => {
    const candidate = "<narr>她抬眼。你坐下。</narr><dlg who=\"林晚晴\">住店？</dlg>";
    const messages = buildRepairMessages({
      candidate,
      playerInput: "我推门进来。",
      cardName: "林晚晴",
      knownCharacters: ["林晚晴", "沈砚"],
      issues: [PLAYER_CONTROL],
    });

    // 只有两条消息：system + user。历史一条都没有。
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    const user = messages[1].content;
    expect(user).toContain(candidate);
    expect(user).toContain("我推门进来。");
    expect(user).toContain("林晚晴");
    expect(user).toContain("沈砚");
    // 失败原因要在里面，模型才知道修什么
    expect(user).toContain("替玩家说话或行动");
  });

  it("超长的玩家输入会被截断，不把整段原文塞进修复请求", () => {
    const long = "很长的一句玩家输入。".repeat(80);
    const messages = buildRepairMessages({
      candidate: "<narr>她抬眼。</narr>",
      playerInput: long,
      cardName: "林晚晴",
      issues: [PLAYER_CONTROL],
    });
    expect(messages[1].content.length).toBeLessThan(long.length);
    expect(messages[1].content).toContain("…");
  });

  it("误写的工具标签不会原样喂给修复模型", () => {
    const messages = buildRepairMessages({
      candidate: '<narr>她记下了。</narr><remember_character name="林晚晴">老板娘</remember_character>',
      playerInput: "我看着她。",
      cardName: "林晚晴",
      issues: [{ code: "pseudo_tool_text", severity: "block", detail: "剥掉 30 字" }],
    });
    expect(messages[1].content).not.toContain("remember_character");
    expect(messages[1].content).toContain("她记下了");
  });
});

describe("自动修复：失败原因的翻译", () => {
  it("同一类问题只列一次，并给出可执行的指令", () => {
    const reasons = summarizeReasons([
      PLAYER_CONTROL,
      { ...PLAYER_CONTROL, blockIndex: 3 },
      { code: "who_pronoun", severity: "block", detail: "who 是代词「她」" },
    ]);
    const lines = reasons.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("替玩家说话或行动");
    expect(lines[0]).toContain("删掉替玩家说的话");
    expect(lines[1]).toContain("who 用了代词");
  });

  it("问题再多也只列六条，避免提示词被撑爆", () => {
    const issues: GenerationIssue[] = (
      ["player_control", "who_pronoun", "who_inexact", "character_drift", "dlg_markup", "no_blocks", "pseudo_tool_text", "narrator_in_character"] as const
    ).map((code) => ({ code, severity: "block" as const, detail: "x" }));
    expect(summarizeReasons(issues).split("\n")).toHaveLength(6);
  });

  it("没有问题时也给一句兜底", () => {
    expect(summarizeReasons([])).toContain("不符合输出协议");
  });
});

describe("自动修复：输出清洗", () => {
  it("剥掉整段代码围栏", () => {
    expect(extractRepairedText('```html\n<narr>她抬眼。</narr>\n```')).toBe("<narr>她抬眼。</narr>");
  });

  it("剥掉「以下是修复后的回复」这类前言", () => {
    expect(extractRepairedText("以下是修复后的回复：\n<narr>她抬眼。</narr>")).toBe(
      "<narr>她抬眼。</narr>",
    );
  });

  it("正文本身不动", () => {
    const text = '<narr>她抬眼。</narr>\n<dlg who="林晚晴">住店？</dlg>';
    expect(extractRepairedText(text)).toBe(text);
  });

  it("空输出返回空串", () => {
    expect(extractRepairedText("   \n  ")).toBe("");
  });
});

describe("自动修复：修完必须重新过质量门", () => {
  /** 模拟一次修复往返：拿到修复文本后重新校验并给出落地结果。 */
  function afterRepair(original: string, repaired: string) {
    const options = { cardName: "林晚晴", userName: "你", playerInput: "我推门进来。", checkCharacterNames: true };
    const before = validateResponseBlocks(original, options);
    const after = validateResponseBlocks(repaired, options);
    const result = resolveGeneration(after, {
      report: checkGeneration({ raw: repaired, ...options, now: 0 }),
      repairAttempted: true,
      repairSucceeded: after.decision !== "rejected",
    });
    return { before, after, result };
  }

  it("修好之后按正常流程落地，并记下「修过一次」", () => {
    const { before, result } = afterRepair(
      "<narr>她抬眼。你坐下。</narr>",
      '<narr>她抬眼。</narr><dlg who="林晚晴">住店？</dlg>',
    );
    expect(before.decision).toBe("rejected");
    expect(result.status).toBe("accepted");
    expect(result.report.repairAttempted).toBe(true);
    expect(result.report.repairSucceeded).toBe(true);
  });

  it("修复模型自己又替玩家行动时，仍然拒收", () => {
    const { result } = afterRepair(
      "<narr>她抬眼。你坐下。</narr>",
      "<narr>她抬眼，你也跟着坐下了。</narr>",
    );
    expect(result.status).toBe("rejected");
    expect(result.report.repairSucceeded).toBe(false);
  });

  it("修复模型编出新人物时也拒收", () => {
    const { result } = afterRepair(
      "<narr>她抬眼。你坐下。</narr>",
      '<dlg who="王掌柜">住店？</dlg>',
    );
    expect(result.status).toBe("rejected");
  });

  it("修复模型写坏块协议时也拒收", () => {
    const { result } = afterRepair("<narr>她抬眼。你坐下。</narr>", "她抬眼看过来，没说话。");
    expect(result.status).toBe("rejected");
    expect(result.report.repairSucceeded).toBe(false);
  });

  it("修复后只剩软错误时按降级落地，算修好了", () => {
    const { result } = afterRepair(
      "<narr>她抬眼。你坐下。</narr>",
      '<act who="林晚晴">她起身，走向门口。</act>',
    );
    expect(result.status).toBe("repaired");
    expect(result.report.repairSucceeded).toBe(true);
    expect(result.report.degradations).toHaveLength(1);
  });
});
