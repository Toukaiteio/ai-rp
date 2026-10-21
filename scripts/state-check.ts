/**
 * 场景状态的真机检查。
 *
 * 走真实的导演阶段，看它给出的 statePatch 能不能用：
 * 1. 有没有真的返回状态变化，字段是否合法；
 * 2. 可信度标得对不对（不该把猜测写成 confirmed）；
 * 3. 连着跑几轮，状态会不会漂（地点、在场的人被无依据地改掉）。
 *
 * 输出 doc/phase5-state-check.json。Key 只从环境变量读。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/state-check.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble, buildDirectorMessages, parseTurnPlan, planBudget } from "@/lib/prompt";
import type { ChatMessage } from "@/lib/prompt/types";
import {
  applyScenePatch,
  emptySceneState,
  formatSceneState,
  isEmptySceneState,
  sanitizePatch,
  type SceneState,
  type StateChange,
  type StateConflict,
} from "@/lib/scene";
import {
  applyThreadPatch,
  DEFAULT_THREAD_LIMIT,
  formatThreads,
  normalizeThreads,
  selectThreads,
  type StoryThread,
  type ThreadUpdate,
} from "@/lib/story";
import { createOpenAIProvider } from "@/lib/providers/openai";

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = process.env.BASELINE_MODEL ?? "dots3-note-prev";
const BASE_URL = process.env.BASELINE_BASE_URL ?? "https://router.dys.asia/v1";
const OUT = process.env.STATE_OUT ?? path.join("doc", "phase5-state-check.json");
/** 连跑几轮，用来看状态会不会漂。 */
const ROUNDS = Number(process.env.STATE_ROUNDS ?? "6");

