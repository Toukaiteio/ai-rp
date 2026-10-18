import { describe, expect, it } from "vitest";
import { applyMemoryWrite, emptyJournal } from "./journal";

/**
 * 长期记忆的写入守门。
 *
 * 这是 7.3 落到真实链路上的那一层：模型通过函数调用记东西时，
 * 同一个名字已有记录、内容却不一样，旧记录必须留住。
 * 前面的 rules.test.ts 测的是规则本身，这里测的是它真的接在工具调用上。
 */
describe("记忆写入守门：函数调用链路", () => {
  it("第一次记一个新人物，正常写入", () => {
    const result = applyMemoryWrite(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "同班同学，左手缠着绷带" }),
      1,
    );
    expect(result.conflict).toBeUndefined();
    expect(result.journal.characters["深月风花"].detail).toBe("同班同学，左手缠着绷带");
    expect(result.result).toContain("已记下");
  });

  it("同名再写同样的内容，当作更新，不算冲突", () => {
    const first = applyMemoryWrite(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "同班同学" }),
      1,
    );
    const second = applyMemoryWrite(
      first.journal,
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "同班同学" }),
      2,
    );
    expect(second.conflict).toBeUndefined();
    expect(second.result).toContain("已更新");
  });

  it("同名却改了内容：保留旧记录，返回冲突", () => {
    const first = applyMemoryWrite(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "她说是烫伤" }),
      3,
    );
    const second = applyMemoryWrite(
      first.journal,
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "其实是刀伤" }),
      9,
    );

    // 旧记录一个字都没动
    expect(second.journal.characters["深月风花"].detail).toBe("她说是烫伤");
    expect(second.conflict).toMatchObject({
      key: "深月风花",
      kept: "她说是烫伤",
      proposed: "其实是刀伤",
      turn: 9,
      layer: "character",
    });
    // 回给模型的话里明确说「旧的留着」
    expect(second.result).toContain("保留原来的记录");
    expect(second.result).toContain("不要重复尝试覆盖");
  });

  it("地点和事件走同一套守门", () => {
    const place = applyMemoryWrite(
      emptyJournal(),
      "remember_place",
      JSON.stringify({ name: "晚星旅店", detail: "一楼酒堂" }),
      1,
    );
    const placeAgain = applyMemoryWrite(
      place.journal,
      "remember_place",
      JSON.stringify({ name: "晚星旅店", detail: "其实在码头边上" }),
      2,
    );
    expect(placeAgain.conflict?.layer).toBe("world");
    expect(placeAgain.journal.places["晚星旅店"].detail).toBe("一楼酒堂");

    const event = applyMemoryWrite(
      emptyJournal(),
      "remember_event",
      JSON.stringify({ name: "雨夜来客", detail: "玩家住了一晚" }),
      1,
    );
    const eventAgain = applyMemoryWrite(
      event.journal,
      "remember_event",
      JSON.stringify({ name: "雨夜来客", detail: "玩家其实没住" }),
      2,
    );
    expect(eventAgain.conflict?.layer).toBe("plot");
    expect(eventAgain.journal.events["雨夜来客"].detail).toBe("玩家住了一晚");
  });

  it("换一条不同的名字不受影响，各记各的", () => {
    const first = applyMemoryWrite(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "绷带" }),
      1,
    );
    const second = applyMemoryWrite(
      first.journal,
      "remember_character",
      JSON.stringify({ name: "林晚晴", detail: "旅店老板娘" }),
      2,
    );
    expect(second.conflict).toBeUndefined();
    expect(Object.keys(second.journal.characters).sort()).toEqual(["林晚晴", "深月风花"]);
  });

  it("记忆类之外的工具（比如 list_memory）不走守门，照常执行", () => {
    const journal = applyMemoryWrite(
      emptyJournal(),
      "remember_character",
      JSON.stringify({ name: "深月风花", detail: "绷带" }),
      1,
    ).journal;
    const listed = applyMemoryWrite(journal, "list_memory", "{}", 2);
    expect(listed.conflict).toBeUndefined();
    expect(listed.result).toContain("深月风花");
  });
});
