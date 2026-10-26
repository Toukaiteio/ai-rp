import { describe, expect, it } from "vitest";
import { assemble, planBudget, type AssembleInput } from "@/lib/prompt";
import { ENTRY_PRIORITIES, LOREBOOK_SOURCES, matchWorldBook } from "./worldbook";
import type { ChatMessage, WorldBook, WorldBookEntry } from "./types";

const HISTORY: ChatMessage[] = [
  { role: "assistant", content: "<narr>壁炉快灭了。</narr>" },
  { role: "user", content: "来杯姜茶。" },
];

function entry(over: Partial<WorldBookEntry> & { content: string }): WorldBookEntry {
  return { keys: [], ...over };
}

/** 一大段内容，用来把 token 预算吃满。 */
function big(label: string, size = 400): string {
  return `${label}${"字".repeat(size)}`;
}

function match(books: Parameters<typeof matchWorldBook>[0]["books"], extra: Partial<Parameters<typeof matchWorldBook>[0]> = {}) {
  return matchWorldBook({
    books,
    history: HISTORY,
    userMessage: "来杯姜茶。",
    seed: 7,
    ...extra,
  });
}

describe("世界书：预算与优先级（第一阶段）", () => {
  it("四档优先级都有标签，顺序固定", () => {
    expect(ENTRY_PRIORITIES).toEqual(["constant", "scene", "player", "background"]);
  });

  it("命中条目按优先级分档：常驻 / 场景 / 玩家提到 / 背景", () => {
    const result = match([
      {
        source: "card",
        book: {
          entries: [
            entry({ content: "常驻规则", constant: true }),
            entry({ keys: ["酒堂"], content: "场景相关" }),
            entry({ keys: ["姜茶"], content: "玩家刚提到" }),
            entry({ keys: ["雨"], content: "背景" }),
          ],
        },
      },
    ], { sceneText: "一楼酒堂" });

    expect(result.report.byPriority).toEqual({
      constant: 1,
      scene: 1,
      player: 1,
      background: 0,
    });
    // 场景优先于玩家提到：当前正在发生的事比刚说出口的词更该入选
    const order = result.matched.map((item) => item.priority);
    expect(order).toEqual(["constant", "scene", "player"]);
  });

  it("预算不够时先丢背景，常驻规则一条不少", () => {
    const result = matchWorldBook({
      books: [
        {
          source: "card",
          book: {
            entries: [
              entry({ content: "常驻规则", constant: true }),
              entry({ keys: ["雨"], content: big("背景条目"), order: 0 }),
            ],
          },
        },
      ],
      history: HISTORY,
      userMessage: "雨还在下。",
      seed: 7,
      tokenCap: 60,
    });

    const injected = result.matched.filter((item) =>
      Object.values(result.group).some((list) => list.includes(item.entry)),
    );
    expect(injected.map((item) => item.entry.content)).toEqual(["常驻规则"]);
    expect(result.report.dropped).toBe(1);
  });

  it("预算封顶同时看条目数和 token 数", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ content: `条目${i}`, constant: true }),
    );
    const byCount = match([{ source: "card", book: { entries } }], { budgetCap: 3 });
    expect(byCount.report.injected).toBe(3);
    expect(byCount.report.dropped).toBe(7);

    const byToken = match([{ source: "card", book: { entries: [entry({ content: big("长"), constant: true })] } }], {
      tokenCap: 10,
    });
    expect(byToken.report.injected).toBe(0);
    expect(byToken.report.dropped).toBe(1);
  });

  it("预算数字记在报告里，方便对账", () => {
    const result = match([{ source: "card", book: { entries: [entry({ content: "常驻", constant: true })] } }], {
      budgetCap: 5,
      tokenCap: 123,
    });
    expect(result.report.budgetCap).toBe(5);
    expect(result.report.tokenCap).toBe(123);
    expect(result.report.tokens).toBeGreaterThan(0);
  });

  it("命中为 0 时报告也是干净的", () => {
    const result = match([]);
    expect(result.report).toMatchObject({ matched: 0, injected: 0, dropped: 0, tokens: 0 });
    expect(result.group.after_char).toEqual([]);
  });
});