if (!API_KEY) {
  console.error('缺少 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 });

const CARD = {
  name: "深月风花",
  description:
    "同班同学。左手缠着绷带，说是烫伤，从不摘。坐在靠窗倒数第二个位子，午休时一个人看文库本。",
  personality: "别扭，嘴硬。被人盯久了会先瞪回去，再别开脸。被追问绷带的事会立刻转移话题。",
  scenario: "午休的教室。窗开着，走廊里有人跑过。",
};

/** 一段连续对话，用来驱动状态变化。 */
const PLAYER_TURNS = [
  "我走过去，问她看的是什么书。",
  "我在她前面的位子坐下，说我也没吃午饭。",
  "我问她要不要一起去小卖部。",
  "我说她的手是不是还没好。",
  "我说那我陪你在这儿待着。",
  "我问她放学后有没有事。",
];

interface RoundResult {
  round: number;
  playerInput: string;
  raw: string;
  patch: Record<string, unknown> | null;
  changes: StateChange[];
  conflicts: StateConflict[];
  state: SceneState;
  /** 这一轮实际注入给模型的剧情线，以及挑选理由 */
  injected: Array<{ title: string; reason: string }>;
  /** 这一轮剧情线的变化 */
  threadPatch: unknown;
  threads: StoryThread[];
  threadUpdate: { created: string[]; updated: string[]; resolved: string[]; blocked: string[] };
  reply: string;
}

async function complete(messages: ChatMessage[], temperature: number, maxTokens: number) {
  const events = await provider.open({ messages, model: MODEL, temperature, maxTokens });
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return text;
}

async function main(): Promise<void> {
  console.log(`场景状态 + 剧情线检查：${ROUNDS} 轮 · ${MODEL}`);
  console.log("");

  let history: ChatMessage[] = [];
  let state = emptySceneState(Date.now());
  let threads: StoryThread[] = [];
  const results: RoundResult[] = [];

  for (let round = 1; round <= ROUNDS; round += 1) {
    const playerInput = PLAYER_TURNS[(round - 1) % PLAYER_TURNS.length];
    history = [...history, { role: "user", content: `<player>${playerInput}</player>` }];

    // 剧情线：先按策略挑出这一轮要注入的几条，再组装
    const picked = selectThreads(threads, {
      playerInput,
      recentText: history.slice(-6).map((message) => message.content).join("\n"),
      presentCharacters: state.presentCharacters,
      location: state.location,
      turn: round,
    });

    const assembled = assemble({
      card: CARD,
      history,
      seed: 1,
      turn: round - 1,
      userName: "你",
      ...(isEmptySceneState(state) ? {} : { sceneState: state }),
      ...(threads.length ? { storyThreads: threads } : {}),
      budget: planBudget(16_000, 1024),
    });

    // 导演阶段：顺便给出状态变化和剧情线变化
    const directorText = await complete(buildDirectorMessages(assembled.messages), 0.2, 420);
    const plan = parseTurnPlan(directorText);
    const patch = plan?.statePatch ? sanitizePatch(plan.statePatch) : null;
    const update = applyScenePatch(state, patch, round, { now: Date.now() });
    state = update.state;

    const threadUpdate: ThreadUpdate = applyThreadPatch(
      threads,
      plan?.threadPatch ?? [],
      round,
    );
    threads = threadUpdate.threads;

    // 正文：和线上一样，把计划交给讲述者
    const reply = await complete(
      plan
        ? [...assembled.messages, { role: "system", content: JSON.stringify(plan) }]
        : assembled.messages,
      0.9,
      1024,
    );
    history = [...history, { role: "assistant", content: reply }];

    results.push({
      round,
      playerInput,
      raw: directorText,
      patch: (patch ?? null) as Record<string, unknown> | null,
      changes: update.changes,
      conflicts: update.conflicts,
      state,
      injected: picked.map((item) => ({ title: item.thread.title, reason: item.reason })),
      threadPatch: plan?.threadPatch ?? null,
      threads,
      threadUpdate: {
        created: threadUpdate.created.map((item) => item.title),
        updated: threadUpdate.updated.map((item) => item.title),
        resolved: threadUpdate.resolved.map((item) => item.title),
        blocked: threadUpdate.blocked.map((item) => item.title),
      },
      reply,
    });

    const summary = update.changes
      .map((change) => `${change.key}:${change.status[0]}`)
      .join(" ") || "（无变化）";
    const threadSummary = [
      threadUpdate.created.length ? `新 ${threadUpdate.created.length}` : "",
      threadUpdate.resolved.length ? `收线 ${threadUpdate.resolved.length}` : "",
      threadUpdate.blocked.length ? `挡复活 ${threadUpdate.blocked.length}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `[${round}/${ROUNDS}] ${playerInput.slice(0, 16)}…  ` +
        `状态 ${update.changes.length}(挡${update.conflicts.length}) · ` +
        `注入 ${picked.length} 条 · ${threadSummary || "无剧情线变化"} · ${summary}`,
    );
    for (const conflict of update.conflicts) {
      console.log(`        - 挡下：${conflict.key} 想从「${conflict.current}」改成「${conflict.proposed}」`);
    }
    if (picked.length > 0) {
      console.log(`        - 注入：${picked.map((item) => `${item.thread.title}(${item.reason})`).join("，")}`);
    }
  }

  const allChanges = results.flatMap((result) => result.changes);
  const byStatus = { confirmed: 0, inferred: 0, uncertain: 0 };
  for (const change of allChanges) byStatus[change.status] += 1;
  const conflicts = results.flatMap((result) => result.conflicts);
  const created = results.flatMap((result) => result.threadUpdate.created);
  const resolved = results.flatMap((result) => result.threadUpdate.resolved);
  const blocked = results.flatMap((result) => result.threadUpdate.blocked);
  const injected = results.flatMap((result) => result.injected);
  const openThreads = threads.filter((thread) => thread.status === "open");

  console.log("");
  console.log("—— 汇总 ——");
  console.log(`总变化 ${allChanges.length} 处 · 被挡下 ${conflicts.length} 处`);
  console.log(
    `可信度分布：confirmed ${byStatus.confirmed} · inferred ${byStatus.inferred} · uncertain ${byStatus.uncertain}`,
  );
  console.log(`没有状态变化的轮次 ${results.filter((r) => r.changes.length === 0).length}`);
  console.log("");
  console.log(
    `剧情线：新登记 ${created.length} · 收线 ${resolved.length} · 挡复活 ${blocked.length} · 现在开着 ${openThreads.length}`,
  );
  console.log(
    `每轮注入条数：${results.map((result) => result.injected.length).join("/")}（上限 ${DEFAULT_THREAD_LIMIT}）`,
  );
  console.log(`注入理由分布：${countReasons(injected)}`);
  console.log("");
  console.log("最终状态：");
  console.log(formatSceneState(state));
  console.log("");
  console.log("还没交代完的线：");
  console.log(formatThreads(openThreads.map((thread) => ({ thread, reason: "", score: 0 }))) || "（没有）");

  const payload = {
    model: MODEL,
    rounds: ROUNDS,
    generatedAt: new Date().toISOString(),
    note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
    summary: {
      changes: allChanges.length,
      conflicts: conflicts.length,
      byStatus,
      emptyRounds: results.filter((r) => r.changes.length === 0).length,
      threads: {
        created: created.length,
        resolved: resolved.length,
        blocked: blocked.length,
        open: openThreads.length,
        injectedPerRound: results.map((result) => result.injected.length),
        reasons: countReasons(injected),
      },
    },
    finalState: state,
    finalThreads: normalizeThreads(threads),
    results,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`已写入 ${OUT}`);
}

function countReasons(items: Array<{ reason: string }>): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const reason of item.reason.split("·").filter(Boolean)) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([reason, count]) => `${reason} ${count}`).join(" · ") || "（无）";
}

await main();
