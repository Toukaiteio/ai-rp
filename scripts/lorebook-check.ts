/**
 * 世界书的真机检查（Phase 8）。
 *
 * 三件事：
 * 1. 三来源（全局 / 角色 / 聊天）能不能一起匹配，报告分不分得清；
 * 2. 优先级是不是真的决定预算：常驻和场景相关的先拿到额度，背景被丢；
 * 3. 注入之后的正文有没有变差——这一条才需要真模型。
 *
 * 输出 doc/phase8-lorebook-check.json。Key 只从环境变量读。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/lorebook-check.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble, planBudget } from "@/lib/prompt";
import type { ChatMessage, WorldBook } from "@/lib/prompt/types";
import { createOpenAIProvider } from "@/lib/providers/openai";

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = process.env.BASELINE_MODEL ?? "dots3-note-prev";
const BASE_URL = process.env.BASELINE_BASE_URL ?? "https://router.dys.asia/v1";
const OUT = process.env.LOREBOOK_OUT ?? path.join("doc", "phase8-lorebook-check.json");

if (!API_KEY) {
  console.error('缺少 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 });

const CARD = {
  name: "林晚晴",
  description: "晚星旅店的老板娘。三十出头，算账很快，嘴上从不饶人。",
  personality: "对熟客刻薄，对生客客气。不喜欢别人打听后院的事。",
  scenario: "深秋雨夜，旅店一楼酒堂。壁炉快灭了，柜台后点着一盏油灯。",
};

/** 全局书：这套部署通用的东西。 */
const GLOBAL: WorldBook = {
  name: "全局",
  entries: [
    {
      keys: [],
      constant: true,
      content: "这个世界没有魔法，也没有超自然力量。所有异常现象都要有现实解释。",
      position: "before_char",
    },
  ],
};

/** 角色书：跟着卡走的设定。 */
const CARD_BOOK: WorldBook = {
  name: "角色",
  entries: [
    { keys: [], constant: true, content: "林晚晴说话短，常带反问，不说客套话。" },
    { keys: ["后院", "柴房"], content: "后院堆着柴，柴房的门锁是坏的，用一根木棍别着。" },
    { keys: ["酒", "烫酒", "热酒"], content: "店里的酒都是自己酿的，烫酒用的是铜壶。" },
  ],
};

/** 聊天书：只影响这一场。 */
const CHAT_BOOK: WorldBook = {
  name: "本场",
  entries: [
    { keys: [], constant: true, content: "这一场是深秋，外面一直下雨，客人不多。" },
    { keys: ["姜茶", "茶"], content: "灶上温着一壶姜茶，是老板娘自己喝的，不卖。" },
    { keys: ["账本", "记账"], content: "柜台上摊着一本账本，字迹很密。" },
  ],
};

/** 一个超长的背景条目，用来验证预算不够时先丢它。 */
const BULK: WorldBook = {
  name: "背景",
  entries: [
    {
      keys: ["旅店", "晚星"],
      content: `旅店的历史：${"据说这里从前是驿站。".repeat(30)}`,
    },
  ],
};

interface RoundResult {
  round: number;
  playerInput: string;
  report: unknown;
  injectedContents: string[];
  reply: string;
}

