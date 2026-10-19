import { describe, expect, it } from "vitest";
import { parseBlocks } from "@/lib/blocks";
import { checkGeneration } from "./report";
import { bypassResponseValidation, describeValidation, resolveGeneration, stripStageDirections, validateResponseBlocks } from "./validate";
import { GATE_ACTION, ISSUE_CODES, type GenerationIssue, type IssueCode } from "./types";

const CARD = "林晚晴";

function validate(raw: string, options: Partial<Parameters<typeof validateResponseBlocks>[1]> = {}) {
  return validateResponseBlocks(raw, {
    cardName: CARD,
    userName: "你",
    playerInput: "我把外套挂在门边。",
    checkCharacterNames: true,
    ...options,
  });
}

function codes(raw: string, options = {}): IssueCode[] {
  return validate(raw, options).issues.map((issue) => issue.code);
}

/* ------------------------------------------------------------------ 1.1 块合法性 */

describe("质量门：块合法性", () => {
  it("名称宏按实际身份检查，但保留存储中的原宏", () => {
    for (const who of ["{{char}}", "<BOT>"]) {
      const raw = `<dlg who="${who}">欢迎。</dlg>`;
      expect(validate(raw).decision).toBe("accepted");
      expect(validate(raw).content).toBe(raw);
    }
    for (const who of ["{{user}}", "<USER>"]) {
      const result = validate(`<dlg who="${who}">欢迎。</dlg>`);
      expect(result.hardIssues.map((issue) => issue.code)).toContain("player_control");
    }
  });
  it("关闭质量门时保留原始结果，不执行角色名拒收", () => {
    const result = bypassResponseValidation('<dlg who="晚晴">住店？</dlg>');
    expect(result.decision).toBe("accepted");
    expect(result.content).toContain('who="晚晴"');
    expect(result.issues).toEqual([]);
  });

  it("只认识 narr / act / dlg / scene 四类模型块", () => {
    const result = validate(
      '<narr>雨小了。</narr><act who="林晚晴">她抬眼。</act><dlg who="林晚晴">住店？</dlg><scene>天亮了。</scene>',
    );
    expect(result.blocks.map((block) => block.kind)).toEqual(["narr", "act", "dlg", "scene"]);
    expect(result.severity).toBe("none");
  });

  it("模型输出 player 块直接判硬错误，并且不会被写回历史", () => {
    const result = validate('<narr>她抬眼。</narr><player>我先坐会儿。</player>');
    expect(result.severity).toBe("hard");
    expect(result.hardIssues.map((issue) => issue.code)).toContain("player_block");
    // 关键：player 块不能出现在可落地的内容里
    expect(result.content).toBe("");
    expect(result.blocks.some((block) => block.kind === "player")).toBe(false);
  });

  it("player 块即使和合法块混在一起也要拒收", () => {
    const result = validate('<player>我推门进去。</player><dlg who="林晚晴">住店？</dlg>');
    expect(result.decision).toBe("rejected");
    expect(result.content).toBe("");
  });

  it("整段没有块标记判硬错误", () => {
    const result = validate("住店？先付钱。");
    expect(result.severity).toBe("hard");
    expect(result.hardIssues.map((issue) => issue.code)).toContain("no_blocks");
  });

  it("空输出不判错，交给上层当成「没生成出东西」处理", () => {
    const result = validate("");
    expect(result.severity).toBe("none");
    expect(result.blocks).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 1.1 who 合法性 */

describe("质量门：who 合法性", () => {
  it("当前角色名准确时通过", () => {
    expect(codes('<dlg who="林晚晴">住店？</dlg>')).not.toContain("who_inexact");
  });

  it("省略 who 时按角色卡处理，不算错", () => {
    const result = validate('<dlg>住店？</dlg>');
    expect(result.severity).toBe("none");
  });

  it("用外号、简称时判 who_inexact", () => {
    const result = validate('<dlg who="晚晴">住店？</dlg>');
    expect(result.hardIssues.map((issue) => issue.code)).toContain("who_inexact");
    expect(result.decision).toBe("rejected");
  });

  it("带注解的 who 也算不准确", () => {
    expect(codes('<dlg who="林晚晴（老板娘）">住店？</dlg>')).toContain("who_inexact");
  });

  it("代词不能当 who", () => {
    for (const who of ["她", "他", "那个人", "对方", "某人"]) {
      const result = validate(`<dlg who="${who}">住店？</dlg>`);
      expect(result.hardIssues.map((issue) => issue.code), who).toContain("who_pronoun");
    }
  });

  it("没登记过的人名判 character_drift", () => {
    const result = validate('<dlg who="王掌柜">住店？</dlg>');
    expect(result.hardIssues.map((issue) => issue.code)).toContain("character_drift");
  });

  it("记忆里登记过的人名可以通过", () => {
    const result = validate('<dlg who="沈砚">前天还在。</dlg>', {
      cardName: "沈砚",
      knownCharacters: ["沈砚"],
    });
    expect(result.severity).toBe("none");
  });

  it("「她继续擦杯子」是一个动作，不是动作链", () => {
    // 真机跑批里抓到的误判：把「继续」当串联词，误伤大量正常 act
    expect(codes('<act who="林晚晴">她继续擦那只杯子。</act>')).not.toContain("act_multi_action");
    expect(codes('<act who="林晚晴">她翻了两页又停住。</act>')).toContain("act_multi_action");
  });

  it("dlg 里「要喝热的就坐下」是招呼，不是转述句式", () => {
    // 真机跑批里抓到的误判：把「要喝热」当成主语，正常的招呼被判成叙述
    expect(codes('<dlg who="林晚晴">要喝热的就坐下。不喝就站那儿，随你。</dlg>')).not.toContain(
      "dlg_has_action",
    );
  });

  it("dlg 里角色名开头的转述仍然要判", () => {
    expect(codes('<dlg who="林晚晴">林晚晴笑了笑，住店？</dlg>')).toContain("dlg_has_action");
  });

  it("act 的 who 同样要准确", () => {
    expect(codes('<act who="她">她抬眼。</act>')).toContain("who_pronoun");
  });

  it("间接提到玩家不算替他行动", () => {
    // 真机跑批里抓到的误判：「从你坐下起」被当成了「你坐下」
    expect(
      codes("<narr>她面前摊着账本，炭笔夹在指间，从你坐下起就没再动过。</narr>"),
    ).not.toContain("player_control");
    expect(codes("<narr>她起身时顺手把桌上的油灯往你那边推了推。</narr>")).not.toContain(
      "player_control",
    );
    expect(codes('<act who="林晚晴">她把杯子放回你手边。</act>')).not.toContain("player_control");
  });

  it("句首的玩家动作仍然要判", () => {
    expect(codes("<narr>你坐下，把伞靠在桌边。</narr>")).toContain("player_control");
    expect(codes("<narr>她抬眼。你坐下。</narr>")).toContain("player_control");
  });

  it("「她倒了半碗热水」是动作，不是动作结果", () => {
    expect(codes('<act who="林晚晴">她倒了半碗热水。</act>')).not.toContain("act_result");
    expect(codes('<act who="林晚晴">她把杯子碰倒了。</act>')).toContain("act_result");
  });

  it("「合上又翻开」是连续动作，不是正常的一个动作", () => {
    expect(codes('<act who="深月风花">她把文库本合上又翻开。</act>')).toContain(
      "act_multi_action",
    );
  });
});

/* ------------------------------------------------------------------ 1.1 act 合法性 */

describe("质量门：act 合法性", () => {
  it("单一、够短、白描的 act 通过", () => {
    const result = validate('<act who="林晚晴">她把杯子放下。</act>');
    expect(result.severity).toBe("none");
    expect(result.degradations).toEqual([]);
  });

  it("过长 → 软错误，降级成 narr，原文保留", () => {
    const text = "她把账本合上，又用指尖压了压封面，才慢慢抬眼看向门口。";
    const result = validate(`<act who="林晚晴">${text}</act>`);
    expect(result.severity).toBe("soft");
    expect(result.softIssues.map((issue) => issue.code)).toContain("act_overlong");
    expect(result.blocks[0].kind).toBe("narr");
    expect(result.blocks[0].text).toBe(text);
    expect(result.content).toContain(text);
  });

  it("两个动作 → 软错误", () => {
    const result = validate('<act who="林晚晴">她起身，走向门口。</act>');
    expect(result.softIssues.map((issue) => issue.code)).toContain("act_multi_action");
  });

  it("串联词写的连续动作链 → 软错误", () => {
    const result = validate('<act who="林晚晴">她抬眼然后低下去。</act>');
    expect(result.softIssues.map((issue) => issue.code)).toContain("act_multi_action");
  });

  it("混入对白 → 软错误", () => {
    const result = validate('<act who="林晚晴">她低声说「先付钱」。</act>');
    expect(result.softIssues.map((issue) => issue.code)).toContain("act_has_dialogue");
  });

  it("混入心理判断 → 软错误", () => {
    const result = validate('<act who="林晚晴">她犹豫着，因为不想提旧事。</act>');
    expect(result.softIssues.map((issue) => issue.code)).toContain("act_has_thought");
  });

  it("因果解释 → 软错误", () => {
    expect(codes('<act who="林晚晴">她没接话，所以屋里静了下来。</act>')).toContain(
      "act_has_thought",
    );
  });

  it("文学化比喻 → 软错误", () => {
    expect(codes('<act who="林晚晴">她抬眼像一片落叶。</act>')).toContain("act_metaphor");
    expect(codes('<act who="林晚晴">她的手指在桌面上低语。</act>')).toContain("act_metaphor");
  });

  it("动作造成的结果 → 软错误", () => {
    expect(codes('<act who="林晚晴">她把杯子碰倒了。</act>')).toContain("act_result");
    expect(codes('<act who="林晚晴">她把灯搁下，灯灭了。</act>')).toContain("act_result");
  });

  it("一个块可以同时命中多条软错误，但只降级一次", () => {
    const result = validate('<act who="林晚晴">她低声说「先付钱」，然后转身，像要走了。</act>');
    expect(result.softIssues.length).toBeGreaterThan(1);
    expect(result.degradations).toHaveLength(1);
    expect(result.blocks).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ 1.1 dlg 合法性 */

describe("质量门：dlg 合法性", () => {
  it("干净的对白通过", () => {
    const result = validate('<dlg who="林晚晴">住店？先付钱。</dlg>');
    expect(result.severity).toBe("none");
  });

  it("括号动作 → 剥掉后仍然是对白，不整块降级", () => {
    const result = validate('<dlg who="林晚晴">（她低头擦了擦杯子）住店？</dlg>');
    expect(result.severity).toBe("soft");
    expect(result.blocks[0].kind).toBe("dlg");
    expect(result.blocks[0].text).toBe("住店？");
    expect(result.degradations[0].to).toBe("dlg");
  });

  it("星号动作 → 剥掉", () => {
    const result = validate('<dlg who="林晚晴">*把灯推过来* 先付钱。</dlg>');
    expect(result.blocks[0].text).toBe("先付钱。");
  });

  it("「她笑了笑，」这类叙述前缀 → 剥掉", () => {
    const result = validate('<dlg who="林晚晴">她笑了笑，住店？</dlg>');
    expect(result.blocks[0].text).toBe("住店？");
  });

  it("只有舞台指示、剥完什么都不剩 → 整块丢掉", () => {
    const result = validate('<narr>她抬眼。</narr><dlg who="林晚晴">（她低头）</dlg>');
    expect(result.degradations[0].to).toBe("dropped");
    expect(result.blocks).toHaveLength(1);
    expect(result.content).not.toContain("她低头");
  });

  it("对白里出现 XML 标签 → 硬错误", () => {
    const result = validate('<dlg who="林晚晴">住店？<b>先付钱</b></dlg>');
    expect(result.hardIssues.map((issue) => issue.code)).toContain("dlg_markup");
    expect(result.decision).toBe("rejected");
  });

  it("对白里出现记忆类工具标签 → 先被当成误写的工具调用，同样是硬错误", () => {
    const result = validate('<dlg who="林晚晴">住店？<remember_place name="旅店"></dlg>');
    expect(result.hardIssues.map((issue) => issue.code)).toContain("pseudo_tool_text");
    expect(result.decision).toBe("rejected");
  });

  it("对白里出现 JSON 片段 → 硬错误", () => {
    const result = validate('<dlg who="林晚晴">住店？{"name":"林晚晴"}</dlg>');
    expect(result.hardIssues.map((issue) => issue.code)).toContain("dlg_markup");
  });

  it("正常对白里带书名号或引号不算标签", () => {
    expect(codes('<dlg who="林晚晴">那本是「こころ」，你没读过？</dlg>')).not.toContain("dlg_markup");
  });
});

/* ------------------------------------------------------------------ 1.2 严重程度 */

describe("质量门：三档严重程度", () => {
  it("干净 → none / accepted，内容一字不动", () => {
    const raw = '<narr>雨小了。</narr>\n<dlg who="林晚晴">上楼吧。</dlg>';
    const result = validate(raw);
    expect(result.severity).toBe("none");
    expect(result.decision).toBe("accepted");
    // 合法回复必须保持原样：不重新序列化、不补空属性
    expect(result.content).toBe(raw);
  });

  it("只有软错误 → soft / degraded", () => {
    const result = validate('<act who="林晚晴">她起身，走向门口。</act>');
    expect(result.severity).toBe("soft");
    expect(result.decision).toBe("degraded");
    expect(result.content).toBe("<narr>她起身，走向门口。</narr>");
  });

  it("有硬错误 → hard / rejected，内容为空", () => {
    const result = validate('<dlg who="她">住店？</dlg>');
    expect(result.severity).toBe("hard");
    expect(result.decision).toBe("rejected");
    expect(result.content).toBe("");
    expect(result.reason).toContain("代词");
  });

  it("硬错误优先于软错误：既有 act 过长又有替玩家行动时判拒收", () => {
    const result = validate(
      '<act who="林晚晴">她把账本合上，又用指尖压了压封面，才慢慢抬眼看向门口。</act><narr>你点了点头。</narr>',
    );
    expect(result.severity).toBe("hard");
    // 既然要拒收，就不再花力气降级
    expect(result.degradations).toEqual([]);
  });

  it("每一类问题都有明确的处理方式，没有漏网的码", () => {
    for (const code of ISSUE_CODES) {
      expect(GATE_ACTION[code], code).toBeTruthy();
    }
  });

  it("soft 只包含能就地改好的问题，hard 只包含救不回来的问题", () => {
    const soft: IssueCode[] = ["act_overlong", "act_multi_action", "act_has_dialogue", "act_has_thought", "act_metaphor", "act_result", "dlg_has_action"];
    const hard: IssueCode[] = ["player_control", "player_block", "who_pronoun", "who_inexact", "character_drift", "narrator_in_character", "language_switch", "dlg_markup", "no_blocks", "pseudo_tool_text"];
    for (const code of soft) expect(GATE_ACTION[code], code).toBe("degrade");
    for (const code of hard) expect(GATE_ACTION[code], code).toBe("reject");
  });
});

/* ------------------------------------------------------------------ 1.3 GenerationResult */

describe("质量门：落地结果", () => {
  function resolve(raw: string, options = {}) {
    const validation = validate(raw, options);
    const report = checkGeneration({
      raw,
      cardName: CARD,
      userName: "你",
      playerInput: "我把外套挂在门边。",
      now: 0,
      checkCharacterNames: true,
      ...options,
    });
    return { validation, report, result: resolveGeneration(validation, { report }) };
  }

  it("合格 → accepted，内容和原文一致", () => {
    const raw = '<narr>雨小了。</narr><dlg who="林晚晴">上楼吧。</dlg>';
    const { result } = resolve(raw);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("unreachable");
    expect(result.content).toBe(raw);
  });

  it("可降级 → repaired，内容是降级后的版本", () => {
    const { result } = resolve('<act who="林晚晴">她起身，走向门口。</act>');
    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") throw new Error("unreachable");
    expect(result.content).toBe("<narr>她起身，走向门口。</narr>");
  });

  it("拒收 → rejected，没有 content 字段可用，只有原因", () => {
    const { result } = resolve('<dlg who="你">我先坐会儿。</dlg>');
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason.length).toBeGreaterThan(0);
    expect("content" in result).toBe(false);
  });

  it("报告里的判定和质量门结论一致", () => {
    const cases = [
      '<narr>雨小了。</narr>',
      '<act who="林晚晴">她起身，走向门口。</act>',
      '<dlg who="她">住店？</dlg>',
    ];
    for (const raw of cases) {
      const { validation, report } = resolve(raw);
      expect(report.severity).toBe(validation.severity);
      expect(report.decision).toBe(validation.decision);
      const expected =
        validation.decision === "rejected" ? "reject" : validation.decision === "degraded" ? "repair" : "pass";
      expect(report.verdict, raw).toBe(expected);
    }
  });

  it("降级过的轮次在报告里留下降级记录和修复标记", () => {
    const { result } = resolve('<act who="林晚晴">她起身，走向门口。</act>');
    expect(result.report.degradations).toHaveLength(1);
    expect(result.report.repairAttempted).toBe(true);
    expect(result.report.repairSucceeded).toBe(true);
  });

  it("只记录不落地的问题不会把一轮判成不合格", () => {
    const raw = '<narr>壁炉的火塌了一角，她拿火钳拨了拨，没抬头。</narr><dlg who="林晚晴">挂那儿。</dlg>';
    const { report, result } = resolve(raw, { previousReply: raw });
    expect(report.issues.map((issue) => issue.code)).toContain("repeated_expression");
    expect(result.status).toBe("accepted");
    expect(report.verdict).toBe("pass");
  });
});

/* ------------------------------------------------------------------ 辅助函数 */

describe("质量门：辅助函数", () => {
  it("stripStageDirections 只剥舞台指示，不动台词", () => {
    expect(stripStageDirections("（她低头）住店？")).toBe("住店？");
    expect(stripStageDirections("*叹气* 先付钱。")).toBe("先付钱。");
    expect(stripStageDirections("她笑了笑，住店？")).toBe("住店？");
    expect(stripStageDirections("住店？先付钱。")).toBe("住店？先付钱。");
  });

  it("describeValidation 说清楚这一轮是怎么落地的", () => {
    expect(describeValidation(validate('<narr>雨小了。</narr>'))).toContain("通过");
    expect(describeValidation(validate('<act who="林晚晴">她起身，走向门口。</act>'))).toContain(
      "act→narr",
    );
    expect(describeValidation(validate('<dlg who="她">住店？</dlg>'))).toContain("拒收");
  });

  it("降级后的内容仍然能解析回同样的块（可渲染、可回灌）", () => {
    const result = validate(
      '<act who="林晚晴">她起身，走向门口。</act><dlg who="林晚晴">（她低头）住店？</dlg>',
    );
    expect(parseBlocks(result.content)).toEqual([
      { kind: "narr", text: "她起身，走向门口。", who: undefined },
      { kind: "dlg", who: "林晚晴", text: "住店？" },
    ]);
  });

  it("硬错误里的问题都带 blockIndex，方便定位到具体哪一块", () => {
    const result = validate('<narr>雨小了。</narr><dlg who="她">住店？</dlg>');
    const issue: GenerationIssue | undefined = result.hardIssues.find(
      (item) => item.code === "who_pronoun",
    );
    expect(issue?.blockIndex).toBe(1);
  });
});
