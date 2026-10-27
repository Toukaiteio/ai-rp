import { describe, expect, it } from "vitest";
import { assemble, BASE_RULES, estimateTokens, PER_MESSAGE_OVERHEAD, type AssembleInput } from "@/lib/prompt";

function input(): AssembleInput {
  return {
    card: {
      name: "林晚晴", description: "{{char}}认识{{user}}。", personality: "{{description}}",
      scenario: "{{char}}的旅店", mes_example: "<START>\n{{char}}: 欢迎{{user}}",
      system_prompt: "{{original}}\n额外：{{description}}", post_history_instructions: "{{char}}记住{{user}}。{{original}}",
      voice: { sentenceLength: "short", directness: "direct", emotionalExpression: "restrained", vocabulary: ["{{user}}呀"], habits: [], avoidances: [], sampleLines: [] },
    },
    userName: "旅人", history: [{ role: "assistant", content: '<dlg who="{{char}}">{{user}}回来了。</dlg>' }, { role: "user", content: "<player>寻找{{char}}</player>" }],
    authorNote: { text: "{{char}}称呼{{user}}。" },
    lorebooks: { card: { entries: [{ keys: ["{{char}}"], content: "{{char}}等候{{user}}。", position: "in_chat" }] } },
    seed: 7, budget: 100_000,
  };
}

describe("assemble 宏真实链路", () => {
  it("卡字段、作者注和历史共享上下文，original 只在卡 system 上使用默认核心规则", () => {
    const source = input();
    const snapshot = structuredClone(source);
    const result = assemble(source);
    const flat = result.messages.map((message) => message.content).join("\n");
    expect(result.messages[0].content.startsWith(`${BASE_RULES}\n额外：林晚晴认识旅人。`)).toBe(true);
    expect(result.messages[0].content).toContain("角色名：林晚晴");
    expect(result.messages[0].content).toContain("性格：林晚晴认识旅人。");
    expect(flat).toContain("林晚晴称呼旅人。");
    expect(flat).toContain("旅人呀");
    expect(flat).toContain('<dlg who="林晚晴">旅人回来了。</dlg>');
    expect(result.messages).toContainEqual({ role: "user", content: "寻找林晚晴" });
    expect(flat).toContain("林晚晴记住旅人。{{original}}");
    expect(source).toEqual(snapshot);
  });

  it("世界书先展开 keys/content 再匹配和计预算，单书和三来源一致", () => {
    const source = input();
    const first = assemble(source);
    const second = assemble({ ...source, lorebooks: undefined, lorebook: source.lorebooks!.card });
    for (const result of [first, second]) {
      expect(result.messages).toContainEqual({ role: "system", content: "林晚晴等候旅人。" });
      expect(result.budget.blocks.lorebook).toBe(estimateTokens("林晚晴等候旅人。") + PER_MESSAGE_OVERHEAD);
      expect(result.budget.lorebookEntries).toBe(1);
    }
  });

  it("不展开默认核心规则里的示例宏", () => {
    const source = input();
    source.card.system_prompt = "";
    expect(assemble(source).messages[0].content.startsWith(BASE_RULES)).toBe(true);
  });
});
