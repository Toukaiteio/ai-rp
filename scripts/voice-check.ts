/**
 * 角色声音的真机检查（Phase 9）。
 *
 * 核心问题：同一张卡、同一段对话，加上声音档案之后对白有没有真的变？
 *
 * 做法是 A/B：同一个角色跑两遍，一遍不带声音（只有 personality），
 * 一遍带声音。用可数的指标比，不靠感觉——
 * 对白平均长度、最长一句、省略主语的句子比例、是否出现口头禅。
 *
 * 输出 doc/phase9-voice-check.json。Key 只从环境变量读。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/voice-check.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble, planBudget } from "@/lib/prompt";
import type { ChatMessage } from "@/lib/prompt/types";
import { parseRawBlocks } from "@/lib/blocks";
import { createOpenAIProvider } from "@/lib/providers/openai";
import { describeVoice, type CharacterVoiceProfile } from "@/lib/voice";

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = process.env.BASELINE_MODEL ?? "dots3-note-prev";
const BASE_URL = process.env.BASELINE_BASE_URL ?? "https://router.dys.asia/v1";
const OUT = process.env.VOICE_OUT ?? path.join("doc", "phase9-voice-check.json");

if (!API_KEY) {
  console.error('缺少 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 });

/**
 * 声音档案：话短、先回避、情绪收着、紧张时句子更碎、不主动提自己的过去。
 * 这些设定本身就是要「能被看出来」的，所以 A/B 对比才说明问题。
 */
const VOICE: CharacterVoiceProfile = {
  sentenceLength: "short",
  directness: "indirect",
  emotionalExpression: "restrained",
  vocabulary: ["……", "没什么"],
  habits: ["习惯省略主语", "紧张时句子更碎"],
  avoidances: ["自己的过去", "绷带"],
  sampleLines: ["……没什么。", "你又没事干了？"],
};

const CARD = {
  name: "深月风花",
  description: "同班同学。左手缠着绷带，说是烫伤，从不摘。",
  personality: "别扭，嘴硬。被人盯久了会先瞪回去，再别开脸。",
  scenario: "午休的教室。窗开着，走廊里有人跑过。",
};

/** 三轮追问，第二轮直接踩她的避讳。 */
const PLAYER_TURNS = [
  "我走过去，问她看的是什么书。",
  "我问她的手是不是还没好，什么时候弄的。",
  "我说那我陪你在这儿待着吧。",
];

interface Line {
  text: string;
  length: number;
  /**
   * 句子是不是以代词开头。
   *
   * 注意它**不是**「有没有省略主语」的可靠代理：她对着玩家说
   * 「你又没事干了？」时，「你」是正当的主语，不是没省略。
   * 所以这个数只当参考，下降不代表设定没生效。
   */
  startsWithPronoun: boolean;
}

interface RunResult {
  label: string;
  voice: string;
  turns: Array<{
    playerInput: string;
    lines: Line[];
    avgLength: number;
    maxLength: number;
    pronounStartRatio: number;
    catchphrases: string[];
    reply: string;
  }>;
  avgLineLength: number;
  pronounStartRatio: number;
  catchphraseHits: number;
}

const SUBJECT_START = /^[我你他她它们这那]/;

function measure(reply: string) {
  const blocks = parseRawBlocks(reply);
  const lines: Line[] = blocks
    .filter((block) => block.kind === "dlg")
    .map((block) => {
      const text = block.text.replace(/\s+/g, "");
      return { text, length: text.length, startsWithPronoun: SUBJECT_START.test(text) };
    });
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  return {
    lines,
    avgLength: lines.length ? Math.round(total / lines.length) : 0,
    maxLength: lines.reduce((max, line) => Math.max(max, line.length), 0),
    pronounStartRatio: lines.length
      ? Math.round((lines.filter((line) => line.startsWithPronoun).length / lines.length) * 100) / 100
      : 0,
    catchphrases: VOICE.vocabulary.filter((word) => reply.includes(word)),
  };
}

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
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

async function run(label: string, withVoice: boolean): Promise<RunResult> {
  const voiceText = withVoice ? describeVoice(VOICE) : "";
  let history: ChatMessage[] = [];
  const turns: RunResult["turns"] = [];

  for (const playerInput of PLAYER_TURNS) {
    history = [...history, { role: "user", content: `<player>${playerInput}</player>` }];
    const assembled = assemble({
      card: withVoice ? { ...CARD, voice: VOICE } : CARD,
      history,
      seed: 3,
      turn: 0,
      userName: "你",
      budget: planBudget(16_000, 1024),
    });
    const reply = await complete(assembled.messages, 0.9, 1024);
    history = [...history, { role: "assistant", content: reply }];

    const measured = measure(reply);
    turns.push({ playerInput, ...measured, reply });
  }

  const allLines = turns.flatMap((turn) => turn.lines);
  const total = allLines.reduce((sum, line) => sum + line.length, 0);
  return {
    label,
    voice: voiceText,
    turns,
    avgLineLength: allLines.length ? Math.round(total / allLines.length) : 0,
    pronounStartRatio: allLines.length
      ? Math.round((allLines.filter((line) => line.startsWithPronoun).length / allLines.length) * 100) / 100
      : 0,
    catchphraseHits: turns.reduce((sum, turn) => sum + turn.catchphrases.length, 0),
  };
}

async function main(): Promise<void> {
  console.log(`角色声音 A/B 检查：${PLAYER_TURNS.length} 轮 × 2 组 · ${MODEL}`);
  console.log("");
  console.log(`声音档案压成的一句话：${describeVoice(VOICE)}`);
  console.log("");

  const without = await run("不带声音", false);
  const withVoice = await run("带声音", true);

  for (const result of [without, withVoice]) {
    console.log(`—— ${result.label} ——`);
    console.log(
      `对白 ${result.turns.reduce((sum, turn) => sum + turn.lines.length, 0)} 句 · ` +
        `平均 ${result.avgLineLength} 字 · 最长 ${Math.max(...result.turns.map((turn) => turn.maxLength))} 字 · ` +
        `口头禅命中 ${result.catchphraseHits}`,
    );
    for (const turn of result.turns) {
      console.log(`  [${turn.playerInput.slice(0, 14)}…]`);
      for (const line of turn.lines) {
        console.log(`    ${String(line.length).padStart(2)}字 ${line.text.slice(0, 44)}`);
      }
    }
    console.log("");
  }

  const delta = {
    avgLineLength: withVoice.avgLineLength - without.avgLineLength,
    longestLine:
      Math.max(...withVoice.turns.map((turn) => turn.maxLength)) -
      Math.max(...without.turns.map((turn) => turn.maxLength)),
    catchphraseHits: withVoice.catchphraseHits - without.catchphraseHits,
  };
  console.log("—— 差异（带声音 − 不带）——");
  console.log(
    `平均句长 ${delta.avgLineLength >= 0 ? "+" : ""}${delta.avgLineLength} 字 · ` +
      `最长一句 ${delta.longestLine >= 0 ? "+" : ""}${delta.longestLine} 字 · ` +
      `口头禅 ${delta.catchphraseHits >= 0 ? "+" : ""}${delta.catchphraseHits}`,
  );

  const payload = {
    model: MODEL,
    generatedAt: new Date().toISOString(),
    note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
    voiceProfile: VOICE,
    voiceSentence: describeVoice(VOICE),
    without,
    withVoice,
    delta,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`已写入 ${OUT}`);
}

await main();
