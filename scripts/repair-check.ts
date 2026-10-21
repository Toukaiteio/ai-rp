/**
 * 自动修复的真机检查。
 *
 * 用几条故意写坏的候选回复，跑一遍「校验 → 修复 → 再校验」，
 * 回答三个问题：
 * 1. 修复到底能不能把硬错误修掉；
 * 2. 修完有没有偷偷改写剧情（锚点词还在不在）；
 * 3. 有没有扩写（修复后比原文长多少）。
 *
 * 输出 doc/phase2-repair-check.json。Key 只从环境变量读，不写进文件。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/repair-check.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRepairMessages, extractRepairedText } from "@/lib/engine/repair";
import { resolveGeneration, validateResponseBlocks } from "@/lib/engine/validate";
import { checkGeneration } from "@/lib/engine/report";
import type { GenerationResult } from "@/lib/engine/types";
import { createOpenAIProvider } from "@/lib/providers/openai";

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = process.env.BASELINE_MODEL ?? "dots3-note-prev";
const BASE_URL = process.env.BASELINE_BASE_URL ?? "https://router.dys.asia/v1";
const OUT = process.env.REPAIR_OUT ?? path.join("doc", "phase2-repair-check.json");

if (!API_KEY) {
  console.error('缺少 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 });

interface Fixture {
  id: string;
  title: string;
  /** 这一轮玩家说了什么 */
  playerInput: string;
  /** 故意写坏的候选回复 */
  candidate: string;
  /**
   * 修好之后必须还在的剧情锚点。用来查「有没有改写剧情」。
   * 只放和违规部分无关的事实——被删掉的那部分是违规内容，本来就不该留。
   */
  anchors: string[];
  /** 违规内容：允许被删掉，删了不算改剧情。列在这里是为了看清楚修复动了什么。 */
  mayDrop: string[];
}

const CARD = "林晚晴";
const KNOWN = ["林晚晴"];

const FIXTURES: Fixture[] = [
  {
    id: "player-action",
    title: "旁白里替玩家坐下",
    playerInput: "我推门进来，把伞靠在墙边。",
    candidate:
      "<narr>壁炉里只剩一层暗红的炭，风从门缝钻进来。你坐下，把湿外套搭在椅背上。她从账本上抬起眼，没立刻说话。</narr>" +
      '<dlg who="林晚晴">住店？先付钱。</dlg>',
    anchors: ["壁炉", "账本", "住店", "先付钱"],
    mayDrop: ["你坐下", "湿外套"],
  },
  {
    id: "pronoun-who",
    title: "who 写成代词",
    playerInput: "我把伞靠在墙边。",
    candidate:
      "<narr>雨声贴着窗纸，一层一层压下来。</narr>" +
      '<dlg who="她">住店？先付钱。</dlg>',
    anchors: ["雨声", "住店", "先付钱"],
    mayDrop: [],
  },
  {
    id: "pseudo-tool",
    title: "把记忆调用写成了标签",
    playerInput: "我问她这店开了多少年。",
    candidate:
      '<narr>她把炭笔搁在账页边上，没抬头。</narr>' +
      '<remember_place name="晚星旅店">一楼酒堂，壁炉快灭了</remember_place>' +
      '<dlg who="林晚晴">记不清了。招牌比店还老。</dlg>',
    anchors: ["炭笔", "招牌", "记不清"],
    mayDrop: ["remember_place", "晚星旅店"],
  },
  {
    id: "dlg-markup",
    title: "对白里混进 JSON",
    playerInput: "我问她还有没有房间。",
    candidate:
      '<dlg who="林晚晴">有。{"room":"上房","price":20} 先付钱。</dlg>',
    anchors: ["有", "先付钱"],
    mayDrop: ["room", "price"],
  },
  {
    id: "plain-text",
    title: "整段没有块标记",
    playerInput: "我说我不急着住，先坐会儿。",
    candidate:
      "壁炉里的火塌了一角，她拿火钳拨了拨。她没抬眼，只说了句先付钱。雨还在下。",
    anchors: ["壁炉", "火钳", "先付钱", "雨"],
    mayDrop: [],
  },
  {
    id: "mixed",
    title: "一次踩中三条硬错误",
    playerInput: "我把湿外套挂在门边。",
    candidate:
      "<narr>火光矮下去半截。你点了点头，把外套挂好。她看了你一眼。</narr>" +
      '<act who="她">她低声说「挂那儿」。</act>' +
      '<dlg who="王掌柜">别滴水。</dlg>',
    anchors: ["火光", "看了你一眼"],
    /*
     * 这三处必须消失：替玩家点头、替玩家挂外套、没出场过的王掌柜。
     * 「别滴水」这句不算——按 2.1 的修复目标，who 不对时可以「恢复正确的 who」，
     * 把这句话改挂到角色卡上的角色名下是允许的，所以它不在 mayDrop 里。
     */
    mayDrop: ["点了点头", "外套", "王掌柜"],
  },
];

interface FixtureResult {
  id: string;
  title: string;
  before: { decision: string; reason: string; issues: string[] };
  after: { decision: string; reason: string; issues: string[] };
  status: GenerationResult["status"];
  /** 修复后的正文（合成用例，可以落盘） */
  repaired?: string;
  /** 原文长度与修复后长度 */
  lengths: { before: number; after: number; ratio: number };
  /** 剧情锚点还剩下几个 */
  anchors: { kept: string[]; lost: string[] };
  /** 本该被删掉的违规内容里，还有哪些留在修复结果里 */
  leftover: string[];
  /** 这次修复算不算合格：硬错误清零 + 锚点全在 + 违规内容删干净 + 没有明显扩写 */
  ok: boolean;
  note?: string;
}

