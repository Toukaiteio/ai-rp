import { describe, expect, it } from "vitest";
import {
  appendSummary,
  applySummary,
  assemble,
  cacheStatsFor,
  emptyKeyFacts,
  emptySummary,
  estimateMessages,
  mergeFacts,
  needsSummarize,
  parseFactsPayload,
  planBudget,
  resetCacheStats,
  rollDice,
  type AssembleInput,
  type ChatMessage,
  type KeyFacts,
} from "@/lib/prompt";

const card: AssembleInput["card"] = {
  name: "林晚晴",
  description: "晚星旅店老板娘，三年前玩家欠下饭钱。",
  personality: "嘴上赶人，手上添茶。",
  scenario: "深秋雨夜，一楼酒堂。",
};

function run(extra: Partial<AssembleInput> = {}) {
  return assemble({
    card,
    history: [{ role: "assistant", content: "<narr>雨还在下。</narr>" }],
    seed: 7,
    budget: 100_000,
    ...extra,
  });
}

function linesOf(messages: ChatMessage[]): string[] {
  return messages.map((message) => message.content);
}

function indexOf(lines: string[], snippet: string): number {
  return lines.findIndex((line) => line.includes(snippet));
}

describe("预算公式", () => {
  it("可用预算是 maxContext - responseTokens - 3", () => {
    expect(planBudget(16_000)).toBe(16_000 - 1024 - 3);
    expect(planBudget(100, 90)).toBe(7);
    expect(planBudget(10, 90)).toBe(0);
  });
});

