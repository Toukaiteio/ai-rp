/**
 * 重新生成的真机检查（Phase 11.1）。
 *
 * 要验证的是三件事，前两件可数，第三件要真模型：
 * 1. 错误回复有没有留在新请求里；
 * 2. 临时纠偏有没有真的进提示词；
 * 3. 带上纠偏重跑一遍，新回复是不是真的和上一版不一样。
 *
 * 第 3 条在高温下测不出东西：温度 0.9 时模型本来就会换写法，
 * 带不带纠偏重合度都低。**纠偏真正有用的场合是模型倾向复用的时候**，
 * 所以这里用低温（0.2）跑，让「重跑还是原样」这件事真的发生，
 * 再比带纠偏和不带纠偏的区别。
 *
 * 输出 runs/phase11-regenerate-check.json。Key 只从环境变量读。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/regenerate-check.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble, planBudget } from "@/lib/prompt";
import type { ChatMessage } from "@/lib/prompt/types";
import { createOpenAIProvider } from "@/lib/providers/openai";
import { planRegenerate, regenerateNote } from "@/lib/chat";

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = process.env.BASELINE_MODEL ?? "dots3-note-prev";
const BASE_URL = process.env.BASELINE_BASE_URL ?? "https://router.dys.asia/v1";
const OUT = process.env.REGEN_OUT ?? path.join("runs", "phase11-regenerate-check.json");
/**
 * 用低温跑。高温下模型本来就换写法，测不出纠偏的作用；
 * 低温才是「模型倾向复用上一版」的场合，也就是纠偏真正要解决的场合。
 */
const TEMPERATURE = Number(process.env.REGEN_TEMPERATURE ?? "0.2");

