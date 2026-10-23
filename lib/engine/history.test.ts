import { describe, expect, it } from "vitest";
import { commitTurn, retryBase } from "./history";
import { resolveGeneration, validateResponseBlocks } from "./validate";
import { checkGeneration } from "./report";
import type { GenerationResult } from "./types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  id?: string;
  swipes?: string[];
}

const BASE: Turn[] = [
  { role: "assistant", content: '<narr>风铃响过。</narr><dlg who="林晚晴">住店？</dlg>', id: "opening" },
];

/** 走真实的校验 + 报告路径，保证测试和线上判定一致。 */
function gate(raw: string): GenerationResult {
  const options = { cardName: "林晚晴", userName: "你", playerInput: "我推门进来。" };
  const report = checkGeneration({ raw, ...options, now: 0 });
  return resolveGeneration(validateResponseBlocks(raw, options), { report });
}

function pending(userText: string): { user: Turn; assistant: Turn } {
  return {
    user: { role: "user", content: `<player>${userText}</player>`, id: "u1" },
    assistant: { role: "assistant", content: "", id: "a1" },
  };
}

describe("质量门：写进历史的唯一决定点", () => {
  it("合格的回复原样写进历史", () => {
    const raw = '<narr>雨小了。</narr><dlg who="林晚晴">上楼吧。</dlg>';
    const outcome = commitTurn(BASE, pending("我抖了抖伞。"), gate(raw));

    expect(outcome.written).toBe(true);
    expect(outcome.content).toBe(raw);
    expect(outcome.turns).toHaveLength(BASE.length + 2);
    expect(outcome.turns[outcome.turns.length - 1].content).toBe(raw);
  });

  it("可降级的回复写进历史的是降级后的版本，不是原文", () => {
    const raw = '<act who="林晚晴">她起身，走向门口。</act>';
    const outcome = commitTurn(BASE, pending("我看着她。"), gate(raw));

    expect(outcome.written).toBe(true);
    expect(outcome.content).toBe("<narr>她起身，走向门口。</narr>");
    // 原文里的 act 标记不能出现在历史里
    expect(outcome.turns[outcome.turns.length - 1].content).not.toContain("<act");
  });

  it("结构修补后的回复写入历史的是修补版，不是嵌套原文", () => {
    const raw = '<diag><act who="林晚晴">她抬眼。</act></diag>';
    const outcome = commitTurn(BASE, pending("我看着她。"), gate(raw));

    expect(outcome.written).toBe(true);
    expect(outcome.content).toBe('<act who="林晚晴">她抬眼。</act>');
    expect(outcome.turns.at(-1)?.content).toBe(outcome.content);
    expect(outcome.turns.at(-1)?.content).not.toContain("<diag>");
  });

  it("拒收的回复不会出现在历史里，历史原样返回", () => {
    const raw = '<dlg who="你">我先坐会儿。</dlg>';
    const outcome = commitTurn(BASE, pending("我推门进来。"), gate(raw));

    expect(outcome.written).toBe(false);
    expect(outcome.content).toBe("");
    expect(outcome.turns).toEqual(BASE);
    // 玩家的这一轮也不留下：整轮作废，重来时从头跑
    expect(outcome.turns).toHaveLength(BASE.length);
  });

  it("拒收时返回的是新数组，调用方不可能顺手改到原历史", () => {
    const outcome = commitTurn(BASE, pending("我推门进来。"), gate('<dlg who="她">住店？</dlg>'));
    expect(outcome.turns).not.toBe(BASE);
    outcome.turns.push({ role: "user", content: "污染" });
    expect(BASE).toHaveLength(1);
  });

  it("重跑用的是拒收前那段历史，不是画面上那半条错误回复", () => {
    const rejected = { baseTurns: BASE };
    const base = retryBase(rejected);
    expect(base).toEqual(BASE);

    // 第二次生成合格，历史里只有新的一轮，没有第一次的错误内容
    const good = '<narr>雨小了。</narr><dlg who="林晚晴">上楼吧。</dlg>';
    const outcome = commitTurn(base, pending("我推门进来。"), gate(good));
    expect(outcome.turns).toHaveLength(BASE.length + 2);
    expect(JSON.stringify(outcome.turns)).not.toContain("我先坐会儿");
  });

  it("多轮之后历史里始终没有硬错误内容", () => {
    let turns: Turn[] = [...BASE];
    const script = [
      { raw: '<narr>她把灯推过来。</narr>', ok: true },
      { raw: '<dlg who="你">我住下。</dlg>', ok: false },
      { raw: '<act who="林晚晴">她抬眼，又低下去。</act>', ok: true },
      { raw: '<player>我坐下。</player>', ok: false },
      { raw: '<dlg who="林晚晴">二楼左转。</dlg>', ok: true },
    ];

    for (const step of script) {
      const outcome = commitTurn(turns, pending("我说了一句。"), gate(step.raw));
      expect(outcome.written).toBe(step.ok);
      turns = outcome.turns;
    }

    // 玩家的 <player> 标记是存储格式的一部分（导出要靠它区分），这里只看模型写的东西
    const assistantText = turns
      .filter((turn) => turn.role === "assistant")
      .map((turn) => turn.content)
      .join("\n");
    expect(assistantText).not.toContain("<player>");
    expect(assistantText).not.toContain('who="你"');
    // 合格与降级的两轮都在
    expect(assistantText).toContain("她把灯推过来");
    expect(assistantText).toContain("二楼左转");
    // 降级那一轮写的是 narr
    expect(assistantText).toContain("<narr>她抬眼，又低下去。</narr>");
  });
});
