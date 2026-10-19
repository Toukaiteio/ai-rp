import { describe, expect, it } from "vitest";
import { resolveMessageBlocks } from "./message-macros";

describe("聊天宏展示", () => {
  const vars = { char: '林"<dlg>晚晴', user: '旅人"<narr>', card: { description: "{{char}}经营旅店。" } };

  it("已保存的普通 assistant 文本和模型流式正文使用当前姓名", () => {
    const saved = "{{CHAR}}欢迎{{USER}}。";
    expect(resolveMessageBlocks(saved, vars)).toEqual([
      { kind: "dlg", text: `${vars.char}欢迎${vars.user}。` },
    ]);
    expect(saved).toBe("{{CHAR}}欢迎{{USER}}。");
    expect(resolveMessageBlocks("<narr>{{char}}看见{{user}}", vars)[0].text).toBe(`${vars.char}看见${vars.user}`);
  });

  it("先解析块，再分别展开 who 和正文，姓名中的引号和标签不改变结构", () => {
    expect(resolveMessageBlocks('<dlg who="{{char}}">你好，{{user}}。</dlg><act who="{{user}}">点头</act>', vars)).toEqual([
      { kind: "dlg", who: vars.char, text: `你好，${vars.user}。` },
      { kind: "act", who: vars.user, text: "点头" },
    ]);
  });

  it("旧 style HTML 和玩家块正文同样展开，卡字段引用使用同一上下文", () => {
    const blocks = resolveMessageBlocks('<div style="color: red">{{char}}与{{user}}</div>', vars);
    expect(blocks[0].text).toBe(`<div style="color: red">${vars.char}与${vars.user}</div>`);
    expect(resolveMessageBlocks("<player>{{user}}</player>", vars)[0].text).toBe(vars.user);
    expect(resolveMessageBlocks("{{description}}", vars)[0].text).toBe(`${vars.char}经营旅店。`);
  });
  it("旧式名称标记在带引号的 who 属性内不会提前结束标签", () => {
    expect(resolveMessageBlocks('<dlg who="<CHAR>">Hello <USER></dlg>', vars)).toEqual([
      { kind: "dlg", who: vars.char, text: `Hello ${vars.user}` },
    ]);
  });
});
