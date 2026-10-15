import { describe, expect, it } from "vitest";
import { applyChatTool, applyMemoryTool, emptyJournal, formatJournal } from "./journal";

describe("本机记忆工具", () => {
  it("写入人物、地点和事件后能列出来", () => {
    let journal = emptyJournal();
    journal = applyMemoryTool(
      journal,
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "刚下船" }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_place",
      JSON.stringify({ name: "南栈桥", detail: "夜里没灯" }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_event",
      JSON.stringify({ name: "第一次靠岸", detail: "船在涨潮时撞上栈桥" }),
    ).journal;

    const listed = applyMemoryTool(journal, "list_memory", "{}").result;
    expect(listed).toContain("阿宁");
    expect(listed).toContain("南栈桥");
    expect(listed).toContain("第一次靠岸");
    expect(formatJournal(journal)).toContain("本机记忆目录");
  });

  it("能按名字读一条，没有的会直说", () => {
    const journal = applyMemoryTool(
      emptyJournal(),
      "remember_place",
      JSON.stringify({ name: "南栈桥", detail: "夜里没灯" }),
    ).journal;
    expect(applyMemoryTool(journal, "read_memory", JSON.stringify({ kind: "place", name: "南栈桥" })).result).toContain(
      "夜里没灯",
    );
    expect(applyMemoryTool(journal, "read_memory", JSON.stringify({ kind: "place", name: "北港" })).result).toContain(
      "没有",
    );
  });

  it("同名再写是更新，不是再添一条", () => {
    const first = applyMemoryTool(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "刚下船" }),
    ).journal;
    const second = applyMemoryTool(
      first,
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "留下了" }),
    ).journal;
    expect(Object.keys(second.characters)).toEqual(["阿宁"]);
    expect(second.characters["阿宁"]).toBe("留下了");
  });

  it("掷骰不改记忆，点数落在面数里", () => {
    const journal = emptyJournal();
    const applied = applyChatTool(journal, "roll_dice", JSON.stringify({ notation: "1d6" }));
    expect(applied.journal).toBe(journal);
    expect(applied.result).toMatch(/^1d6 = [1-6]（[1-6]）$/);
    expect(applyChatTool(journal, "roll_dice", "{}").result).toContain("缺少 notation");
  });
});