describe("组装顺序与字节稳定", () => {
  it("角色卡 system_prompt 覆盖默认核心规则，但保留输出协议", () => {
    const result = run({
      card: { ...card, system_prompt: "自定义核心规则：{{char}}只用冷淡短句称呼{{user}}。" },
    });
    const flat = linesOf(result.messages).join("\n");
    expect(flat).toContain("自定义核心规则：林晚晴只用冷淡短句称呼你。");
    expect(flat).not.toContain("你是这个故事的讲述者");
    expect(flat).toContain("每轮只输出下面这几种块");
  });

  it("段落顺序固定，同样输入两次字节级一致", () => {
    const input: Partial<AssembleInput> = {
      style: "haruhi",
      persona: "过路的客人",
      summary: { text: "玩家回来了。", coveredIndex: 1, compressedCount: 1 },
      facts: {
        characters: { 林晚晴: "在添柴" },
        places: { 晚星旅店: "一楼" },
        flags: { 已欠账: true },
      },
      authorNote: { text: "雨声不要停。" },
      lorebook: {
        entries: [
          { keys: [], content: "常驻：油灯还亮着。", constant: true, position: "before_char" },
          { keys: ["酒堂"], content: "场景书：六张方桌。", position: "after_scene" },
        ],
      },
      history: [
        { role: "assistant", content: "<narr>雨还在下。</narr>" },
        { role: "user", content: "<player>酒堂还有人吗</player>" },
      ],
    };

    const first = run(input);
    const second = run(input);
    expect(JSON.stringify(first.messages)).toBe(JSON.stringify(second.messages));
    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.mode).toBe(second.mode);

    const lines = linesOf(first.messages);
    const at = (snippet: string) => {
      const index = indexOf(lines, snippet);
      expect(index, snippet).toBeGreaterThanOrEqual(0);
      return index;
    };

    // 稳定层：规则 → 世界书 → 角色卡 → 玩家设定 → 场景 → 风格 → 事实 → 摘要
    expect(at("不要替玩家说话")).toBeLessThan(at("常驻：油灯还亮着。"));
    expect(at("常驻：油灯还亮着。")).toBeLessThan(at("角色名：林晚晴"));
    expect(at("角色名：林晚晴")).toBeLessThan(at("玩家设定"));
    expect(at("玩家设定")).toBeLessThan(at("当前场景：深秋雨夜，一楼酒堂。"));
    expect(at("当前场景：深秋雨夜，一楼酒堂。")).toBeLessThan(at("文风"));
    expect(at("文风")).toBeLessThan(at("已确认的事实"));
    expect(at("已确认的事实")).toBeLessThan(at("之前的剧情"));

    // 回合层：历史之后。整层是一条消息，内部顺序按字符串位置断言。
    expect(at("之前的剧情")).toBeLessThan(at("酒堂还有人吗"));
    expect(at("酒堂还有人吗")).toBeLessThan(at("本轮状态"));

    const turn = lines.find((line) => line.includes("本轮状态"));
    expect(turn).toBeTruthy();
    const within = (snippet: string) => {
      const index = (turn as string).indexOf(snippet);
      expect(index, snippet).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(within("对白语言锁定")).toBeLessThan(within("本轮状态"));
    expect(within("本轮状态")).toBeLessThan(within("本轮模式"));
    expect(within("本轮模式")).toBeLessThan(within("这一轮请按下面的要求写"));

    // 作者注插在历史里、最后一条玩家输入之前：比回合层更靠近玩家那句话
    expect(at("雨声不要停。")).toBe(at("酒堂还有人吗") - 1);
    expect(lines[at("雨声不要停。") + 1]).toContain("酒堂还有人吗");
    expect(at("雨声不要停。")).toBeLessThan(at("本轮状态"));

    // 关键词世界书排在回合层之前，回合层保持「离生成最近」
    expect(at("场景书：六张方桌。")).toBeLessThan(at("本轮状态"));

    const flat = lines.join("\n");
    expect(flat).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(flat).not.toContain("Math.random");
    expect(flat).not.toContain("<player>");
    expect(flat).toContain("嘴上赶人，手上添茶。");
    expect(flat).toContain("欠下饭钱");
    expect(flat).toContain("角色先是处在这个当下的人");
    expect(flat).toContain("act 必须白描");
    expect(flat).toContain("禁止使用任何比喻、拟人、象征、排比、对仗、夸张或诗意形容");
    expect(flat).toContain("act 只能写当下能被旁观者直接看见的一个动作");
    expect(flat).not.toContain("最多不超过");
  });

  it("act 约束和正向示例在回合层再出现一次", () => {
    const lines = linesOf(run().messages);
    const turnAt = indexOf(lines, "这一轮请按下面的要求写");
    expect(turnAt).toBeGreaterThanOrEqual(0);

    const turnLayer = lines[turnAt];
    // 只重复最容易走形的两条，不把整份协议抄一遍
    expect(turnLayer).toContain("act 只写一个旁观者能直接看见的动作");
    expect(turnLayer).toContain("不替玩家说话");
    // 正向示例：少量合法样例
    expect(turnLayer).toContain('<act who="角色名">她抬眼。</act>');
    expect(turnLayer).toContain('<act who="角色名">她把杯子放下。</act>');
    expect(turnLayer).toContain('<act who="角色名">她的手指停住。</act>');
    expect(turnLayer).toContain("<narr>她看了一眼门口，没有马上接话。</narr>");
    expect(turnLayer).toContain('<dlg who="角色名">你刚才说什么？</dlg>');
    // 不堆错误示例
    expect(turnLayer).not.toContain("反例");
    expect(turnLayer).not.toContain("错误示例");
  });

  it("关键词世界书进进出出，不改前缀指纹", () => {
    const lorebook = {
      entries: [
        { keys: [] as string[], content: "常驻油灯。", constant: true },
        { keys: ["姜茶"], content: "灶上温着姜茶。", constant: false },
      ],
    };
    const withHit = run({
      lorebook,
      history: [{ role: "user", content: "来杯姜茶" }],
    });
    const withoutHit = run({
      lorebook,
      history: [{ role: "user", content: "只是坐一会儿" }],
    });
    expect(withHit.cacheKey).toBe(withoutHit.cacheKey);
    expect(withHit.messages.map((m) => m.content).join("\n")).toContain("灶上温着姜茶。");
    expect(withoutHit.messages.map((m) => m.content).join("\n")).not.toContain("灶上温着姜茶。");
  });

  it("把对话示例限定为语言参考，而不是要照抄的剧情", () => {
    const result = run({
      card: { ...card, mes_example: "<START>林晚晴：少来这套。" },
    });
    const example = result.messages.find((message) => message.content.includes("少来这套"));
    expect(example?.content).toContain("角色语言参考");
    expect(example?.content).toContain("不照抄事件或句子");
  });

  it("改卡改变 cacheKey，概率未参与时 seed 不改变 cacheKey", () => {
    const base = run();
    const changed = run({ card: { ...card, description: `${card.description}改了一点。` } });
    expect(changed.cacheKey).not.toBe(base.cacheKey);
    expect(run({ seed: 999 }).cacheKey).toBe(base.cacheKey);
  });
});