async function complete(messages: ReturnType<typeof buildRepairMessages>): Promise<string> {
  const events = await provider.open({ messages, model: MODEL, temperature: 0.2, maxTokens: 1024 });
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return text;
}

function visibleLength(text: string): number {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, "").length;
}

async function runFixture(fixture: Fixture): Promise<FixtureResult> {
  const options = { cardName: CARD, userName: "你", knownCharacters: KNOWN, playerInput: fixture.playerInput };
  const before = validateResponseBlocks(fixture.candidate, options);
  const base: FixtureResult = {
    id: fixture.id,
    title: fixture.title,
    before: {
      decision: before.decision,
      reason: before.reason,
      issues: before.issues.map((issue) => issue.code),
    },
    after: { decision: "", reason: "", issues: [] },
    status: "rejected",
    lengths: { before: visibleLength(fixture.candidate), after: 0, ratio: 0 },
    anchors: { kept: [], lost: [...fixture.anchors] },
    leftover: [],
    ok: false,
  };

  if (before.decision !== "rejected") {
    return { ...base, note: "这条候选没有硬错误，跳过（fixture 写错了）" };
  }

  let repairedText = "";
  try {
    repairedText = extractRepairedText(
      await complete(
        buildRepairMessages({
          candidate: fixture.candidate,
          playerInput: fixture.playerInput,
          cardName: CARD,
          knownCharacters: KNOWN,
          issues: before.hardIssues,
        }),
      ),
    );
  } catch (error) {
    return { ...base, note: `修复请求失败：${error instanceof Error ? error.message : String(error)}` };
  }

  if (!repairedText) return { ...base, note: "修复模型没有返回内容" };

  const after = validateResponseBlocks(repairedText, options);
  const result = resolveGeneration(after, {
    report: checkGeneration({ raw: repairedText, ...options, now: Date.now() }),
    repairAttempted: true,
    repairSucceeded: after.decision !== "rejected",
  });

  const afterLength = visibleLength(repairedText);
  const kept = fixture.anchors.filter((anchor) => repairedText.includes(anchor));
  const lost = fixture.anchors.filter((anchor) => !repairedText.includes(anchor));
  // 违规内容被删掉是应该的，留着才说明修复没做干净
  const leftover = fixture.mayDrop.filter((part) => repairedText.includes(part));
  const ratio = afterLength / Math.max(1, base.lengths.before);

  return {
    ...base,
    after: {
      decision: after.decision,
      reason: after.reason,
      issues: after.issues.map((issue) => issue.code),
    },
    status: result.status,
    repaired: repairedText,
    lengths: { before: base.lengths.before, after: afterLength, ratio: Number(ratio.toFixed(2)) },
    anchors: { kept, lost },
    leftover,
    ok: result.status !== "rejected" && lost.length === 0 && leftover.length === 0 && ratio <= 1.4,
    ...(lost.length > 0 ? { note: `丢了锚点：${lost.join("、")}` } : {}),
    ...(leftover.length > 0 ? { note: `违规内容没删干净：${leftover.join("、")}` } : {}),
    ...(ratio > 1.4 ? { note: `明显扩写：${base.lengths.before} → ${afterLength} 字` } : {}),
  };
}

const results: FixtureResult[] = [];
console.log(`自动修复检查：${FIXTURES.length} 条坏候选 · ${MODEL}`);
console.log("");

for (const [index, fixture] of FIXTURES.entries()) {
  const started = Date.now();
  const result = await runFixture(fixture);
  results.push(result);
  const mark = result.ok ? "OK  " : "FAIL";
  console.log(
    `[${index + 1}/${FIXTURES.length}] ${mark} ${fixture.id}  ` +
      `${result.before.decision} → ${result.after.decision || "-"}  ` +
      `${result.lengths.before}→${result.lengths.after} 字(x${result.lengths.ratio})  ` +
      `锚点 ${result.anchors.kept.length}/${result.anchors.kept.length + result.anchors.lost.length}  ` +
      `${Date.now() - started}ms`,
  );
  if (result.note) console.log(`        - ${result.note}`);
  if (result.after.reason) console.log(`        - 修复后原因：${result.after.reason}`);
  if (result.leftover.length > 0) console.log(`        - 残留：${result.leftover.join("、")}`);
}

const ok = results.filter((result) => result.ok).length;
const repaired = results.filter((result) => result.status !== "rejected").length;
console.log("");
console.log(`—— 汇总 ——`);
console.log(`修复成功 ${repaired}/${results.length} · 合格 ${ok}/${results.length}`);
console.log(`平均长度变化 x${(results.reduce((sum, r) => sum + r.lengths.ratio, 0) / results.length).toFixed(2)}`);
console.log(`锚点丢失 ${results.filter((r) => r.anchors.lost.length > 0).length} 条`);
console.log(`违规内容残留 ${results.filter((r) => r.leftover.length > 0).length} 条`);

const payload = {
  model: MODEL,
  generatedAt: new Date().toISOString(),
  note: "所有候选与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
  summary: {
    fixtures: results.length,
    repaired,
    ok,
    avgRatio: Number((results.reduce((sum, r) => sum + r.lengths.ratio, 0) / results.length).toFixed(2)),
    lostAnchors: results.filter((r) => r.anchors.lost.length > 0).length,
    leftover: results.filter((r) => r.leftover.length > 0).length,
  },
  results,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已写入 ${OUT}`);
