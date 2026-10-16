import { describe, expect, it } from "vitest";
import { blocksToRaw, dialogueContinues, parseBlocks } from "./blocks";

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
});