/** 上游偶发 500。跑批时重试两次，不要因为一次网关抖动就白跑。 */
async function complete(messages: ChatMessage[], temperature: number, maxTokens: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const events = await provider.open({ messages, model: MODEL, temperature, maxTokens });
      let text = "";
      for await (const event of events) {
        if (event.type === "delta") text += event.text;
        if (event.type === "error") throw new Error(event.message);
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.log(`      （上游第 ${attempt} 次失败，重试）`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  throw lastError;
}

const PLAYER_TURNS = [
  "我要一壶烫酒，再问问后院能不能借个地方晾衣服。",
  "我说账本上那笔账好像算错了。",
  "我问她灶上那壶姜茶卖不卖。",
];

async function main(): Promise<void> {
  console.log(`世界书检查：3 轮 · ${MODEL}`);
  console.log("");

  let history: ChatMessage[] = [];
  const results: RoundResult[] = [];

  for (let round = 1; round <= PLAYER_TURNS.length; round += 1) {
    const playerInput = PLAYER_TURNS[round - 1];
    history = [...history, { role: "user", content: `<player>${playerInput}</player>` }];

    const assembled = assemble({
      card: CARD,
      lorebooks: { global: GLOBAL, card: CARD_BOOK, chat: CHAT_BOOK },
      history,
      seed: 11,
      turn: round - 1,
      userName: "你",
      // 第三轮给一个场景状态：验证「当前场景相关」这一档真的能靠场景文字命中
      ...(round === 3
        ? {
            sceneState: {
              location: "柴房门口",
              time: "深夜",
              presentCharacters: ["林晚晴"],
              currentAction: "两人站在后院，雨小了些",
              unresolvedThreads: [],
              lastUpdatedAt: 0,
              status: {
                location: "confirmed",
                time: "inferred",
                weather: "uncertain",
                presentCharacters: "confirmed",
                currentAction: "confirmed",
                emotionalTone: "uncertain",
                unresolvedThreads: "uncertain",
              },
              updatedTurn: {
                location: 2,
                time: 2,
                weather: -1,
                presentCharacters: 2,
                currentAction: 2,
                emotionalTone: -1,
                unresolvedThreads: -1,
              },
            },
          }
        : {}),
      budget: planBudget(16_000, 1024),
    });

    const reply = await complete(assembled.messages, 0.9, 1024);
    history = [...history, { role: "assistant", content: reply }];

    const report = assembled.budget.lorebook;
    const injectedContents = [GLOBAL, CARD_BOOK, CHAT_BOOK]
      .flatMap((book) => book.entries.map((entry) => entry.content))
      .filter((content) => assembled.messages.some((message) => message.content.includes(content)));

    results.push({ round, playerInput, report, injectedContents, reply });

    console.log(
      `[${round}/3] 注入 ${report?.injected}/${report?.matched} · 丢 ${report?.dropped} · ` +
        `${report?.tokens}/${report?.tokenCap} token`,
    );
    console.log(
      `      档位 常驻${report?.byPriority.constant} 场景${report?.byPriority.scene} ` +
        `玩家${report?.byPriority.player} 背景${report?.byPriority.background} · ` +
        `来源 全局${report?.bySource.global} 角色${report?.bySource.card} 聊天${report?.bySource.chat}`,
    );
    for (const content of injectedContents) {
      console.log(`      · ${content.slice(0, 24)}…`);
    }
    console.log(`      正文 ${reply.replace(/\s+/g, "").length} 字`);
  }

  // 预算压到很小：看它是不是先丢背景、保住常驻
  const squeezed = assemble({
    card: CARD,
    lorebooks: {
      global: GLOBAL,
      card: { ...CARD_BOOK, entries: [...CARD_BOOK.entries, ...BULK.entries], tokenCap: 90 },
      chat: CHAT_BOOK,
    },
    history: [{ role: "user", content: "后院的门怎么锁着？旅店从前是驿站吗？" }],
    seed: 11,
    turn: 3,
    userName: "你",
    budget: planBudget(16_000, 1024),
  });

  console.log("");
  console.log("—— 预算收紧后（tokenCap 90）——");
  const tight = squeezed.budget.lorebook;
  console.log(`注入 ${tight?.injected}/${tight?.matched} · 丢 ${tight?.dropped} · ${tight?.tokens} token`);
  console.log(
    `档位 常驻${tight?.byPriority.constant} 场景${tight?.byPriority.scene} ` +
      `玩家${tight?.byPriority.player} 背景${tight?.byPriority.background}`,
  );
  // 只看 system 消息：玩家输入里也提到了「驿站」，用全文匹配会把自己算成命中
  const systemText = squeezed.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const keptConstant = systemText.includes("没有魔法");
  const keptBulk = systemText.includes("从前是驿站");
  console.log(`常驻规则保住了：${keptConstant ? "是" : "否"} · 超长背景被丢了：${keptBulk ? "否" : "是"}`);

  const payload = {
    model: MODEL,
    generatedAt: new Date().toISOString(),
    note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
    sources: {
      global: GLOBAL.entries.length,
      card: CARD_BOOK.entries.length,
      chat: CHAT_BOOK.entries.length,
    },
    rounds: results,
    squeezed: {
      report: tight,
      keptConstant,
      droppedBulk: !keptBulk,
    },
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`已写入 ${OUT}`);
}

await main();
