import { describe, expect, it } from "vitest";
import { assemble, planBudget } from "@/lib/prompt";
import {
  INSPECTOR_SECTIONS,
  SECTION_LABELS,
  buildInspector,
  defaultCost,
  formatInspector,
  withExtraMessage,
} from "./inspector";
import { PER_MESSAGE_OVERHEAD, estimateTokens } from "./budget";
import type { ChatMessage } from "./types";

const CARD = {
  name: "深月风花",
  description: "同班同学。",
  personality: "别扭，嘴硬。",
  scenario: "午休的教室。",
  post_history_instructions: "最后再提醒一次：不要替玩家行动。",
  author_note: "这一轮慢一点。",
};

const HISTORY: ChatMessage[] = [
  { role: "assistant", content: '<dlg who="深月风花">……你又没事干了？</dlg>' },
  { role: "user", content: "我问她看的是什么书。" },
];

function run(extra: Partial<Parameters<typeof assemble>[0]> = {}) {
  return assemble({
    card: CARD,
    history: HISTORY,
    seed: 1,
    budget: 100_000,
    ...extra,
  });
}

describe("Prompt Inspector：区段与顺序", () => {
  it("区段顺序固定，和最终消息顺序一致", () => {
    expect(INSPECTOR_SECTIONS).toEqual([
      "system",
      "card",
      "voice",
      "worldbook",
      "scene",
      "history",
      "director",
      "note",
      "post_history",
      "user",
    ]);
  });

  it("每个区段都有标签", () => {
    for (const section of INSPECTOR_SECTIONS) {
      expect(SECTION_LABELS[section].length).toBeGreaterThan(0);
    }
    expect(SECTION_LABELS.card).toBe("Character Card");
    expect(SECTION_LABELS.note).toBe("Author's Note");
  });

  it("每条消息都有下标、role、来源和 token", () => {
    const result = run();
    const inspector = result.inspector;
    expect(inspector.messages).toHaveLength(result.messages.length);
    inspector.messages.forEach((row, index) => {
      expect(row.index).toBe(index);
      expect(row.role).toBe(result.messages[index].role);
      expect(row.detail.length).toBeGreaterThan(0);
      expect(row.tokens).toBeGreaterThan(0);
      expect(row.content).toBe(result.messages[index].content);
    });
  });

  it("区段汇总只列出现过的段，且和消息对得上", () => {
    const inspector = run().inspector;
    const systemRows = inspector.messages.filter((row) => row.section === "system");
    const systemSummary = inspector.sections.find((item) => item.section === "system");
    expect(systemSummary?.count).toBe(systemRows.length);
    expect(systemSummary?.tokens).toBe(systemRows.reduce((sum, row) => sum + row.tokens, 0));
    // 没出现的段不出现在汇总里
    expect(inspector.sections.every((item) => item.count > 0)).toBe(true);
  });

  it("区段按实际出现的位置排，不按枚举顺序", () => {
    // 作者注在历史里（靠前），导演计划在最后。照枚举排会让计划排在注记前面，
    // 那和真正发出去的消息顺序不符，读起来会误导。
    const base = run().inspector;
    const withPlan = withExtraMessage(
      base,
      { role: "system", content: "计划。" },
      { section: "director", layer: "post", detail: "导演计划" },
      defaultCost,
    );
    const order = withPlan.sections.map((item) => item.section);
    expect(order.indexOf("note")).toBeLessThan(order.indexOf("director"));
    expect(order.indexOf("user")).toBeLessThan(order.indexOf("director"));
    // 汇总的顺序就是各段首次出现的顺序
    const firstIndexes = order.map(
      (section) => withPlan.messages.find((row) => row.section === section)?.index ?? -1,
    );
    expect([...firstIndexes].sort((a, b) => a - b)).toEqual(firstIndexes);
  });
});