describe("世界书：三来源（第二阶段）", () => {
  it("三个来源都有标签", () => {
    expect(LOREBOOK_SOURCES).toEqual(["global", "card", "chat"]);
  });

  it("三本一起匹配，各自记在报告里", () => {
    const result = match([
      { source: "global", book: { entries: [entry({ content: "全局：通用规则", constant: true })] } },
      { source: "card", book: { entries: [entry({ content: "角色：她怕烫", constant: true })] } },
      { source: "chat", book: { entries: [entry({ content: "本场：今天是她生日", constant: true })] } },
    ]);
    expect(result.report.bySource).toEqual({ global: 1, card: 1, chat: 1 });
    expect(result.report.injected).toBe(3);
  });

  it("同优先级时聊天书压过角色书，角色书压过全局书", () => {
    const result = match([
      { source: "global", book: { entries: [entry({ content: "全局版本", constant: true })] } },
      { source: "card", book: { entries: [entry({ content: "角色版本", constant: true })] } },
      { source: "chat", book: { entries: [entry({ content: "本场版本", constant: true })] } },
    ], { budgetCap: 2 });

    // 看真正注入的顺序（group），不是扫描顺序（matched）
    expect(result.group.after_char.map((item) => item.content)).toEqual(["本场版本", "角色版本"]);
    expect(result.report.dropped).toBe(1);
    expect(result.report.bySource.global).toBe(0);
  });

  it("只给一本也能跑，来源照旧标对", () => {
    const result = match([{ source: "chat", book: { entries: [entry({ content: "只有本场", constant: true })] } }]);
    expect(result.report.bySource.chat).toBe(1);
    expect(result.report.bySource.global).toBe(0);
  });

  it("空的书直接跳过，不占预算也不进报告", () => {
    const result = match([
      { source: "global", book: { entries: [] } },
      { source: "card", book: { entries: [entry({ content: "只有角色书", constant: true })] } },
    ]);
    expect(result.report.matched).toBe(1);
    expect(result.report.bySource.global).toBe(0);
  });

  it("一本都不给时返回空，不报错", () => {
    const result = matchWorldBook({ books: [], history: HISTORY, seed: 1 });
    expect(result.matched).toEqual([]);
    expect(result.tokens).toBe(0);
  });

  it("停用的条目一律不进候选", () => {
    const result = match([
      {
        source: "card",
        book: {
          entries: [
            entry({ content: "停用的", constant: true, enabled: false }),
            entry({ content: "   ", constant: true }),
            entry({ content: "正常的", constant: true }),          ],
        },
      },
    ]);
    expect(result.report.matched).toBe(1);
  });
});

