import { describe, expect, it } from "vitest";
import {
  buildDirectorMessages,
  DIRECTOR_SYSTEM_PROMPT,
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

  it("把剧情系统开关和安静回合提示交给导演", () => {
    const result = buildDirectorMessages([{ role: "user", content: "我继续等。" }], {
      eventsEnabled: true,
      goalsEnabled: false,
      stagnantTurns: 4,
      eventAfterTurns: 4,
    });
    expect(result[1].content).toContain("当前已连续 4 轮没有实质推进");
    expect(result[1].content).toContain("目标系统已关闭");
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
    expect(formatTurnPlan(plan)).toContain("不是需要逐项执行的脚本");
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

  it("解析导演给的本轮模式", () => {
    const plan = parseTurnPlan(
      '{"beats":[{"kind":"narr","text":"雨声变大。"}],"toolCalls":[],"mode":"short"}',
    );
    expect(plan?.mode).toBe("short");
  });

  it("mode 不认识时只丢掉 mode，不丢整份计划", () => {
    const plan = parseTurnPlan(
      '{"beats":[{"kind":"narr","text":"雨声变大。"}],"toolCalls":[],"mode":"dramatic"}',
    );
    expect(plan).not.toBeNull();
    expect(plan?.beats).toHaveLength(1);
    expect(plan?.mode).toBeUndefined();
  });

  it("导演没给 mode 时也能解析，交给调用方按玩家输入推断", () => {
    const plan = parseTurnPlan('{"beats":[{"kind":"narr","text":"雨声变大。"}],"toolCalls":[]}');
    expect(plan?.mode).toBeUndefined();
  });

  it("解析导演顺带给出的状态变化", () => {
    const plan = parseTurnPlan(
      JSON.stringify({
        beats: [{ kind: "narr", text: "她翻了一页。" }],
        toolCalls: [],
        statePatch: {
          location: "图书馆",
          currentAction: "深月风花正在翻书",
          emotionalTone: "回避",
          status: { location: "confirmed", emotionalTone: "inferred" },
        },
      }),
    );
    expect(plan?.statePatch).toEqual({
      location: "图书馆",
      currentAction: "深月风花正在翻书",
      emotionalTone: "回避",
      status: { location: "confirmed", emotionalTone: "inferred" },
    });
  });

  it("statePatch 里的坏字段被丢掉，不影响计划本身", () => {
    const plan = parseTurnPlan(
      JSON.stringify({
        beats: [{ kind: "narr", text: "她翻了一页。" }],
        toolCalls: [],
        statePatch: { location: 42, nonsense: "x" },
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan?.statePatch).toBeUndefined();
  });

  it("没有状态变化时 statePatch 为空，计划照常可用", () => {
    const plan = parseTurnPlan(
      '{"beats":[{"kind":"narr","text":"雨声变大。"}],"toolCalls":[],"statePatch":{}}',
    );
    expect(plan?.statePatch).toBeUndefined();
    expect(plan?.beats).toHaveLength(1);
  });

  it("导演提示里写清了三档可信度，并强调宁可标 inferred", () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("statePatch");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("confirmed");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("inferred");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("uncertain");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("宁可标 inferred");
  });

  it("计划里带 mode 时，交给正文模型的那段会说明以回合层为准", () => {
    const withMode = formatTurnPlan({
      beats: [{ kind: "narr", text: "雨声变大。" }],
      toolCalls: [],
      mode: "scene",
    });
    expect(withMode).toContain("以回合层里那条「本轮模式」为准");
    const withoutMode = formatTurnPlan({ beats: [{ kind: "narr", text: "雨声变大。" }], toolCalls: [] });
    expect(withoutMode).not.toContain("本轮模式");
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