describe("历史预算", () => {
  const history: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `独特句子${index}号${"字".repeat(40)}`,
  }));

  it("预算不够时先丢中间，系统规则和角色卡留下", () => {
    const loose = run({ history });
    const headTail = estimateMessages([history[0], history[18], history[19]]);
    const tight = run({
      history,
      budget: loose.budget.blocks.prefix + loose.budget.blocks.post + headTail,
    });

    expect(tight.budget.dropped).toBeGreaterThan(0);
    const text = linesOf(tight.messages).join("\n");
    expect(text).toContain("不要替玩家说话");
    expect(text).toContain("角色名：林晚晴");
    expect(text).toContain("独特句子0号");
    expect(text).toContain("独特句子19号");
    expect(text).not.toContain("独特句子10号");
  });

  it("预算小到装不下历史时，前缀仍在，历史整段丢掉", () => {
    const tiny = run({ history, budget: 30 });
    expect(tiny.messages[0]?.content).toContain("不要替玩家说话");
    expect(linesOf(tiny.messages).join("\n")).toContain("角色名：林晚晴");
    expect(tiny.budget.dropped).toBe(history.length);
    expect(tiny.messages.some((message) => message.role === "user")).toBe(false);
  });
});

describe("世界书", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "很久以前提到过渔村。" },
    { role: "assistant", content: "她没接话。" },
    { role: "user", content: "今晚只想喝姜茶。" },
  ];

  function matched(extra: Partial<AssembleInput>) {
    return linesOf(run({ history, ...extra }).messages);
  }

  it("常驻条目无关键词也注入，选择性条目默认中一个词即可", () => {
    const lines = matched({
      lorebook: {
        entries: [
          { keys: [], content: "常驻油灯。", constant: true },
          { keys: ["姜茶", "热酒"], content: "灶上温着姜茶。", position: "after_char" },
          { keys: ["渔村", "北方"], content: "渔村的事她不讲。", logic: "and" },
        ],
      },
    });
    const flat = lines.join("\n");
    expect(flat).toContain("常驻油灯。");
    expect(flat).toContain("灶上温着姜茶。");
    expect(flat).not.toContain("渔村的事她不讲。");
    expect(lines.find((line) => line.includes("灶上温着姜茶。"))).not.toContain("姜茶、热酒");
  });

  it("and 要全中，or 中一个就行，order 小的在前", () => {
    const lines = matched({
      history: [{ role: "user", content: "北方的渔村" }],
      lorebook: {
        entries: [
          { keys: ["北方", "渔村"], content: "两条都中了。", logic: "and", order: 2 },
          { keys: ["北方"], content: "只中北方。", logic: "or", order: 1 },
        ],
      },
    });
    expect(indexOf(lines, "只中北方。")).toBeGreaterThanOrEqual(0);
    expect(indexOf(lines, "只中北方。")).toBeLessThan(indexOf(lines, "两条都中了。"));
  });

  it("位置决定插在哪一段", () => {
    const lines = matched({
      lorebook: {
        entries: [
          { keys: [], content: "卡前。", constant: true, position: "before_char" },
          { keys: [], content: "聊天里。", constant: true, position: "in_chat" },
        ],
      },
    });
    expect(indexOf(lines, "卡前。")).toBeLessThan(indexOf(lines, "角色名："));
    expect(indexOf(lines, "今晚只想喝姜茶。")).toBeLessThan(indexOf(lines, "聊天里。"));
  });

  it("scanDepth 只看最近几条，0 不看历史", () => {
    const lorebook = {
      entries: [{ keys: ["渔村"], content: "旧事。", scanDepth: 1 }],
    };
    expect(matched({ lorebook }).join("\n")).not.toContain("旧事。");
    expect(
      matched({ lorebook: { entries: [{ keys: ["渔村"], content: "旧事。", scanDepth: 3 }] } }).join(
        "\n",
      ),
    ).toContain("旧事。");
    expect(
      matched({ lorebook: { entries: [{ keys: ["渔村"], content: "旧事。", scanDepth: 0 }] } }).join(
        "\n",
      ),
    ).not.toContain("旧事。");
  });

  it("概率用 seed 复现，0 永不注入，100 必定注入", () => {
    const entry = { keys: ["姜茶"], content: "也许倒茶。", probability: 0 };
    expect(matched({ lorebook: { entries: [entry] } }).join("\n")).not.toContain("也许倒茶。");
    expect(
      matched({ lorebook: { entries: [{ ...entry, probability: 100 }] } }).join("\n"),
    ).toContain("也许倒茶。");

    expect(rollDice(7, "也许倒茶。", 0)).toBe(false);
    expect(rollDice(7, "也许倒茶。", 100)).toBe(true);
    expect(rollDice(7, "也许倒茶。", 40)).toBe(rollDice(7, "也许倒茶。", 40));
  });

  it("递归只向前：先收下的内容可以触发后面的条目", () => {
    const entries = [
      { keys: ["姜茶"], content: "柜台上有一本暗账。", order: 1 },
      { keys: ["暗账"], content: "暗账最后一页有个名字。", order: 2 },
    ];
    expect(matched({ lorebook: { entries, recursiveScan: false } }).join("\n")).not.toContain(
      "暗账最后一页",
    );
    expect(matched({ lorebook: { entries, recursiveScan: true } }).join("\n")).toContain(
      "暗账最后一页有个名字。",
    );
  });

  it("条数和 token 预算都封顶，超长的跳过而不是把后面的一起丢掉", () => {
    const entries = [
      { keys: [], content: "常驻短句。", constant: true, order: 1 },
      { keys: [], content: "选择性短句。", constant: true, order: 2 },
    ];
    const capped = run({
      lorebook: { entries, budgetCap: 1 },
    });
    expect(capped.budget.lorebookEntries).toBe(1);
    expect(linesOf(capped.messages).join("\n")).toContain("常驻短句。");
    expect(linesOf(capped.messages).join("\n")).not.toContain("选择性短句。");

    const huge = "长".repeat(400);
    const byToken = run({
      lorebook: {
        tokenCap: 30,
        entries: [
          { keys: [], content: huge, constant: true, order: 1 },
          { keys: [], content: "短的留下。", constant: true, order: 2 },
        ],
      },
    });
    const text = linesOf(byToken.messages).join("\n");
    expect(text).not.toContain(huge);
    expect(text).toContain("短的留下。");
  });
});

