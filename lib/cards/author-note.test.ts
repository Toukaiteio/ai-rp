import { describe, expect, it } from "vitest";
import { parseCharacterCard, serializeCard } from "./validate";
import type { CharacterCard } from "./types";

/** 解析成功才继续，失败时把错误信息带进断言。 */
function cardOf(raw: unknown): CharacterCard {
  const parsed = parseCharacterCard(raw);
  if (!parsed.ok) throw new Error(`卡解析失败：${parsed.error}`);
  return parsed.card;
}

/**
 * 角色卡上的默认作者注。
 *
 * 它是 Phase 4 新增的字段，跟着卡走：导出再导入必须还在，
 * 否则玩家精心写的「这一轮怎么写」会在换设备之后消失。
 */
describe("角色卡的默认作者注", () => {
  const base = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "林晚晴",
      description: "旅店老板娘。",
      personality: "嘴上赶人。",
      scenario: "雨夜。",
      first_mes: "<narr>风铃响过。</narr>",
    },
  };

  it("解析出 author_note", () => {
    const card = cardOf({
      ...base,
      data: { ...base.data, author_note: "本轮保持克制。act 只保留一个可见动作。" },
    });
    expect(card.data.author_note).toBe("本轮保持克制。act 只保留一个可见动作。");
  });

  it("没有这个字段时是空串，不是 undefined", () => {
    expect(cardOf(base).data.author_note).toBe("");
  });

  it("导出再导入，作者注原样还在", () => {
    const note = "只写角色对玩家刚才那句话的直接反应。\n不要推进新的剧情线。";
    const card = cardOf({ ...base, data: { ...base.data, author_note: note } });
    const again = cardOf(JSON.parse(serializeCard(card)));
    expect(again.data.author_note).toBe(note);
  });

  it("它不会被当成未知字段丢进 _unmapped", () => {
    const card = cardOf({ ...base, data: { ...base.data, author_note: "克制一点。" } });
    const unmapped = card.data.extensions?._unmapped;
    expect(JSON.stringify(unmapped ?? {})).not.toContain("author_note");
  });
});
