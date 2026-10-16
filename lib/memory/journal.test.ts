import { describe, expect, it } from "vitest";
import {
  applyChatTool,
  applyMemoryTool,
  emptyJournal,
  formatJournal,
  normalizeJournal,
  putPortrait,
} from "./journal";

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
    expect(second.characters["阿宁"].detail).toBe("留下了");
  });

  it("旧存档的裸字符串条目也能读出来", () => {
    const legacy = normalizeJournal({
      characters: { 阿宁: "刚下船" },
      places: {},
      events: {},
    });
    expect(legacy.characters["阿宁"].detail).toBe("刚下船");
  });

  it("条目之间能互相指：人物带地点和共事者，地点能反查出谁在这里", () => {
    let journal = emptyJournal();
    journal = applyMemoryTool(
      journal,
      "remember_place",
      JSON.stringify({ name: "南栈桥", detail: "夜里没灯" }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "在修船", where: "南栈桥", ref: ["老周"], turn: 2 }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_event",
      JSON.stringify({ name: "撞栈桥", detail: "涨潮时撞上", where: "南栈桥", ref: ["阿宁"], turn: 3 }),
    ).journal;

    expect(journal.characters["阿宁"].where).toBe("南栈桥");
    expect(journal.characters["阿宁"].ref).toEqual(["老周"]);
    expect(journal.characters["阿宁"].turn).toBe(2);

    const place = applyMemoryTool(
      journal,
      "read_memory",
      JSON.stringify({ kind: "place", name: "南栈桥" }),
    ).result;
    expect(place).toContain("此处有：阿宁、撞栈桥");

    const event = applyMemoryTool(
      journal,
      "read_memory",
      JSON.stringify({ kind: "event", name: "撞栈桥" }),
    ).result;
    expect(event).toContain("在南栈桥");
    expect(event).toContain("在场：阿宁");
  });

  it("模型没写轮次时，用当前轮次补上", () => {
    const journal = applyMemoryTool(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "刚下船" }),
      7,
    ).journal;
    expect(journal.characters["阿宁"].turn).toBe(7);
  });

  it("读一条人物时会带上它的关联与轮次", () => {
    const journal = applyMemoryTool(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "在修船", where: "南栈桥", ref: ["老周"], turn: 4 }),
    ).journal;
    const read = applyMemoryTool(
      journal,
      "read_memory",
      JSON.stringify({ kind: "character", name: "阿宁" }),
    ).result;
    expect(read).toContain("在南栈桥");
    expect(read).toContain("共事：老周");
    expect(read).toContain("第4轮");
  });

  it("能按关键词跨类搜索", () => {
    let journal = emptyJournal();
    journal = applyMemoryTool(
      journal,
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "船工" }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_place",
      JSON.stringify({ name: "南栈桥", detail: "夜里没灯" }),
    ).journal;
    expect(applyMemoryTool(journal, "search_memory", JSON.stringify({ query: "船工" })).result).toContain("阿宁");
    expect(applyMemoryTool(journal, "search_memory", JSON.stringify({ query: "没有的东西" })).result).toContain("没有");
  });

  it("忘掉一条，并清掉别人指向它的死链", () => {
    let journal = emptyJournal();
    journal = applyMemoryTool(
      journal,
      "remember_place",
      JSON.stringify({ name: "南栈桥", detail: "夜里没灯" }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "在修船", where: "南栈桥", ref: ["南栈桥"] }),
    ).journal;
    journal = applyMemoryTool(
      journal,
      "forget_memory",
      JSON.stringify({ kind: "place", name: "南栈桥" }),
    ).journal;
    expect(journal.characters["阿宁"].where).toBeUndefined();
    expect(journal.characters["阿宁"].ref ?? []).toEqual([]);
    expect(applyMemoryTool(journal, "read_memory", JSON.stringify({ kind: "place", name: "南栈桥" })).result).toContain(
      "没有",
    );
  });

  it("忘掉一条不存在的，直说不用删，也不动别的", () => {
    const journal = applyMemoryTool(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "阿宁", detail: "在修船", where: "北港" }),
    ).journal;
    const applied = applyMemoryTool(
      journal,
      "forget_memory",
      JSON.stringify({ kind: "place", name: "北港" }),
    );
    expect(applied.result).toContain("不用删");
    expect(applied.journal.characters["阿宁"].where).toBe("北港");
  });

  it("记满之后不再写入，并提示先删", () => {
    let journal = emptyJournal();
    for (let i = 0; i < 15; i += 1) {
      journal = applyMemoryTool(
        journal,
        "remember_character",
        JSON.stringify({ name: `路人${i}`, detail: "路过" }),
      ).journal;
    }
    const full = applyMemoryTool(
      journal,
      "remember_character",
      JSON.stringify({ name: "第16个", detail: "挤不进" }),
    );
    expect(full.result).toContain("记满");
    expect(Object.keys(full.journal.characters)).toHaveLength(15);
  });

  it("目录不会无限膨胀：条目堆到上限也压在预算内", () => {
    let journal = emptyJournal();
    for (let i = 0; i < 15; i += 1) {
      journal = applyMemoryTool(
        journal,
        "remember_character",
        JSON.stringify({ name: `角色${i}`, detail: "啊".repeat(180), turn: i }),
      ).journal;
      journal = applyMemoryTool(
        journal,
        "remember_place",
        JSON.stringify({ name: `地点${i}`, detail: "啊".repeat(180), turn: i }),
      ).journal;
      journal = applyMemoryTool(
        journal,
        "remember_event",
        JSON.stringify({ name: `事件${i}`, detail: "啊".repeat(180), turn: i }),
      ).journal;
    }
    const text = formatJournal(journal);
    const cjk = (text.match(/[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g) ?? []).length;
    const tokens = Math.ceil(cjk * 0.75 + (text.length - cjk) / 4);
    expect(tokens).toBeLessThanOrEqual(900);
  });

  it("头像单独存放，不进提示词，删人时一起清掉", () => {
    const src = "data:image/jpeg;base64,abc";
    const withFace = putPortrait(
      applyMemoryTool(
        emptyJournal(),
        "remember_character",
        JSON.stringify({ name: "阿宁", detail: "船工" }),
      ).journal,
      "阿宁",
      src,
    );
    expect(withFace.portraits?.["阿宁"]).toBe(src);
    expect(formatJournal(withFace)).not.toContain("data:image");
    const forgotten = applyMemoryTool(
      withFace,
      "forget_memory",
      JSON.stringify({ kind: "character", name: "阿宁" }),
    ).journal;
    expect(forgotten.portraits?.["阿宁"]).toBeUndefined();
    expect(normalizeJournal({ portraits: { 阿宁: "https://evil.example/a.png" } }).portraits).toBeUndefined();
  });

  it("掷骰不改记忆，点数落在面数里", () => {
    const journal = emptyJournal();
    const applied = applyChatTool(journal, "roll_dice", JSON.stringify({ notation: "1d6" }));
    expect(applied.journal).toBe(journal);
    expect(applied.result).toMatch(/^1d6 = [1-6]（[1-6]）$/);
    expect(applyChatTool(journal, "roll_dice", "{}").result).toContain("缺少 notation");
  });
});