describe("回合层", () => {
  it("当前场景默认用角色卡的 scenario，传了就用传的", () => {
    expect(linesOf(run().messages).join("\n")).toContain("当前场景：深秋雨夜，一楼酒堂。");
    expect(
      linesOf(run({ scene: "第二天清晨，酒堂刚开门。" }).messages).join("\n"),
    ).toContain("当前场景：第二天清晨，酒堂刚开门。");
  });

  it("剧情线从关键事实里挑出还没收尾的事", () => {
    const messages = run({
      facts: {
        characters: {},
        places: {},
        flags: {
          失窃的卷宗: true,
          追查泥脚印: "刚问过沈砚",
          雨夜来客: "已完成",
        },
      },
    }).messages;
    // 只看回合层：关键事实那一段照旧会列出全部 flags，剧情线只挑没收尾的
    const turn = messages.map((message) => message.content).find((text) => text.includes("本轮状态")) ?? "";

    expect(turn).toContain("未完成的剧情线");
    expect(turn).toContain("失窃的卷宗");
    expect(turn).toContain("追查泥脚印（刚问过沈砚）");
    // 收尾的不再占注意力
    expect(turn).not.toContain("雨夜来客");
  });

  it("剧情线最多四条，不把回合层撑爆", () => {
    const flags: Record<string, boolean> = {};
    for (let i = 0; i < 8; i += 1) flags[`线索${i}`] = true;
    const turn =
      linesOf(run({ facts: { characters: {}, places: {}, flags } }).messages).find((text) =>
        text.includes("本轮状态"),
      ) ?? "";
    expect(turn).toContain("线索0");
    expect(turn).not.toContain("线索5");
  });

  it("没有剧情线时不写这一行，也不注入字数要求", () => {
    const lines = linesOf(run().messages).join("\n");
    expect(lines).not.toContain("未完成的剧情线");
    expect(lines).not.toContain("本轮目标篇幅");
  });

  it("模式按玩家输入推断，也可以在调用时指定", () => {
    expect(run({ history: [{ role: "user", content: "继续" }] }).mode).toBe("continue");
    expect(run({ history: [{ role: "user", content: "哦" }] }).mode).toBe("short");
    expect(run({ history: [{ role: "user", content: "你昨晚去哪儿了？" }] }).mode).toBe("dialogue");
    expect(run({ mode: "scene" }).mode).toBe("scene");
    expect(linesOf(run({ mode: "scene" }).messages).join("\n")).toContain("场景推进");
  });

  it("回合层的模式不进入前缀，不改变缓存指纹", () => {
    const short = run({ history: [{ role: "user", content: "哦" }] });
    const dialogue = run({ history: [{ role: "user", content: "你昨晚去哪儿了？" }] });
    expect(short.mode).not.toBe(dialogue.mode);
    expect(short.cacheKey).toBe(dialogue.cacheKey);
  });

  it("作者注每轮都变，但同样不碰前缀指纹", () => {
    const withNote = run({ authorNote: { text: "雨声不要停。" } });
    const without = run();
    expect(withNote.cacheKey).toBe(without.cacheKey);
  });
});

