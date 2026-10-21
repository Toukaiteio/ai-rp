/**
 * Phase 0 基线跑批。
 *
 * 把 lib/engine/cases.ts 里的用例逐条喂给真实模型，走和游戏里完全一样的
 * 两步流程（导演计划 → 正文生成），然后对每一轮的输出跑一遍文本引擎检查，
 * 把结果写成 doc/phase0-baseline.json。
 *
 * 这一步的目的不是「证明现在好」，而是留一份可以对比的底：
 * 后面每次改提示词、改解析、改记忆，重跑一次就知道是真变好了还是只是感觉变好了。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/baseline.ts
 *   node ... scripts/baseline.ts --only=act-01-length --keep-text=false
 *
 * Key 只从环境变量读，不进任何输出文件：
 *   $env:YOSEI_API_KEY = "sk-..."   （PowerShell）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_CASES, type BaselineCase } from "@/lib/engine/cases";
import { checkGeneration } from "@/lib/engine/report";
import { resolveGeneration, validateResponseBlocks } from "@/lib/engine/validate";
import type { GenerationReport, GenerationResult, IssueCode } from "@/lib/engine/types";
import { ISSUE_LABELS } from "@/lib/engine/types";
import { assemble, buildDirectorMessages, formatTurnPlan, parseTurnPlan, planBudget } from "@/lib/prompt";
import type { ChatMessage } from "@/lib/prompt/types";
import { createOpenAIProvider } from "@/lib/providers/openai";

/* ------------------------------------------------------------------ 参数 */

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(key, rest.join("=") || "true");
}

const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const PROVIDER_ID = args.get("provider") ?? "yosei-router";
const MODEL = args.get("model") ?? "dots3-note-prev";
const BASE_URL = args.get("base-url") ?? "https://router.dys.asia/v1";
const TEMPERATURE = Number(args.get("temperature") ?? "0.9");
const MAX_TOKENS = Number(args.get("max-tokens") ?? "1024");
const KEEP_TEXT = args.get("keep-text") !== "false";
const ONLY = args.get("only");
const OUT = args.get("out") ?? path.join("doc", "phase0-baseline.json");
const LABEL = args.get("label") ?? "";
/**
 * 给所有用例套一条临时作者注，用来量「作者注到底有没有影响」。
 * 不传就是没有作者注的对照组。
 */
const NOTE = args.get("note") ?? "";

if (!API_KEY) {
  console.error(
    "缺少 API Key。请在环境变量里给一把，脚本不会把它写进任何输出文件：\n" +
      '  $env:YOSEI_API_KEY = "sk-..."',
  );
  process.exit(2);
}

const provider = createOpenAIProvider({
  apiKey: API_KEY,
  baseURL: BASE_URL,
  timeoutMs: 120_000,
});

/* ------------------------------------------------------------------ 单轮 */

interface CaseResult {
  id: string;
  title: string;
  goal: string;
  report: GenerationReport;
  /** 质量门结论：accepted / repaired / rejected */
  status: GenerationResult["status"];
  /** 这一轮推断出来的回合模式 */
  mode: string;
  /** 被拒收的原因 */
  rejectedReason?: string;
  /** 降级后真正会写进历史的正文（accepted 时不重复存） */
  gated?: string;
  /** 和预期不符的地方。空数组表示这一轮符合预期。 */
  mismatches: string[];
  /** 模型这一轮的原始输出。全部是合成用例，不含真实玩家聊天。 */
  raw?: string;
  directorPlan?: string;
}

/** 按游戏里的方式组装提示词：assistant 保留块标记，玩家输入带 <player> 标记。 */
function historyOf(testCase: BaselineCase): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const turn of testCase.history ?? []) history.push({ role: turn.role, content: turn.content });
  history.push({ role: "user", content: `<player>${testCase.playerInput}</player>` });
  return history;
}

async function complete(messages: ChatMessage[], temperature: number, maxTokens: number) {
  const started = Date.now();
  const events = await provider.open({ messages, model: MODEL, temperature, maxTokens });
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return { text, latencyMs: Date.now() - started };
}