describe("世界书：时效（sticky / cooldown / delay）", () => {
  const book: WorldBook = {
    entries: [{ keys: ["姜茶"], content: "灶上温着姜茶。", position: "after_char" }],
  };

  it("delay：会话开头几轮不激活，第 N 轮起才参与匹配", () => {
    const delayed: WorldBook = {
      entries: [{ keys: ["姜茶"], content: "灶上温着姜茶。", delay: 2 }],
    };
    expect(match([{ source: "card", book: delayed }], { turn: 1 }).matched).toHaveLength(0);
    expect(match([{ source: "card", book: delayed }], { turn: 2 }).matched).toHaveLength(1);
  });

  it("sticky：激活后窗口内不需要关键词再命中，窗口一过就断", () => {
    const sticky: WorldBook = {
      entries: [{ keys: ["姜茶"], content: "灶上温着姜茶。", sticky: 2 }],
    };
    // 第 0 轮关键词命中，窗口覆盖第 1、2 轮
    const first = match([{ source: "card", book: sticky }], { turn: 0 });
    expect(first.matched).toHaveLength(1);
    expect(first.timing["card#0"]).toEqual({ lastTurn: 0, stickyLeft: 2 });

    const silent: ChatMessage[] = [{ role: "user", content: "换个话题。" }];
    const renewed = matchWorldBook({
      books: [{ source: "card", book: sticky }],
      history: silent,
      userMessage: "换个话题。",
      seed: 7,
      turn: 2,
      timing: first.timing,
    });
    expect(renewed.matched).toHaveLength(1);
    // 续期不刷新窗口，不然它会自己续命下去
    expect(renewed.timing["card#0"]).toEqual({ lastTurn: 0, stickyLeft: 2 });

    const expired = matchWorldBook({
      books: [{ source: "card", book: sticky }],
      history: silent,
      userMessage: "换个话题。",
      seed: 7,
      turn: 3,
      timing: first.timing,
    });
    expect(expired.matched).toHaveLength(0);
  });

  it("cooldown：窗口结束后再压几轮，期间关键词命中也不注入", () => {
    const cooled: WorldBook = {
      entries: [{ keys: ["姜茶"], content: "灶上温着姜茶。", cooldown: 2 }],
    };
    const first = match([{ source: "card", book: cooled }], { turn: 0 });
    expect(first.matched).toHaveLength(1);

    const again = matchWorldBook({
      books: [{ source: "card", book: cooled }],
      history: HISTORY,
      userMessage: "来杯姜茶。",
      seed: 7,
      turn: 2,
      timing: first.timing,
    });
    expect(again.matched).toHaveLength(0);

    const freed = matchWorldBook({
      books: [{ source: "card", book: cooled }],
      history: HISTORY,
      userMessage: "来杯姜茶。",
      seed: 7,
      turn: 3,
      timing: first.timing,
    });
    expect(freed.matched).toHaveLength(1);
  });

  it("常驻条目不吃时效，没有时效字段的书也不产生状态", () => {
    const constantBook: WorldBook = {
      entries: [{ keys: [], content: "常驻油灯。", constant: true, delay: 5, cooldown: 5 }],
    };
    const result = match([{ source: "card", book: constantBook }], { turn: 0 });
    expect(result.matched).toHaveLength(1);
    expect(result.timing).toEqual({});

    const plain = match([{ source: "card", book }], { turn: 4 });
    expect(plain.matched).toHaveLength(1);
    expect(plain.timing).toEqual({});
  });
});