describe("Author's Note", () => {
  const history: ChatMessage[] = [
    { role: "assistant", content: "开场白" },
    { role: "user", content: "台词1" },
    { role: "assistant", content: "台词2" },
    { role: "user", content: "台词3" },
  ];

  it("频率：0 从不，1 每轮，N 每 N 轮，第 0 轮总是有", () => {
    const note = { text: "记住雨声。", frequency: 2 };
    expect(linesOf(run({ authorNote: { ...note, frequency: 0 }, turn: 2 }).messages).join("\n")).not.toContain(
      "记住雨声。",
    );
    expect(linesOf(run({ authorNote: note, turn: 0 }).messages).join("\n")).toContain("记住雨声。");
    expect(linesOf(run({ authorNote: note, turn: 1 }).messages).join("\n")).not.toContain("记住雨声。");
    expect(linesOf(run({ authorNote: note, turn: 2 }).messages).join("\n")).toContain("记住雨声。");
  });

  it("默认插在最后一条玩家输入之前（历史之后，不是系统提示开头）", () => {
    const messages = run({ history, authorNote: { text: "作者注正文" } }).messages;
    const noteAt = messages.findIndex((message) => message.content.includes("作者注正文"));
    expect(noteAt).toBeGreaterThan(0);
    // 紧挨着最后一条玩家输入，且在它前面
    expect(messages[noteAt - 1].content).toBe("台词2");
    expect(messages[noteAt + 1].content).toBe("台词3");
    // 不在前缀里：第一条仍然是核心规则
    expect(messages[0].content).toContain("不要替玩家说话");
  });

  it("depth 决定插在倒数第几条之前，0 就是最后一条之后", () => {
    const at = (depth: number) => {
      const messages = run({ history, authorNote: { text: "作者注正文", depth } }).messages;
      return {
        note: messages.findIndex((message) => message.content.includes("作者注正文")),
        // 历史第一句的位置就是前缀长度
        historyStart: messages.findIndex((message) => message.content === "开场白"),
      };
    };
    // depth 0：最后一条之后 → 前缀 + 全部四条历史
    expect(at(0).note).toBe(at(0).historyStart + 4);
    // depth 1：最后一条之前
    expect(at(1).note).toBe(at(1).historyStart + 3);
    // depth 2：再往前一条
    expect(at(2).note).toBe(at(2).historyStart + 2);
  });

  it("depth 超出历史长度时贴到最前面，不越界", () => {
    const messages = run({
      history: [{ role: "user", content: "只有一句" }],
      authorNote: { text: "作者注正文", depth: 6 },
    }).messages;
    const noteAt = messages.findIndex((message) => message.content.includes("作者注正文"));
    // 前缀之后的第一条
    expect(noteAt).toBeGreaterThan(0);
    expect(messages[noteAt + 1].content).toBe("只有一句");
  });

  it("包装里写明它是「这一轮怎么写」，不是新设定", () => {
    const messages = run({ history, authorNote: { text: "雨声不要停。" } }).messages;
    const note = messages.find((message) => message.content.includes("雨声不要停。"));
    expect(note?.content).toContain("管这一轮的节奏和写法");
    expect(note?.content).toContain("不是新的设定或事件");
    expect(note?.content).toContain("优先级高于上面的常规要求");
  });

  it("临时注记压过常规注记，用于重新生成纠偏", () => {
    const messages = run({
      history,
      authorNote: { text: "常规注记" },
      temporaryNote: "上一版替玩家行动了，这一轮别这样。",
    }).messages;
    const flat = linesOf(messages).join("\n");
    expect(flat).toContain("上一版替玩家行动了");
    expect(flat).not.toContain("常规注记");
  });

  it("关掉作者注就不出现，也不占预算", () => {
    const off = run({ history, authorNote: { text: "雨声不要停。", enabled: false } });
    expect(linesOf(off.messages).join("\n")).not.toContain("雨声不要停。");
    expect(off.budget.blocks.note).toBe(0);

    const on = run({ history, authorNote: { text: "雨声不要停。" } });
    expect(on.budget.blocks.note).toBeGreaterThan(0);
  });

  it("作者注的 token 从历史预算里扣，不会把总预算顶爆", () => {
    const without = run({ history });
    const withNote = run({ history, authorNote: { text: "记住雨声。".repeat(20) } });
    expect(withNote.budget.used).toBeLessThanOrEqual(withNote.budget.max);
    expect(withNote.budget.blocks.history).toBeLessThanOrEqual(without.budget.blocks.history);
  });

  it("作者注不碰前缀指纹", () => {
    const withNote = run({ history, authorNote: { text: "雨声不要停。" } });
    const without = run({ history });
    expect(withNote.cacheKey).toBe(without.cacheKey);
  });
});