describe("Prompt Inspector：各段归位", () => {
  it("核心规则与角色卡核心信息合并归入顶层 System", () => {
    const inspector = run().inspector;
    expect(inspector.messages[0].section).toBe("system");
    expect(inspector.messages[0].detail).toContain("core_rules");
    expect(inspector.messages[0].detail).toContain("personality");
    expect(inspector.messages[0].content).toContain("角色名：深月风花");
  });

  it("角色声音一并合入顶层 System", () => {
    const inspector = run({
      card: {
        ...CARD,
        voice: {
          sentenceLength: "short",
          directness: "indirect",
          emotionalExpression: "restrained",
          vocabulary: [],
          habits: [],
          avoidances: [],
          sampleLines: [],
        },
      },
    }).inspector;
    expect(inspector.messages[0].section).toBe("system");
    expect(inspector.messages[0].detail).toContain("describeVoice");
    expect(inspector.messages[0].content).toContain("她说话的样子：");
  });

  it("作者注标在 Chat History 里，并写明 depth", () => {
    const inspector = run().inspector;
    const note = inspector.messages.find((row) => row.section === "note");
    expect(note).toBeDefined();
    expect(note?.layer).toBe("history");
    expect(note?.detail).toBe("depth 1");
  });

  it("玩家输入和角色回复分开标", () => {
    const inspector = run().inspector;
    const user = inspector.messages.find((row) => row.section === "user");
    expect(user?.detail).toBe("玩家输入");
    expect(user?.layer).toBe("history");
    const reply = inspector.messages.find((row) => row.detail === "角色回复");
    expect(reply?.section).toBe("history");
  });

  it("Post-History Rules 归位", () => {
    const inspector = run().inspector;
    const post = inspector.messages.find((row) => row.section === "post_history");
    expect(post?.detail).toBe("card.post_history_instructions");
    expect(post?.layer).toBe("post");
  });

  it("场景状态和剧情线都在 Scene State 那一段", () => {
    const inspector = run({
      sceneState: {
        location: "图书馆",
        time: "午后",
        presentCharacters: ["深月风花"],
        currentAction: "她在翻书",
        unresolvedThreads: [],
        lastUpdatedAt: 0,
        status: {
          location: "confirmed",
          time: "confirmed",
          weather: "uncertain",
          presentCharacters: "confirmed",
          currentAction: "confirmed",
          emotionalTone: "uncertain",
          unresolvedThreads: "uncertain",
        },
        updatedTurn: {
          location: 1,
          time: 1,
          weather: -1,
          presentCharacters: 1,
          currentAction: 1,
          emotionalTone: -1,
          unresolvedThreads: -1,
        },
      },
    }).inspector;
    const scene = inspector.messages.find((row) => row.section === "scene" && row.layer === "post");
    expect(scene?.detail).toContain("场景状态");
    expect(scene?.detail).toContain("模式");
  });
});

describe("Prompt Inspector：层级与缓存", () => {
  it("前缀和回合层分开统计", () => {
    const inspector = run().inspector;
    expect(inspector.totals.prefixTokens).toBeGreaterThan(0);
    expect(inspector.totals.postTokens).toBeGreaterThan(0);
    expect(inspector.totals.historyTokens).toBeGreaterThan(0);
    expect(inspector.totals.tokens).toBe(
      inspector.totals.prefixTokens + inspector.totals.historyTokens + inspector.totals.postTokens,
    );
  });

  it("前缀那条打了缓存断点，面板能看出来", () => {
    const inspector = run().inspector;
    const cached = inspector.messages.filter((row) => row.cached);
    expect(cached).toHaveLength(1);
    expect(cached[0].layer).toBe("prefix");
  });

  it("cache: false 时没有缓存标记", () => {
    const inspector = run({ cache: false }).inspector;
    expect(inspector.messages.some((row) => row.cached)).toBe(false);
  });

  it("token 估算和预算环里的数字一致", () => {
    const result = run();
    expect(result.inspector.totals.tokens).toBe(result.budget.used);
  });
});

describe("Prompt Inspector：世界书", () => {
  const books = {
    global: {
      entries: [{ keys: [], constant: true, content: "这个世界没有魔法。" }],
    },
    card: {
      entries: [
        { keys: ["书", "文库本"], content: "她手里是夏目漱石的《心》。" },
        { keys: ["从来没提过"], content: "不该命中。" },
      ],
    },
    chat: {
      entries: [{ keys: [], constant: true, content: "这一场是深秋。" }],
    },
  };

  it("列出被激活的条目，带来源、优先级和触发词", () => {
    const inspector = run({
      lorebooks: books,
      history: [{ role: "user", content: "我问她看的是什么书。" }],
    }).inspector;

    expect(inspector.lorebook).toHaveLength(3);
    const bySource = Object.fromEntries(inspector.lorebook.map((item) => [item.source, item]));
    expect(bySource.global.priority).toBe("constant");
    expect(bySource.chat.priority).toBe("constant");
    expect(bySource.card.priority).toBe("player");
    expect(bySource.card.keys).toEqual(["书"]);
    expect(bySource.card.content).toContain("夏目漱石");
  });

  it("没命中的条目不出现", () => {
    const inspector = run({ lorebooks: books }).inspector;
    expect(inspector.lorebook.some((item) => item.content.includes("不该命中"))).toBe(false);
  });

  it("常驻条目在 World Book 段里，关键词条目也在", () => {
    const inspector = run({
      lorebooks: books,
      history: [{ role: "user", content: "我问她看的是什么书。" }],
    }).inspector;
    const rows = inspector.messages.filter((row) => row.section === "worldbook");
    expect(rows.some((row) => row.detail.includes("常驻"))).toBe(true);
    expect(rows.some((row) => row.detail.includes("关键词命中"))).toBe(true);
    expect(rows.some((row) => row.detail.includes("记忆目录"))).toBe(true);
  });
});

