import { describe, expect, it } from "vitest";
import {
  buildDirectorMessages,
  formatTurnPlan,
  parseTurnPlan,
  type TurnPlan,
} from "./turn-plan";
import { dialogueLanguageInstruction } from "./language";

describe("导演计划", () => {
  it("把聊天记录包装成固定的 system + user 消息", () => {
    const history = [
      { role: "user" as const, content: "我推开门。" },
      { role: "assistant" as const, content: "<narr>门后很安静。</narr>" },
    ];
    const result = buildDirectorMessages(history, { instruction: "节奏紧凑。" });

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("toolCalls");
    expect(result[1]).toEqual({
      role: "user",
      content: `节奏紧凑。\n\n聊天记录（JSON）：\n${JSON.stringify(history)}`,
    });
  });

  it("解析 JSON 和 json 代码围栏", () => {
    const plan: TurnPlan = {
      beats: [
        { kind: "narr", text: "雨声突然变大。" },
        { kind: "dlg", who: "林晚晴", text: "先别进去。" },
      ],
      toolCalls: [{ name: "roll_dice", arguments: { expression: "1d20" } }],
    };

    const fenced = "```json\n" + JSON.stringify(plan) + "\n```";
    expect(parseTurnPlan(fenced)).toEqual(plan);
    expect(formatTurnPlan(plan)).toContain("不要逐字照抄");
  });

  it("拒绝坏 JSON、缺字段和不合法的 beat/tool call", () => {
    expect(parseTurnPlan("不是 JSON")).toBeNull();
    expect(parseTurnPlan('{"beats":[],"toolCalls":[]}')).toBeNull();
    expect(parseTurnPlan('{"beats":[{"kind":"narr","text":"好"}]}')).toBeNull();
    expect(
      parseTurnPlan(
        '{"beats":[{"kind":"unknown","text":"好"}],"toolCalls":[]}',
      ),
    ).toBeNull();
    expect(
      parseTurnPlan(
        '{"beats":[{"kind":"narr","text":"好"}],"toolCalls":[{"name":"x","arguments":[]}]}',
      ),
    ).toBeNull();
  });

  it("锁定玩家最近输入的对白语言", () => {
    expect(
      dialogueLanguageInstruction([
        { role: "assistant", content: "前一轮。" },
        { role: "user", content: "可以" },
      ]),
    ).toContain("简体中文");
    expect(
      dialogueLanguageInstruction([{ role: "user", content: "よかった" }]),
    ).toContain("日语");
  });
});