describe("缓存", () => {
  it("断点打在前缀最后一条，历史不带，关掉就没有", () => {
    const marked = run({
      summary: { text: "玩家回来了。", coveredIndex: 1, compressedCount: 1 },
      history: [
        { role: "assistant", content: "开场" },
        { role: "user", content: "下一句" },
      ],
    });
    const flagged = marked.messages.filter((message) => message.cache_control);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.content).toContain("之前的剧情");
    expect(flagged[0]?.cache_control).toEqual({ type: "ephemeral" });

    const plain = run({ cache: false, summary: { text: "玩家回来了。", coveredIndex: 1, compressedCount: 1 } });
    expect(plain.messages.some((message) => message.cache_control)).toBe(false);
    expect(plain.cacheKey).toBe(marked.cacheKey);
  });

  it("换卡失效，不把另一张卡的前缀算成命中", () => {
    resetCacheStats();
    const first = run();
    const other = run({ card: { ...card, name: "沈顾红", description: "另一张卡。" } });
    expect(first.cacheKey).not.toBe(other.cacheKey);

    const stats = cacheStatsFor("隔离会话");
    expect(stats.observe(first.cacheKey)).toBe(false);
    expect(stats.observe(first.cacheKey)).toBe(true);
    stats.invalidate();
    expect(stats.observe(other.cacheKey)).toBe(false);
    expect(stats.observe(first.cacheKey)).toBe(false);
  });
});

describe("摘要与关键事实", () => {
  it("摘要只追加，不重写旧段", () => {
    let summary = emptySummary();
    summary = applySummary(summary, "第一段：欠着饭钱。", 4);
    summary = applySummary(summary, "第二段：人还在店里。", 8);
    expect(summary.text).toBe("第一段：欠着饭钱。\n第二段：人还在店里。");
    expect(summary.coveredIndex).toBe(8);
    expect(summary.compressedCount).toBe(2);
    expect(appendSummary("已有", "")).toBe("已有");
  });

  it("事实合并可更新，超上限也不挤掉先记下的", () => {
    const base: KeyFacts = { characters: { 林晚晴: "老板娘" }, places: {}, flags: { 已欠账: true } };
    const patch: KeyFacts = {
      characters: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`路人${index}`, "路过"])),
      places: { 晚星旅店: "城南" },
      flags: {},
    };
    patch.characters["林晚晴"] = "还在擦柜台";
    const merged = mergeFacts(base, patch);
    expect(merged.characters["林晚晴"]).toBe("还在擦柜台");
    expect(Object.keys(merged.characters)).toHaveLength(20);
    expect(merged.flags["已欠账"]).toBe(true);
    expect(merged.places["晚星旅店"]).toBe("城南");
    expect(mergeFacts(base, null)).toEqual({
      characters: base.characters,
      places: {},
      flags: base.flags,
    });
    expect(emptyKeyFacts().flags).toEqual({});
  });

  it("事实块坏了只丢掉事实，正文留下", () => {
    const parsed = parseFactsPayload('人还在店里。\n<facts>{"characters":{"林晚晴":"添柴"}}</facts>');
    expect(parsed.prose).toBe("人还在店里。");
    expect(parsed.facts?.characters["林晚晴"]).toBe("添柴");
    expect(parseFactsPayload("没有事实。<facts>{坏的</facts>").prose).toBe("没有事实。");
    expect(parseFactsPayload("没有事实。<facts>{坏的</facts>").facts).toBeNull();
  });

  it("漏掉闭合标签的事实块也要收走，不能留在摘要正文里", () => {
    const parsed = parseFactsPayload('她坐下了。\n<facts>{"characters":{"林晚晴":"添柴"}}');
    expect(parsed.prose).toBe("她坐下了。");
    expect(parsed.facts?.characters["林晚晴"]).toBe("添柴");
  });

  it("只对还没压过的历史计阈值", () => {
    const history: ChatMessage[] = [{ role: "user", content: "字".repeat(200) }];
    expect(needsSummarize(history, undefined, 10)).toBe(true);
    expect(needsSummarize(history, { text: "已压", coveredIndex: 1, compressedCount: 1 }, 10)).toBe(
      false,
    );
  });
});

