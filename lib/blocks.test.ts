import { describe, expect, it } from "vitest";
import {
  blocksToRaw,
  dialogueContinues,
  isAtomicAct,
  parseBlocks,
  repairBlockStructure,
  stripPseudoToolTags,
} from "./blocks";

describe("消息块解析", () => {
  it("拆分旁白和人物发言，并提取人物名", () => {
    expect(
      parseBlocks('<narr>旁白。</narr>\n<dlg who="林晚晴">坐。</dlg>'),
    ).toEqual([
      { kind: "narr", text: "旁白。", who: undefined },
      { kind: "dlg", text: "坐。", who: "林晚晴" },
    ]);
  });

  it("不会把人物、旁白、人物的交替顺序解析成连续人物消息", () => {
    expect(
      parseBlocks(
        '<dlg who="Fuka Shikuzaki">真的……</dlg>\n' +
          "<narr>她想了想，眉头轻轻皱起来……</narr>\n" +
          '<dlg who="Fuka Shikuzaki">我有一根差不多的。</dlg>',
      ),
    ).toEqual([
      { kind: "dlg", text: "真的……", who: "Fuka Shikuzaki" },
      { kind: "narr", text: "她想了想，眉头轻轻皱起来……", who: undefined },
      { kind: "dlg", text: "我有一根差不多的。", who: "Fuka Shikuzaki" },
    ]);
  });

  it("旁白隔开的同一角色要重新报名字，动作块隔开则接着写", () => {
    const narrSplit = parseBlocks(
      '<dlg who="Fuka">第一句。</dlg><narr>她低下头。</narr><dlg who="Fuka">第二句。</dlg>',
    );
    expect(dialogueContinues(narrSplit, 2, "Fuka")).toBe(false);

    const actSplit = parseBlocks(
      '<dlg who="Fuka">第一句。</dlg><act who="Fuka">她顿了顿。</act><dlg who="Fuka">第二句。</dlg>',
    );
    expect(dialogueContinues(actSplit, 2, "Fuka")).toBe(true);
    expect(dialogueContinues(actSplit, 0, "Fuka")).toBe(false);
  });

  it("解析角色动作块，并在回写时保留 act 标签", () => {
    const blocks = parseBlocks('<act who="林晚晴">她皱了皱眉。</act>\n<dlg who="林晚晴">我不记得。</dlg>');
    expect(blocks).toEqual([
      { kind: "act", text: "她皱了皱眉。", who: "林晚晴" },
      { kind: "dlg", text: "我不记得。", who: "林晚晴" },
    ]);
    expect(blocksToRaw(blocks)).toBe(
      '<act who="林晚晴">她皱了皱眉。</act>\n<dlg who="林晚晴">我不记得。</dlg>',
    );
  });

  it("兼容大小写标签和单引号 who", () => {
    expect(parseBlocks("<NARR>旁白。</NARR><DLG who='林晚晴'>坐。</DLG>")).toEqual([
      { kind: "narr", text: "旁白。", who: undefined },
      { kind: "dlg", text: "坐。", who: "林晚晴" },
    ]);
  });

  it("流式输出中已闭合旁白后仍能识别未闭合人物块", () => {
    expect(parseBlocks('<narr>旁白。</narr>\n<dlg who="林晚晴">正在说')).toEqual([
      { kind: "narr", text: "旁白。", who: undefined },
      { kind: "dlg", text: "正在说", who: "林晚晴" },
    ]);
  });

  it("异常地嵌入新块时不会把人物标签后的内容吞掉", () => {
    expect(parseBlocks('<dlg who="林晚晴">人物。<narr>旁白。</narr>')).toEqual([
      { kind: "dlg", text: "人物。", who: "林晚晴" },
      { kind: "narr", text: "旁白。", who: undefined },
    ]);
  });

  it("把模型误写成标签的函数调用整段剥掉，正文不受影响", () => {
    expect(
      parseBlocks(
        '<narr>图书馆很安静。</narr>\n' +
          '<remember_character">Fuka Shikuzaki\n同班同学，缠着绷带。\n你\n图书馆</remember_character>\n' +
          '<dlg who="Fuka Shikuzaki">……你干嘛盯着我。</dlg>',
      ),
    ).toEqual([
      { kind: "narr", text: "图书馆很安静。", who: undefined },
      { kind: "dlg", text: "……你干嘛盯着我。", who: "Fuka Shikuzaki" },
    ]);
  });

  it("地点、事件、掷骰的误写标签同样剥掉，大小写和属性都兼容", () => {
    const stripped = stripPseudoToolTags(
      "前文。<REMEMBER_PLACE name=\"图书馆\">学校的图书馆</REMEMBER_PLACE>" +
        "<remember_event>翻墙</remember_event><roll_dice>1d20</roll_dice>后文。",
    );
    expect(stripped).toBe("前文。后文。");
  });

  it("没闭合的误写标签连它包着的内容一起剥，后面的真消息块留着", () => {
    expect(stripPseudoToolTags("开头。<remember_character\">Fuka\n同班同学。\n正常正文。")).toBe(
      "开头。",
    );
    expect(
      stripPseudoToolTags('<remember_character">Fuka\n同班同学。<narr>旁白。</narr>'),
    ).toBe("<narr>旁白。</narr>");
  });

  it("真正的消息块标签一个都不能被误剥", () => {
    const raw =
      '<narr>旁白。</narr><act who="林晚晴">她顿了顿。</act><dlg who="林晚晴">坐。</dlg><scene>天亮了。</scene>';
    expect(stripPseudoToolTags(raw)).toBe(raw);
    expect(parseBlocks(raw)).toHaveLength(4);
  });

  it("复杂动作不再伪装成 act，而是降级为旁白", () => {
    expect(isAtomicAct("她抬眼。")).toBe(true);
    expect(isAtomicAct("她说完就去翻书，没真翻，只是来回翻。")).toBe(false);
    expect(
      parseBlocks('<act who="Fuka">她说完就去翻书，没真翻，只是来回翻。</act>'),
    ).toEqual([{ kind: "narr", text: "她说完就去翻书，没真翻，只是来回翻。", who: undefined }]);
  });

  it("修补 diag 包住 act 的嵌套，保留动作正文", () => {
    const repaired = repairBlockStructure('<diag><act who="林晚晴">她抬眼。</act></diag>');
    expect(repaired.safe).toBe(true);
    expect(repaired.text).toBe('<act who="林晚晴">她抬眼。</act>');
    expect(parseBlocks('<diag><act who="林晚晴">她抬眼。</act></diag>')).toEqual([
      { kind: "act", who: "林晚晴", text: "她抬眼。" },
    ]);
  });

  it("修补重复 act 标签，不把内容解析为空", () => {
    const raw = '<diag><act><act/>她抬眼。</act></diag>';
    const repaired = repairBlockStructure(raw);
    expect(repaired.safe).toBe(true);
    expect(repaired.text).toBe("<act>她抬眼。</act>");
    expect(parseBlocks(raw)).toEqual([{ kind: "act", text: "她抬眼。", who: undefined }]);
  });

  it("缺少闭合标签时补齐，不吞掉后面的块", () => {
    const raw = '<narr>她抬眼。<dlg who="林晚晴">住店？</dlg>';
    expect(parseBlocks(raw)).toEqual([
      { kind: "narr", text: "她抬眼。", who: undefined },
      { kind: "dlg", who: "林晚晴", text: "住店？" },
    ]);
  });

  it("普通消息块嵌套时按平级块拆开，并吞掉已被修补替代的外层闭合", () => {
    expect(parseBlocks('<narr>外层。<dlg>住店？</dlg></narr>')).toEqual([
      { kind: "narr", text: "外层。", who: undefined },
      { kind: "dlg", text: "住店？", who: undefined },
    ]);
  });

  it("无法安全判断的落单闭合保留原文并标记不安全", () => {
    const raw = "</dlg>残文";
    const repaired = repairBlockStructure(raw);
    expect(repaired.safe).toBe(false);
    expect(repaired.text).toBe(raw);
    expect(repaired.issues.some((issue) => issue.kind === "unmatched_close")).toBe(true);
  });
});
