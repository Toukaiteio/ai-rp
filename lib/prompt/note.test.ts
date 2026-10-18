import { describe, expect, it } from "vitest";
import {
  correctionNote,
  noteInsertIndex,
  resolveAuthorNote,
  selectAuthorNote,
  DEFAULT_NOTE_DEPTH,
  MAX_NOTE_CHARS,
  MAX_NOTE_DEPTH,
} from "./note";

describe("作者注：三层来源的优先级", () => {
  it("本轮临时注记压过一切，用于重新生成纠偏", () => {
    const note = resolveAuthorNote({
      temporary: "上一版替玩家行动了，这一轮别这样。",
      session: { text: "当前聊天的注记" },
      card: { text: "卡上的默认注记" },
    });
    expect(note?.text).toContain("上一版替玩家行动了");
    expect(note?.frequency).toBe(1);
  });

  it("没有临时注记时用当前聊天专属的", () => {
    const note = resolveAuthorNote({
      session: { text: "当前聊天的注记" },
      card: { text: "卡上的默认注记" },
    });
    expect(note?.text).toBe("当前聊天的注记");
  });

  it("聊天里没有就用角色卡默认的", () => {
    const note = resolveAuthorNote({ card: { text: "卡上的默认注记" } });
    expect(note?.text).toBe("卡上的默认注记");
  });

  it("三层都没有就没有作者注", () => {
    expect(resolveAuthorNote({})).toBeUndefined();
    expect(resolveAuthorNote({ temporary: "   ", session: { text: "" } })).toBeUndefined();
  });

  it("显式关掉就不往下找，不会被卡上的默认注记顶回来", () => {
    const note = resolveAuthorNote({
      session: { text: "当前聊天的注记", enabled: false },
      card: { text: "卡上的默认注记" },
    });
    expect(note).toBeUndefined();
  });

  it("空白的临时注记不算数，继续往下找", () => {
    const note = resolveAuthorNote({ temporary: "  \n ", session: { text: "聊天注记" } });
    expect(note?.text).toBe("聊天注记");
  });
});

describe("作者注：频率与深度", () => {
  it("频率 0 从不出现，1 每轮出现，N 每 N 轮出现", () => {
    const note = { text: "克制一点。", frequency: 2 };
    expect(selectAuthorNote({ ...note, frequency: 0 }, 0)).toBeUndefined();
    expect(selectAuthorNote({ text: "克制一点。" }, 3)?.text).toBe("克制一点。");
    expect(selectAuthorNote(note, 0)?.text).toBe("克制一点。");
    expect(selectAuthorNote(note, 1)).toBeUndefined();
    expect(selectAuthorNote(note, 2)?.text).toBe("克制一点。");
  });

  it("关掉的注记永远不会被选中", () => {
    expect(selectAuthorNote({ text: "克制一点。", enabled: false }, 0)).toBeUndefined();
  });

  it("深度默认 1，也就是最后一条玩家输入之前", () => {
    expect(DEFAULT_NOTE_DEPTH).toBe(1);
    expect(noteInsertIndex(10, undefined)).toBe(9);
    expect(noteInsertIndex(10, 0)).toBe(10);
    expect(noteInsertIndex(10, 1)).toBe(9);
    expect(noteInsertIndex(10, 3)).toBe(7);
  });

  it("深度超上限或为负都收进合法范围", () => {
    expect(noteInsertIndex(10, MAX_NOTE_DEPTH + 5)).toBe(10 - MAX_NOTE_DEPTH);
    expect(noteInsertIndex(10, -3)).toBe(9);
    expect(noteInsertIndex(2, 6)).toBe(0);
    expect(noteInsertIndex(0, 1)).toBe(0);
  });

  it("非法频率按每轮处理", () => {
    expect(selectAuthorNote({ text: "x", frequency: -1 }, 5)?.text).toBe("x");
    expect(selectAuthorNote({ text: "x", frequency: Number.NaN }, 5)?.text).toBe("x");
  });
});

describe("作者注：长度", () => {
  it("超长的注记会被截断，它不是第二个系统提示", () => {
    const note = resolveAuthorNote({ session: { text: "字".repeat(MAX_NOTE_CHARS + 200) } });
    expect(note?.text.length).toBe(MAX_NOTE_CHARS);
  });
});

describe("作者注：重新生成的纠偏信息", () => {
  it("把上一版的问题翻译成「这一轮别这样」", () => {
    const note = correctionNote("替玩家说话或行动：narr 里替玩家做动作：你坐下");
    expect(note).toContain("重新生成");
    expect(note).toContain("你坐下");
    expect(note).toContain("避免同样的写法");
    // 说明「其余内容照常推进」，免得模型把纠偏当成只写一句话的指令
    expect(note).toContain("照常推进");
  });

  it("没有原因就不生成注记", () => {
    expect(correctionNote("   ")).toBe("");
  });

  it("超长的原因会被截断", () => {
    const note = correctionNote("原因".repeat(300));
    expect(note.length).toBeLessThan(400);
  });

  it("纠偏注记走临时通道，独占这一轮", () => {
    const note = resolveAuthorNote({
      temporary: correctionNote("角色名不明"),
      session: { text: "常规注记" },
    });
    expect(note?.text).toContain("角色名不明");
    expect(note?.text).not.toContain("常规注记");
  });
});
