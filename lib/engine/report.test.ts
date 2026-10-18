import { describe, expect, it } from "vitest";
import { parseRawBlocks } from "@/lib/blocks";
import { checkGeneration } from "./report";
import { ISSUE_CODES, type GenerationReport, type IssueCode } from "./types";
import { visibleLength } from "./text";

/** 每个用例都从这里起手，默认是一张有名字的卡、中文玩家。 */
function reportOf(raw: string, extra: Partial<Parameters<typeof checkGeneration>[0]> = {}): GenerationReport {
  return checkGeneration({
    raw,
    cardName: "林晚晴",
    userName: "你",
    playerInput: "我把外套挂在门边。",
    checkCharacterNames: true,
    now: 1_700_000_000_000,
    ...extra,
  });
}

function codes(report: GenerationReport): IssueCode[] {
  return report.issues.map((issue) => issue.code);
}

function statusOf(report: GenerationReport, code: IssueCode): string | undefined {
  return report.checks.find((check) => check.code === code)?.status;
}

describe("Phase 0 生成报告：基本计数", () => {
  it("统计块数、act 数、对白数、场景数和可见字数", () => {
    const report = reportOf(
      "<narr>壁炉的火快灭了。</narr>" +
        '<act who="林晚晴">她抬眼。</act>' +
        '<dlg who="林晚晴">住店？</dlg>' +
        '<dlg who="林晚晴">先付钱。</dlg>' +
        "<scene>天亮了。</scene>",
    );

    expect(report.blockCount).toBe(5);
    expect(report.actCount).toBe(1);
    expect(report.dialogueCount).toBe(2);
    expect(report.sceneCount).toBe(1);
    expect(report.invalidActCount).toBe(0);
    expect(report.responseLength).toBe(
      visibleLength("壁炉的火快灭了。她抬眼。住店？先付钱。天亮了。"),
    );
  });

  it("干净的回复判定为合格，并且把每一项检查都列出来", () => {
    const report = reportOf(
      '<narr>壁炉里的火塌了一角。</narr>\n<act who="林晚晴">她把火钳放下。</act>\n<dlg who="林晚晴">挂那儿。别滴水。</dlg>',
    );

    expect(report.verdict).toBe("pass");
    expect(report.issues).toEqual([]);
    // 每一项问题码都得有一项检查，否则面板上看不出覆盖范围
    expect(report.checks).toHaveLength(ISSUE_CODES.length);
    expect(report.checks.every((check) => check.status === "pass" || check.status === "skip")).toBe(
      true,
    );
  });

  it("同一份输入永远得到同一份报告（时间戳由调用方固定）", () => {
    const raw = '<narr>雨小了。</narr><dlg who="林晚晴">上楼吧。</dlg>';
    expect(reportOf(raw)).toEqual(reportOf(raw));
  });

  it("报告里不带完整正文，只留长度、计数和 12 字以内的片段", () => {
    const secret = "这是一段很长的私密聊天内容，不应该被整段写进观测报告里面去。";
    const report = reportOf(`<narr>${secret}</narr>`);
    const serialized = JSON.stringify(report);
    expect(serialized.includes(secret)).toBe(false);
    expect(report.replyHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("Phase 0 错误类型：act", () => {
  it("act 过长", () => {
    const report = reportOf(
      '<act who="林晚晴">她把账本合上，又用指尖压了压封面，才慢慢抬眼看向门口。</act>',
    );
    expect(codes(report)).toContain("act_overlong");
    expect(report.invalidActCount).toBe(1);
    expect(statusOf(report, "act_overlong")).toBe("warn");
  });

  it("act 含多个动作", () => {
    const report = reportOf('<act who="林晚晴">她起身，走向门口。</act>');
    expect(codes(report)).toContain("act_multi_action");
    expect(report.invalidActCount).toBe(1);
  });

  it("act 用串联词写第二层动作", () => {
    const report = reportOf('<act who="林晚晴">她抬眼然后又低下去。</act>');
    expect(codes(report)).toContain("act_multi_action");
  });

  it("act 混入对白", () => {
    const report = reportOf('<act who="林晚晴">她低声说「先付钱」。</act>');
    expect(codes(report)).toContain("act_has_dialogue");
    expect(report.invalidActCount).toBe(1);
  });

  it("act 混入心理解释", () => {
    const report = reportOf('<act who="林晚晴">她犹豫着，因为不想提起旧事。</act>');
    expect(codes(report)).toContain("act_has_thought");
  });

  it("被解析器降级成旁白的 act 仍然计入不合格，不能从指标里消失", () => {
    const raw = '<act who="林晚晴">她说完就去翻书，没真翻，只是来回翻。</act>';
    // 渲染侧确实降级了
    expect(parseRawBlocks(raw)).toEqual([
      { kind: "act", who: "林晚晴", text: "她说完就去翻书，没真翻，只是来回翻。" },
    ]);
    const report = reportOf(raw);
    expect(report.actCount).toBe(1);
    expect(report.invalidActCount).toBe(1);
  });

  it("短而单一的动作不误报", () => {
    const report = reportOf('<act who="林晚晴">她把杯子放下。</act>');
    expect(codes(report).filter((code) => code.startsWith("act_"))).toEqual([]);
    expect(report.invalidActCount).toBe(0);
  });
});

describe("Phase 0 错误类型：dlg", () => {
  it("dlg 混入括号里的动作", () => {
    const report = reportOf('<dlg who="林晚晴">（她低头擦了擦杯子）住店？</dlg>');
    expect(codes(report)).toContain("dlg_has_action");
  });

  it("dlg 混入星号动作", () => {
    const report = reportOf('<dlg who="林晚晴">*把灯推过来* 先付钱。</dlg>');
    expect(codes(report)).toContain("dlg_has_action");
  });

  it("dlg 用转述句式开头", () => {
    const report = reportOf('<dlg who="林晚晴">她笑了笑，住店？</dlg>');
    expect(codes(report)).toContain("dlg_has_action");
  });

  it("正常对白不误报", () => {
    const report = reportOf('<dlg who="林晚晴">住店？先付钱。</dlg>');
    expect(codes(report)).toEqual([]);
  });
});

describe("Phase 0 错误类型：替玩家行动", () => {
  it("出现玩家名下的块", () => {
    const report = reportOf('<dlg who="你">我想先坐会儿。</dlg>');
    expect(report.playerControlViolation).toBe(true);
    expect(statusOf(report, "player_control")).toBe("block");
    expect(report.verdict).toBe("reject");
  });

  it("who 写成 player 也算", () => {
    const report = reportOf('<act who="player">他点了点头。</act>');
    expect(report.playerControlViolation).toBe(true);
  });

  it("旁白里替玩家做动作", () => {
    const report = reportOf("<narr>你点了点头，把湿外套挂好。</narr>");
    expect(report.playerControlViolation).toBe(true);
  });

  it("旁白里替玩家写心情", () => {
    const report = reportOf("<narr>你感到一阵说不出的疲惫。</narr>");
    expect(report.playerControlViolation).toBe(true);
  });

  it("角色对白里提到「你」不算替玩家行动", () => {
    const report = reportOf('<dlg who="林晚晴">你不用记账。</dlg>');
    expect(report.playerControlViolation).toBe(false);
  });

  it("引号里的玩家原话不算旁白代写", () => {
    const report = reportOf('<narr>她重复了一遍「你点了点头」这几个字，没听懂。</narr>');
    expect(report.playerControlViolation).toBe(false);
  });
});

describe("Phase 0 错误类型：复读", () => {
  const previous =
    '<narr>壁炉里的火塌了一角，她拿火钳拨了拨，没抬头。</narr>\n<dlg who="林晚晴">挂那儿。别滴水。</dlg>';

  it("和上一轮逐字重合会被数出来", () => {
    const report = reportOf(
      '<narr>壁炉里的火塌了一角，她拿火钳拨了拨，还是没抬头。</narr>\n<dlg who="林晚晴">先付钱。</dlg>',
      { previousReply: previous },
    );
    expect(report.repeatedPhraseCount).toBeGreaterThan(0);
    expect(codes(report)).toContain("repeated_expression");
    expect(statusOf(report, "repeated_expression")).toBe("warn");
  });

  it("换了说法就不算复读", () => {
    const report = reportOf(
      '<narr>她把抹布搭回架子上，往门外看了一眼。</narr>\n<dlg who="林晚晴">明天再说。</dlg>',
      { previousReply: previous },
    );
    expect(report.repeatedPhraseCount).toBe(0);
  });

  it("没有上一轮时跳过复读检查，而不是判通过", () => {
    const report = reportOf('<dlg who="林晚晴">住店？</dlg>');
    expect(statusOf(report, "repeated_expression")).toBe("skip");
  });
});

describe("Phase 0 错误类型：剧情推进", () => {
  it("一轮里换两次场算推进太多", () => {
    const report = reportOf(
      "<scene>天亮了。</scene><narr>她开了门。</narr><scene>午后的街上。</scene>",
    );
    expect(codes(report)).toContain("plot_overreach");
  });

  it("块数超过上限算推进太多", () => {
    const blocks = Array.from({ length: 14 }, (_, i) => `<narr>第${i}件事。</narr>`).join("");
    const report = reportOf(blocks);
    expect(codes(report)).toContain("plot_overreach");
  });

  it("长回复里出现收束词算把剧情做完", () => {
    const filler = "雨声贴着窗纸，一层一层压下来。".repeat(50);
    const report = reportOf(`<narr>${filler}从此再也没有人来过这间旅店。</narr>`);
    expect(codes(report)).toContain("plot_overreach");
    expect(codes(report)).toContain("response_overlong");
  });

  it("正常长度的一轮不误报", () => {
    const report = reportOf(
      '<narr>她往炉子里添了一块炭。</narr>\n<dlg who="林晚晴">坐吧。</dlg>',
    );
    expect(codes(report)).toEqual([]);
  });
});

describe("Phase 0 错误类型：语言", () => {
  it("中文玩家被切成日语", () => {
    const report = reportOf('<dlg who="深月风花">別に。関係ないでしょ。</dlg>', {
      cardName: "深月风花",
      playerInput: "你午休都在这儿看书？",
    });
    expect(codes(report)).toContain("language_switch");
    expect(statusOf(report, "language_switch")).toBe("block");
    expect(report.verdict).toBe("reject");
  });

  it("日语玩家说日语不算切换", () => {
    const report = reportOf('<dlg who="深月风花">別に。関係ないでしょ。</dlg>', {
      cardName: "深月风花",
      playerInput: "お昼休みはいつもここで本を読んでるの？",
    });
    expect(codes(report)).not.toContain("language_switch");
  });

  it("英文玩家说英文不算切换", () => {
    const report = reportOf('<dlg who="深月风花">None of your business.</dlg>', {
      cardName: "深月风花",
      playerInput: "Do you always read here at lunch?",
    });
    expect(codes(report)).not.toContain("language_switch");
    expect(report.language).toBe("latin");
  });

  it("专有名词保留原文不算整句切换", () => {
    const report = reportOf('<dlg who="深月风花">那本是「こころ」，你没读过？</dlg>', {
      cardName: "深月风花",
      playerInput: "你在看什么书？",
    });
    expect(codes(report)).not.toContain("language_switch");
  });
});

describe("Phase 0 错误类型：人设漂移", () => {
  it("出现没登记过的人名", () => {
    const report = reportOf('<dlg who="王掌柜">住店？</dlg>');
    expect(codes(report)).toContain("character_drift");
    expect(statusOf(report, "character_drift")).toBe("block");
  });

  it("登记过的人名不误报", () => {
    const report = reportOf('<dlg who="沈砚">前天还在。</dlg>', {
      cardName: "沈砚",
      knownCharacters: ["沈砚"],
    });
    expect(codes(report)).not.toContain("character_drift");
  });

  it("旁白里出现第一人称", () => {
    const report = reportOf("<narr>我看着她把灯芯剪短，没说话。</narr>");
    expect(codes(report)).toContain("narrator_in_character");
    expect(statusOf(report, "narrator_in_character")).toBe("block");
  });

  it("对白里的第一人称是合法的", () => {
    const report = reportOf('<dlg who="林晚晴">我不记得。</dlg>');
    expect(codes(report)).not.toContain("narrator_in_character");
  });

  it("引号里的第一人称不误报", () => {
    const report = reportOf('<narr>她学着你的语气说了句「我知道了」。</narr>');
    expect(codes(report)).not.toContain("narrator_in_character");
  });
});

describe("Phase 0 错误类型：文风与协议", () => {
  it("破折号", () => {
    const report = reportOf('<dlg who="林晚晴">住店——先付钱。</dlg>');
    expect(codes(report)).toContain("style_breach");
  });

  it("旁白像说明文", () => {
    const report = reportOf("<narr>空气中弥漫着一种说不出的安静，仿佛在诉说着什么。</narr>");
    expect(codes(report)).toContain("summary_tone");
  });

  it("没有块标记的纯文本", () => {
    const report = reportOf("住店？先付钱。");
    expect(codes(report)).toContain("no_blocks");
    expect(report.blockCount).toBe(1);
  });

  it("把工具调用写成标签", () => {
    const report = reportOf(
      '<narr>她记下了。</narr><remember_character name="林晚晴">老板娘</remember_character>',
    );
    expect(codes(report)).toContain("pseudo_tool_text");
    // 标签里的内容不该被当成剧情
    expect(report.dialogueCount).toBe(0);
  });
});

describe("Phase 0 判定分支", () => {
  it("只有 warn 时判可修复，不是不合格", () => {
    const report = reportOf('<act who="林晚晴">她起身，走向门口。</act>');
    expect(report.verdict).toBe("repair");
  });

  it("有 block 时判不合格", () => {
    const report = reportOf('<dlg who="你">我先坐会儿。</dlg>');
    expect(report.verdict).toBe("reject");
  });

  it("修复标记原样带进报告", () => {
    const report = reportOf('<dlg who="林晚晴">住店？</dlg>', {
      repair: { attempted: true, succeeded: false },
    });
    expect(report.repairAttempted).toBe(true);
    expect(report.repairSucceeded).toBe(false);
  });
});