describe("世界书：组装器里的位置与缓存", () => {
  const card: AssembleInput["card"] = {
    name: "林晚晴",
    description: "旅店老板娘。",
    personality: "嘴上赶人。",
    scenario: "深秋雨夜，一楼酒堂。",
  };

  function run(extra: Partial<AssembleInput> = {}) {
    return assemble({
      card,
      history: HISTORY,
      seed: 7,
      budget: 100_000,
      ...extra,
    });
  }

  it("三来源都能进提示词，常驻条目留在前缀里", () => {
    const result = run({
      lorebooks: {
        global: { entries: [entry({ content: "全局规则", constant: true, position: "before_char" })] },
        card: { entries: [entry({ content: "角色规则", constant: true })] },
        chat: { entries: [entry({ content: "本场规则", constant: true })] },
      },
    });
    const flat = result.messages.map((message) => message.content).join("\n");
    expect(flat).toContain("全局规则");
    expect(flat).toContain("角色规则");
    expect(flat).toContain("本场规则");
    expect(result.budget.lorebookEntries).toBe(3);
  });

  it("关键词条目不进前缀，所以换关键词不会打掉缓存指纹", () => {
    const books = {
      card: {
        entries: [
          entry({ content: "常驻：油灯", constant: true }),
          entry({ keys: ["姜茶"], content: "灶上温着姜茶。" }),
        ],
      },
    };
    const hit = run({ lorebooks: books, history: [{ role: "user", content: "来杯姜茶" }] });
    const miss = run({ lorebooks: books, history: [{ role: "user", content: "随便看看" }] });

    expect(hit.cacheKey).toBe(miss.cacheKey);
    expect(hit.messages.map((m) => m.content).join("\n")).toContain("灶上温着姜茶。");
    expect(miss.messages.map((m) => m.content).join("\n")).not.toContain("灶上温着姜茶。");
  });

  it("聊天世界书的命中条目进不了前缀，所以不影响缓存指纹", () => {
    const base = run({
      lorebooks: { card: { entries: [entry({ content: "角色规则", constant: true })] } },
    });
    const withChat = run({
      lorebooks: {
        card: { entries: [entry({ content: "角色规则", constant: true })] },
        chat: { entries: [entry({ keys: ["姜茶"], content: "本场：灶上温着姜茶。" })] },
      },
    });
    expect(withChat.cacheKey).toBe(base.cacheKey);
    expect(withChat.messages.map((m) => m.content).join("\n")).toContain("本场：灶上温着姜茶。");
  });

  it("聊天世界书里的常驻条目会进前缀，这是有意的", () => {
    // 常驻就是「每一轮都在」，它稳定，所以进前缀吃缓存；
    // 真正每轮会变的是关键词命中的那些，它们留在历史之后。
    const withConstant = run({
      lorebooks: {
        card: { entries: [entry({ content: "角色规则", constant: true })] },
        chat: { entries: [entry({ content: "本场规则", constant: true })] },
      },
    });
    const flat = withConstant.messages.map((m) => m.content).join("\n");
    expect(flat).toContain("本场规则");
    // 前缀里有它，所以指纹和只有角色书时不同
    const base = run({
      lorebooks: { card: { entries: [entry({ content: "角色规则", constant: true })] } },
    });
    expect(withConstant.cacheKey).not.toBe(base.cacheKey);
  });

  it("场景相关条目优先于玩家刚提到的关键词", () => {
    const result = run({
      sceneState: {
        location: "酒堂",
        time: "",
        presentCharacters: [],
        currentAction: "",
        unresolvedThreads: [],
        lastUpdatedAt: 0,
        status: {
          location: "confirmed",
          time: "uncertain",
          weather: "uncertain",
          presentCharacters: "uncertain",
          currentAction: "uncertain",
          emotionalTone: "uncertain",
          unresolvedThreads: "uncertain",
        },
        updatedTurn: {
          location: 1,
          time: -1,
          weather: -1,
          presentCharacters: -1,
          currentAction: -1,
          emotionalTone: -1,
          unresolvedThreads: -1,
        },
      },
      lorebooks: {
        card: {
          entries: [
            entry({ keys: ["酒堂"], content: "场景：六张方桌。" }),
            entry({ keys: ["姜茶"], content: "玩家提到：灶上有姜茶。" }),
          ],
        },
      },
    });
    expect(result.budget.lorebook?.byPriority.scene).toBe(1);
    expect(result.budget.lorebook?.byPriority.player).toBe(1);
  });

  it("预算报告跟着组装结果一起出来", () => {
    const result = run({
      lorebooks: {
        card: {
          entries: [entry({ content: "常驻", constant: true }), entry({ keys: ["姜茶"], content: "姜茶" })],
        },
      },
    });
    expect(result.budget.lorebook).toBeDefined();
    expect(result.budget.lorebook?.matched).toBe(2);
    expect(result.budget.lorebook?.injected).toBe(2);
  });

  it("旧的单本 lorebook 参数照旧可用", () => {
    const result = run({
      lorebook: { entries: [entry({ content: "旧写法", constant: true })] },
    });
    expect(result.messages.map((m) => m.content).join("\n")).toContain("旧写法");
    expect(result.budget.lorebook?.bySource.card).toBe(1);
  });

  it("世界书不占历史预算之外的空间：token 计入 lorebook 一项", () => {
    const result = run({
      lorebooks: { card: { entries: [entry({ content: big("长条目"), constant: true })] } },
    });
    expect(result.budget.blocks.lorebook).toBeGreaterThan(0);
    expect(result.budget.used).toBeLessThanOrEqual(result.budget.max);
  });
});

describe("世界书：三阶段之外的规则保持不变", () => {
  it("概率条目用 seed 做确定性判定", () => {
    const book: WorldBook = {
      entries: [entry({ keys: ["姜茶"], content: "概率条目", probability: 50 })],
    };
    const first = match([{ source: "card", book }]);
    const second = match([{ source: "card", book }]);
    expect(first.report.matched).toBe(second.report.matched);
  });

  it("and 要全中，or 中一个就行", () => {
    const result = match([
      {
        source: "card",
        book: {
          entries: [
            entry({ keys: ["姜茶", "热酒"], content: "两条都中才进", logic: "and" }),
            entry({ keys: ["姜茶"], content: "中一个就进", logic: "or" }),
          ],
        },
      },
    ]);
    const flat = Object.values(result.group).flat().map((item) => item.content);
    expect(flat).toContain("中一个就进");
    expect(flat).not.toContain("两条都中才进");
  });

  it("planBudget 仍然只扣回复预留", () => {
    expect(planBudget(1000, 100)).toBe(897);
  });
});