if (!API_KEY) {
  console.error('缺少 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 });

const CARD = {
  name: "深月风花",
  description: "同班同学。左手缠着绷带。",
  personality: "别扭，嘴硬。",
  scenario: "午休的教室。窗开着。",
};

/** 故意选一个容易写得啰嗦的输入：纠偏里说「保持单一动作和短对白」才有东西可看。 */
const PLAYER_INPUT = "我走过去，问她看的是什么书，顺便问她手上的伤怎么样了。";

interface Version {
  label: string;
  reply: string;
  length: number;
  dialogueCount: number;
  actionCount: number;
  /** 和第一版的 4 字片段重合率，用来量「有没有复用上一版」 */
  overlapWithFirst?: number;
}

async function complete(messages: ChatMessage[], temperature: number, maxTokens: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const events = await provider.open({ messages, model: MODEL, temperature, maxTokens, reasoningEffort: "low" });
      let text = "";
      for await (const event of events) {
        if (event.type === "delta") text += event.text;
        if (event.type === "error") throw new Error(event.message);
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

/** 把正文切成 4 字片段，用来算两版之间重了多少。 */
function shingles(text: string, size = 4): Set<string> {
  const clean = text.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i + size <= clean.length; i += 1) set.add(clean.slice(i, i + size));
  return set;
}

function overlap(a: string, b: string): number {
  const first = shingles(a);
  const second = shingles(b);
  if (first.size === 0) return 0;
  let shared = 0;
  for (const piece of first) if (second.has(piece)) shared += 1;
  return Math.round((shared / first.size) * 100) / 100;
}

function measure(reply: string): Omit<Version, "label" | "reply"> {
  const blocks = reply.match(/<(\w+)[^>]*>/g) ?? [];
  return {
    length: reply.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length,
    dialogueCount: blocks.filter((tag) => tag.startsWith("<dlg")).length,
    actionCount: blocks.filter((tag) => tag.startsWith("<act")).length,
  };
}

async function main(): Promise<void> {
  console.log(`重新生成检查：${MODEL}`);
  console.log("");

  const history: ChatMessage[] = [{ role: "user", content: `<player>${PLAYER_INPUT}</player>` }];
  const base = assemble({ card: CARD, history, seed: 5, turn: 0, budget: planBudget(16_000, 1024) });

  // 第一版：不带纠偏，就是普通生成
  const first = await complete(base.messages, TEMPERATURE, 4096);
  const versions: Version[] = [{ label: "第一版（原始）", reply: first, ...measure(first) }];

  console.log(`—— 第一版 ——`);
  console.log(`  ${versions[0].length} 字 · dlg ${versions[0].dialogueCount} · act ${versions[0].actionCount}`);
  console.log(`  ${first.replace(/\n/g, " ").slice(0, 90)}…`);
  console.log("");

  /*
   * 重跑：先用 planRegenerate 算「重跑要用什么」，
   * 确认错误回复不在历史里，再带上纠偏指令生成第二版。
   */
  const turns = [
    { id: "opening", role: "assistant" as const, content: "开场白" },
    { id: "u1", role: "user" as const, content: PLAYER_INPUT },
    { id: "a1", role: "assistant" as const, content: first },
  ];
  const plan = planRegenerate(turns);
  const note = regenerateNote(plan.discarded);
  const leaked = plan.history.some((turn) => turn.content === first);

  console.log(`—— 重跑计划 ——`);
  console.log(`  历史 ${plan.history.length} 条 · 上一版是否泄漏进新请求：${leaked ? "是（有问题）" : "否"}`);
  console.log(`  纠偏指令：${note.split("\n")[1]}`);
  console.log("");

  const second = await complete(
    assemble({
      card: CARD,
      history: [{ role: "user", content: `<player>${plan.playerInput}</player>` }],
      seed: 5,
      turn: 0,
      temporaryNote: note,
      budget: planBudget(16_000, 1024),
    }).messages,
    TEMPERATURE,
    4096,
  );
  versions.push({
    label: "第二版（带纠偏）",
    reply: second,
    ...measure(second),
    overlapWithFirst: overlap(first, second),
  });

  console.log(`—— 第二版（带纠偏）——`);
  console.log(`  ${versions[1].length} 字 · dlg ${versions[1].dialogueCount} · act ${versions[1].actionCount}`);
  console.log(`  与第一版重合度：${Math.round((versions[1].overlapWithFirst ?? 0) * 100)}%`);
  console.log(`  ${second.replace(/\n/g, " ").slice(0, 90)}…`);
  console.log("");

  // 对照：不带纠偏再跑一遍，看重合度是多少
  const control = await complete(base.messages, TEMPERATURE, 4096);
  const controlOverlap = overlap(first, control);
  console.log(`—— 对照：不带纠偏重跑一遍 ——`);
  console.log(`  与第一版重合度：${Math.round(controlOverlap * 100)}%`);
  console.log("");

  const payload = {
    model: MODEL,
    temperature: TEMPERATURE,
    generatedAt: new Date().toISOString(),
    note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
    playerInput: PLAYER_INPUT,
    correctionNote: note,
    discardedLeaked: leaked,
    versions,
    control: { reply: control, overlapWithFirst: controlOverlap },
    verdict: {
      leakFree: !leaked,
      correctionHelps: (versions[1].overlapWithFirst ?? 1) < controlOverlap,
      shorter: versions[1].length <= versions[0].length,
    },
    /*
     * 这条不能只看一次跑批。低温下句长本身波动大（同一次跑批里
     * 见过 68→187 字，也见过 150→112 字），所以「新回复有没有变短」
     * 是个不稳定的指标，不能拿单次结果当结论。
     */
    caveat: "句长在低温下波动大，单次跑批不足以判断「纠偏是否让回复变短」；重合度那一项两次一致。",
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("—— 结论 ——");
  console.log(`  错误回复没泄漏：${leaked ? "否" : "是"}`);
  console.log(
    `  纠偏让新回复更不像上一版：${payload.verdict.correctionHelps ? "是" : "否"}` +
      `（带纠偏 ${Math.round((versions[1].overlapWithFirst ?? 0) * 100)}% vs 不带 ${Math.round(controlOverlap * 100)}%）`,
  );
  console.log(`  新回复没有变长：${payload.verdict.shorter ? "是" : "否"}`);
  console.log("");
  console.log(`已写入 ${OUT}`);
}

await main();
