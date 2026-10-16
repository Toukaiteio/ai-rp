import { describe, expect, it } from "vitest";
import { parseBlocks } from "./blocks";

describe("消息块解析", () => {
  it("拆分旁白和人物发言，并提取人物名", () => {
    expect(
      parseBlocks('<narr>旁白。</narr>\n<dlg who="林晚晴">坐。</dlg>'),
    ).toEqual([
      { kind: "narr", text: "旁白。", who: undefined },
      { kind: "dlg", text: "坐。", who: "林晚晴" },
    ]);
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