describe("五十轮之后", () => {
  it("人设、关键剧情和每一段摘要都还在，两张卡的缓存不串", () => {
    let history: ChatMessage[] = [{ role: "assistant", content: "<narr>雨夜，店里只剩她。</narr>" }];
    let summary = emptySummary();
    for (let turn = 1; turn <= 50; turn++) {
      history = [
        ...history,
        { role: "user", content: `第${turn}轮。饭钱还欠着，人在晚星旅店。` },
        { role: "assistant", content: `<dlg who="林晚晴">第${turn}轮的账还在。</dlg>` },
      ];
      if (turn % 5 === 0) {
        summary = applySummary(
          summary,
          `压到第${turn}轮：玩家仍欠饭钱，人在晚星旅店，林晚晴没有改口。`,
          history.length,
        );
      }
    }

    const facts: KeyFacts = {
      characters: { 林晚晴: "晚星旅店老板娘" },
      places: { 晚星旅店: "城南街尽头" },
      flags: { 已欠账: true },
    };
    const result = run({
      history,
      summary,
      facts,
      style: "mushoku",
      budget: planBudget(16_000),
      lorebook: {
        entries: [{ keys: [], content: "一楼酒堂常年点着一盏油灯。", constant: true }],
      },
    });
    const flat = linesOf(result.messages).join("\n");

    expect(flat).toContain("嘴上赶人，手上添茶。");
    expect(flat).toContain("欠下饭钱");
    expect(flat).toContain("晚星旅店老板娘");
    expect(flat).toContain("城南街尽头");
    expect(flat).toContain("已欠账");
    expect(flat).toContain("一楼酒堂常年点着一盏油灯。");
    expect(flat.indexOf("角色名：林晚晴")).toBeLessThan(flat.indexOf("之前的剧情"));
    expect(summary.text.startsWith("压到第5轮：玩家仍欠饭钱")).toBe(true);
    expect(summary.text).toContain("压到第50轮：玩家仍欠饭钱");
    expect(summary.text.split("\n")).toHaveLength(10);
    expect(result.needsSummarize).toBe(false);

    const other = run({
      card: { ...card, name: "别人", personality: "完全另一套性格。" },
      history,
      summary,
      facts,
    });
    expect(other.cacheKey).not.toBe(result.cacheKey);
    expect(linesOf(other.messages).join("\n")).not.toContain("嘴上赶人，手上添茶。");
  });

  it("整张卡：常驻世界书进提示词，关键词本身不进", () => {
    const lorebook = {
      entries: [
        { keys: [], content: "晚星旅店一楼酒堂，壁炉、账本、墙上的账。", constant: true },
        { keys: ["北方", "渔村"], content: "她十五岁那年渔村出事，只身南下，从不细说。" },
      ],
    };
    const data: AssembleInput["card"] = {
      ...card,
      description: `${card.description}\n她十五岁那年渔村出事，只身南下。`,
      post_history_instructions: "不要发明北方渔村的细节。",
    };
    const result = assemble({
      card: data,
      lorebook,
      history: [
        { role: "assistant", content: "<narr>雨还在下。</narr>" },
        { role: "user", content: "你到底是从北方哪里来的？" },
      ],
      seed: 1,
      budget: 100_000,
    });
    const book = result.messages.find((message) => message.content.includes("渔村出事，只身南下"));
    expect(book).toBeTruthy();
    expect(book?.content).not.toContain("北方");
    expect(result.budget.lorebookEntries).toBeGreaterThan(0);
    expect(result.messages.some((message) => message.content.includes("不要发明北方渔村"))).toBe(
      true,
    );
  });
});