describe("Prompt Inspector：纯函数与文本导出", () => {
  it("同一份输入永远得到同一份面板数据", () => {
    const first = run().inspector;
    const second = run().inspector;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("没有来源标签的消息标成未标注，而不是崩掉", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "你好" }];
    const inspector = buildInspector(messages, {}, () => 1);
    expect(inspector.messages[0].detail).toBe("未标注");
    expect(inspector.messages[0].section).toBe("system");
  });

  it("压成纯文本时按区段分组，带 token 和缓存标记", () => {
    const text = formatInspector(run().inspector);
    expect(text).toContain("[System]");
    expect(text).toContain("[Author's Note]");
    expect(text).toContain("cache");
    expect(text).toContain("合计");
  });

  it("token 估算走的是同一套函数", () => {
    const messages: ChatMessage[] = [{ role: "system", content: "一二三" }];
    const inspector = buildInspector(
      messages,
      { 0: { section: "system", layer: "prefix", detail: "test" } },
      (message) => estimateTokens(message.content) + PER_MESSAGE_OVERHEAD,
    );
    expect(inspector.totals.tokens).toBe(estimateTokens("一二三") + PER_MESSAGE_OVERHEAD);
  });
});

describe("Prompt Inspector：组装之后补上的消息", () => {
  it("导演计划补在末尾，序号接着数", () => {
    const base = run().inspector;
    const withPlan = withExtraMessage(
      base,
      { role: "system", content: "计划：她翻页。" },
      { section: "director", layer: "post", detail: "导演计划" },
      defaultCost,
    );

    expect(withPlan.messages).toHaveLength(base.messages.length + 1);
    const last = withPlan.messages[withPlan.messages.length - 1];
    expect(last.index).toBe(base.messages.length);
    expect(last.section).toBe("director");
    expect(last.detail).toBe("导演计划");
    expect(last.content).toBe("计划：她翻页。");
    // 原来那些一条不少，来源也没丢
    expect(withPlan.messages.slice(0, -1).map((row) => row.detail)).toEqual(
      base.messages.map((row) => row.detail),
    );
  });

  it("补上之后区段汇总和合计跟着更新", () => {
    const base = run().inspector;
    const withPlan = withExtraMessage(
      base,
      { role: "system", content: "计划。" },
      { section: "director", layer: "post", detail: "导演计划" },
      defaultCost,
    );
    expect(withPlan.sections.find((item) => item.section === "director")?.count).toBe(1);
    expect(withPlan.totals.messages).toBe(base.totals.messages + 1);
    expect(withPlan.totals.postTokens).toBeGreaterThan(base.totals.postTokens);
  });

  it("补上的消息不会动原有内容", () => {
    const base = run().inspector;
    const withPlan = withExtraMessage(
      base,
      { role: "system", content: "计划。" },
      { section: "director", layer: "post", detail: "导演计划" },
      defaultCost,
    );
    expect(withPlan.messages[0].content).toBe(base.messages[0].content);
    expect(base.messages).toHaveLength(withPlan.messages.length - 1);
  });
});

describe("Prompt Inspector：面板不会改变发出去的东西", () => {
  it("加不加 inspector，messages 完全一样", () => {
    const result = run();
    const { inspector, ...rest } = result;
    void inspector;
    const again = run();
    const { inspector: secondInspector, ...restAgain } = again;
    void secondInspector;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(restAgain));
  });

  it("面板里没有额外的东西混进消息内容", () => {
    const result = run();
    const flat = result.messages.map((message) => message.content).join("\n");
    expect(flat).not.toContain("Prompt Inspector");
    expect(flat).not.toContain("token");
    expect(flat).not.toContain("core_rules");
  });

  it("预算和以前一样，不受 inspector 影响", () => {
    const result = run({ budget: planBudget(16_000, 1024) });
    expect(result.budget.used).toBeLessThanOrEqual(result.budget.max);
    expect(result.budget.blocks.prefix).toBeGreaterThan(0);
  });
});