async function runCase(testCase: BaselineCase): Promise<CaseResult> {
  const history = historyOf(testCase);
  const assembled = assemble({
    card: {
      name: testCase.card.name,
      description: testCase.card.description,
      personality: testCase.card.personality,
      scenario: testCase.card.scenario,
      mes_example: testCase.card.mes_example,
      post_history_instructions: testCase.card.post_history_instructions,
    },
    history,
    seed: 0,
    turn: (testCase.history?.length ?? 0) / 2,
    userName: "你",
    // 有 --note 就把它当成会话作者注，用来对照实验
    ...(NOTE ? { authorNote: { text: NOTE } } : {}),
    budget: planBudget(16_000, 1024),
  });

  // 第一步：导演计划。失败就退回单阶段，和线上行为一致。
  let directorPlan = "";
  let messages = assembled.messages;
  try {
    const director = await complete(buildDirectorMessages(assembled.messages), 0.2, 420);
    directorPlan = director.text;
    const plan = parseTurnPlan(directorPlan);
    if (plan) messages = [...assembled.messages, { role: "system", content: formatTurnPlan(plan) }];
  } catch {
    // 计划只是质量增强，不因为它失败就中断这一轮
  }

  // 第二步：正文
  const { text, latencyMs } = await complete(messages, TEMPERATURE, MAX_TOKENS);

  const previousReply =
    [...(testCase.history ?? [])].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const knownCharacters = [
    testCase.card.name,
    ...(testCase.knownCharacters ?? []),
    // 历史里出过场的 who 也算已知，和线上 knownCast 的口径一致
    ...(testCase.history ?? []).flatMap((turn) =>
      [...turn.content.matchAll(/who\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    ),
  ];
  const report = checkGeneration({
    raw: text,
    playerInput: testCase.playerInput,
    previousReply,
    cardName: testCase.card.name,
    userName: "你",
    knownCharacters,
    turn: Math.floor((testCase.history?.length ?? 0) / 2) + 1,
    providerId: PROVIDER_ID,
    model: MODEL,
    latencyMs,
  });

  // Phase 1：质量门。跑批要能看出这一轮最终是落地、降级还是被拒收。
  const validation = validateResponseBlocks(text, {
    cardName: testCase.card.name,
    userName: "你",
    knownCharacters,
    playerInput: testCase.playerInput,
    previousReply,
  });
  const result = resolveGeneration(validation, { report });

  return {
    id: testCase.id,
    title: testCase.title,
    goal: testCase.goal,
    report,
    status: result.status,
    mode: assembled.mode,
    ...(result.status === "rejected" ? { rejectedReason: result.reason } : {}),
    ...(result.status === "repaired" ? { gated: result.content } : {}),
    mismatches: compare(testCase, report, result.status),
    ...(KEEP_TEXT ? { raw: text } : {}),
    ...(directorPlan ? { directorPlan } : {}),
  };
}

/** 预期是软断言：跑批只报告差异，不因为差异中断，基线本来就是拿来观察的。 */
function compare(
  testCase: BaselineCase,
  report: GenerationReport,
  status: GenerationResult["status"],
): string[] {
  const problems: string[] = [];
  const present = new Set<IssueCode>(report.issues.map((issue) => issue.code));
  const expect = testCase.expect;

  if (status === "rejected") {
    problems.push(`被质量门拒收：${report.issues.filter((i) => i.severity === "block").map((i) => ISSUE_LABELS[i.code]).join("，")}`);
  }
  for (const code of expect.mustNotFlag ?? []) {
    if (present.has(code)) problems.push(`不该出现却出现：${ISSUE_LABELS[code]}`);
  }
  for (const code of expect.mustFlag ?? []) {
    if (!present.has(code)) problems.push(`预期会出现却没有：${ISSUE_LABELS[code]}`);
  }
  if (expect.verdict && report.verdict !== expect.verdict) {
    problems.push(`判定是 ${report.verdict}，预期 ${expect.verdict}`);
  }
  if (expect.maxResponseLength && report.responseLength > expect.maxResponseLength) {
    problems.push(`正文 ${report.responseLength} 字，超过预期上限 ${expect.maxResponseLength}`);
  }
  if (expect.minDialogue !== undefined && report.dialogueCount < expect.minDialogue) {
    problems.push(`对白只有 ${report.dialogueCount} 段，预期至少 ${expect.minDialogue}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ 跑批 */

function line(text = ""): void {
  console.log(text);
}

async function main(): Promise<void> {
  const cases = ONLY
    ? BASELINE_CASES.filter((item) => item.id === ONLY || item.id.startsWith(ONLY))
    : BASELINE_CASES;

  if (cases.length === 0) {
    console.error(`没有匹配 --only=${ONLY} 的用例`);
    process.exit(2);
  }

  line(`Phase 0 基线：${cases.length} 组用例 · ${PROVIDER_ID} / ${MODEL}`);  line(`提示词版本：${checkGeneration({ raw: "<narr>x</narr>", now: 0 }).promptVersion}`);
  line("");

  const results: CaseResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    const started = Date.now();
    try {
      const result = await runCase(testCase);
      results.push(result);
      const report = result.report;
      const flag =
        result.mismatches.length === 0
          ? "符合预期"
          : `不符 ${result.mismatches.length} 项`;
      line(
        `[${String(index + 1).padStart(2)}/${cases.length}] ${testCase.id}  ` +
          `${report.verdict}/${result.status} [${result.mode}] ${report.blockCount}块 ${report.responseLength}字 ` +
          `act ${report.actCount}(坏${report.invalidActCount}) dlg ${report.dialogueCount} ` +
          `${Date.now() - started}ms · ${flag}`,
      );
      for (const problem of result.mismatches) line(`        - ${problem}`);
      if (result.rejectedReason) line(`        - 拒收原因：${result.rejectedReason}`);
    } catch (error) {
      line(`[${String(index + 1).padStart(2)}/${cases.length}] ${testCase.id}  请求失败：${message(error)}`);
      results.push({
        id: testCase.id,
        title: testCase.title,
        goal: testCase.goal,
        report: checkGeneration({ raw: "", now: Date.now() }),
        status: "rejected",
        mode: "-",
        mismatches: [`请求失败：${message(error)}`],
      });
    }
  }

  const summary = summarize(results);
  line("");
  line("—— 汇总 ——");
  line(
    `轮数 ${summary.rounds} · 合格 ${summary.pass} · 可修复 ${summary.repair} · 不合格 ${summary.reject} · 符合预期 ${summary.matched}`,
  );
  line(
    `质量门：原样落地 ${summary.accepted} · 降级落地 ${summary.repaired} · 拒收 ${summary.rejected}`,
  );
  line(
    `act ${summary.actCount} 个，其中不合格 ${summary.invalidActCount} 个 · ` +
      `对白 ${summary.dialogueCount} 段 · 平均 ${summary.avgLength} 字 · 平均 ${summary.avgLatency}ms`,
  );
  line(
    `替玩家行动 ${summary.playerControl} 轮 · 复读 ${summary.repeated} 轮 · ` +
      `语言切换 ${summary.languageSwitch} 轮 · 人物漂移 ${summary.characterDrift} 轮`,
  );
  if (summary.byCode.length > 0) {
    line("问题分布：");
    for (const [code, count] of summary.byCode) {
      line(`  ${ISSUE_LABELS[code as IssueCode] ?? code}：${count} 轮`);
    }
  }

  const payload = {
    label: LABEL,
    providerId: PROVIDER_ID,
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    promptVersion: checkGeneration({ raw: "", now: 0 }).promptVersion,
    generatedAt: new Date().toISOString(),
    note: "所有文本均为合成测试用例，不含真实玩家聊天；报告不含 API Key。",
    summary,
    results,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  line("");
  line(`已写入 ${OUT}`);
}

function summarize(results: CaseResult[]) {
  const byCode = new Map<string, number>();
  let actCount = 0;
  let invalidActCount = 0;
  let dialogueCount = 0;
  let length = 0;
  let latency = 0;
  let latencyRounds = 0;
  const tally = { pass: 0, repair: 0, reject: 0 };

  for (const result of results) {
    const report = result.report;
    tally[report.verdict] += 1;
    actCount += report.actCount;
    invalidActCount += report.invalidActCount;
    dialogueCount += report.dialogueCount;
    length += report.responseLength;
    if (report.latencyMs !== undefined) {
      latency += report.latencyMs;
      latencyRounds += 1;
    }
    for (const code of new Set(report.issues.map((issue) => issue.code))) {
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
    }
  }

  const rounds = results.length || 1;
  return {
    rounds: results.length,
    matched: results.filter((result) => result.mismatches.length === 0).length,
    pass: tally.pass,
    repair: tally.repair,
    reject: tally.reject,
    accepted: results.filter((result) => result.status === "accepted").length,
    repaired: results.filter((result) => result.status === "repaired").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    actCount,
    invalidActCount,
    dialogueCount,
    avgLength: Math.round(length / rounds),
    avgLatency: latencyRounds === 0 ? 0 : Math.round(latency / latencyRounds),
    playerControl: results.filter((result) => result.report.playerControlViolation).length,
    repeated: results.filter((result) => result.report.repeatedPhraseCount > 0).length,
    languageSwitch: results.filter((result) =>
      result.report.issues.some((issue) => issue.code === "language_switch"),
    ).length,
    characterDrift: results.filter((result) =>
      result.report.issues.some((issue) => issue.code === "character_drift"),
    ).length,
    byCode: [...byCode.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
