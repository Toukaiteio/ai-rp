/**
 * 评测集跑批（Phase 12.2 / 12.3）。
 *
 * 两条路：
 *
 * **离线**（默认，`pnpm test:roleplay`）：不调模型，跑组装 + 检查，
 * 验证 50 组用例的结构指标和装配正确性。改提示词或引擎代码之后先跑这个，
 * 几秒钟出结果，不花钱。
 *
 * **真机**（`--live`）：真的调模型，把三族指标都算出来，
 * 和 `runs/phase12-eval-live.json` 里的基线比，找出退化的项。
 *
 * 输出 runs/phase12-eval.json（离线）或 runs/phase12-eval-live.json（真机）。
 *
 * 用法：
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/eval.ts
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/eval.ts --live
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/eval.ts --category=voice
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble, planBudget } from "@/lib/prompt";
import type { ChatMessage } from "@/lib/prompt/types";
import { regenerateNote } from "@/lib/chat";
import { parseRawBlocks } from "@/lib/blocks";
import { checkGeneration } from "@/lib/engine";
import {
  CATEGORY_LABELS,
  EVAL_CASES,
  EVAL_SEQUENCES,
  allMetrics,
  findRegressions,
  formatMetrics,
  type EvalCase,
  type EvalCategory,
  type EvalSequence,
  type EvalTurn,
  type MetricFamily,
} from "@/lib/eval";
import { emptySceneState, applyScenePatch, isEmptySceneState } from "@/lib/scene";
import { applyThreadPatch, type StoryThread } from "@/lib/story";
import { buildDirectorMessages, DIRECTOR_MAX_TOKENS, formatTurnPlan, parseTurnPlan } from "@/lib/prompt";
import { createOpenAIProvider } from "@/lib/providers/openai";

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(key, rest.join("=") || "true");
}

const LIVE = args.get("live") === "true";
const ONLY = args.get("category");
const API_KEY = process.env.YOSEI_API_KEY ?? process.env.BASELINE_API_KEY ?? "";
const MODEL = args.get("model") ?? "dots3-note-prev";
const BASE_URL = args.get("base-url") ?? "https://router.dys.asia/v1";
const OUT =
  args.get("out") ??
  path.join("runs", LIVE ? (ONLY ? `phase12-eval-live-${ONLY}.json` : "phase12-eval-live.json") : "phase12-eval.json");
/**
 * 只有跑全量时才和基线比。
 *
 * `--category=voice` 跑的是子集，拿它去比全量基线必然「退化」——
 * 那是分母变小造成的，不是真的变差。同理也不能让它覆盖基线文件，
 * 否则下一次全量跑批会拿一个子集当基准。
 */
const COMPARE = !ONLY;
const BASELINE = args.get("baseline") ?? path.join("runs", "phase12-eval-live.json");

const cases = ONLY
  ? EVAL_CASES.filter((item) => item.category === (ONLY as EvalCategory))
  : EVAL_CASES;

if (cases.length === 0) {
  console.error(`没有 category=${ONLY} 的用例。可选：${Object.keys(CATEGORY_LABELS).join("、")}`);
  process.exit(2);
}
if (LIVE && !API_KEY) {
  console.error('真机模式需要 API Key：$env:YOSEI_API_KEY = "sk-..."');
  process.exit(2);
}

const provider = LIVE
  ? createOpenAIProvider({ apiKey: API_KEY, baseURL: BASE_URL, timeoutMs: 120_000 })
  : null;

/** 把用例组装成这一轮的提示词。 */
function buildMessages(item: EvalCase): ChatMessage[] {
  const history: ChatMessage[] = (item.history ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  // 附件按「玩家附带的东西」拼进这一句：离线跑批只关心它有没有进提示词
  const attachmentNote = item.attachment
    ? `\n（附件：${item.attachment.kind === "image" ? "图片" : "文档"}，${item.attachment.note}）`
    : "";
  history.push({ role: "user", content: `<player>${item.playerInput}${attachmentNote}</player>` });

  return assemble({
    card: item.card,
    history,
    seed: 12,
    turn: 0,
    userName: "你",
    // 重新生成那几组带上纠偏指令
    ...(item.regenerate ? { temporaryNote: regenerateNote(item.regenerate.discard) } : {}),
    budget: planBudget(16_000, 1024),
  }).messages;
}

/**
 * 离线检查：验装配，不验内容。
 *
 * 不调模型，所以拿不到正文，也就没法算 12.3 的叙事和连贯性指标。
 * 但它能验一批**只有装配层才知道对不对**的事，而且这几件事正是
 * 改提示词时最容易改坏的：
 *
 * 1. 组装不报错、预算不超；
 * 2. 同样的输入组装两次，指纹和消息完全一致（纯函数，缓存才靠得住）；
 * 3. 回合层里该有的东西都在（act 约束、正向示例、篇幅要求）；
 * 4. 重新生成那几组，被弃用的版本**一个字都没进提示词**（Phase 11.1 的硬规则）；
 * 5. 附件说明真的进了提示词；
 * 6. 语言锁定跟着玩家那一句走；
 * 7. 多角色那几组，卡上的人名都在已知阵容里（who 检查才判得准）。
 */
export interface OfflineCheck {
  caseId: string;
  category: EvalCategory;
  ok: boolean;
  failures: string[];
}

/** 提示词里必须出现的东西。缺一个都说明组装被改坏了。 */
const TURN_LAYER_MARKERS = [
  { text: "本轮状态", why: "回合层的状态段没了" },
];

const CONTRACT_MARKERS = [
  { text: "<act", why: "输出契约里没有 act 的说明" },
  { text: "<dlg", why: "输出契约里没有 dlg 的说明" },
];

function offlineCheck(item: EvalCase): OfflineCheck {
  const failures: string[] = [];
  const first = buildMessages(item);
  const second = buildMessages(item);
  const flat = first.map((message) => message.content).join("\n");

  // 1. 预算：用同一套组装再算一次，确认没超
  const assembled = assembleFor(item);
  if (assembled.budget.used > assembled.budget.max) {
    failures.push(`预算超了：${assembled.budget.used} > ${assembled.budget.max}`);
  }

  // 2. 确定性：同样的输入两次组装必须一模一样，否则缓存会一直失效
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push("两次组装结果不一致，破坏了纯函数约定");
  }
  if (assembled.cacheKey !== assembleFor(item).cacheKey) {
    failures.push("两次组装的前缀指纹不一致");
  }

  // 3. 回合层和输出契约该有的东西
  for (const marker of [...TURN_LAYER_MARKERS, ...CONTRACT_MARKERS]) {
    if (!flat.includes(marker.text)) failures.push(`${marker.why}（缺「${marker.text}」）`);
  }

  // 4. 重新生成：被弃用的版本不能进提示词
  if (item.regenerate) {
    const discarded = item.regenerate.discard.trim();
    if (discarded && flat.includes(discarded)) {
      failures.push("被弃用的上一版泄漏进了提示词");
    }
    // 纠偏指令本身要在
    if (!flat.includes("上一版回复未采用")) failures.push("纠偏指令没有进提示词");
  }

  // 5. 附件说明
  if (item.attachment && !flat.includes(item.attachment.note)) {
    failures.push("附件说明没有进提示词");
  }

  /*
   * 6. 语言锁定。
   *
   * 判据是「锁定段在不在」+「纯语言输入锁对了没有」。
   *
   * 中英混着说那种（lg-03）**故意不判**：检测器按字符数取多数，
   * 「I want a room，就一晚。」会判成拉丁字母语言。这不是明显的错——
   * 混着说的时候本来就说不清该跟哪个。所以只验锁定段在，
   * 不验它锁了哪一个；要改这个行为得先决定「多数派」还是「有中文就跟中文」。
   */
  const latinChars = (item.playerInput.match(/[A-Za-z]/g) ?? []).length;
  const chineseChars = (item.playerInput.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (!flat.includes("对白语言锁定")) {
    failures.push("提示词里没有语言锁定段");
  } else if (chineseChars === 0 && latinChars > 0) {
    if (!flat.includes("英语")) failures.push("纯英文输入，语言锁定没锁到英文");
  } else if (latinChars === 0 && chineseChars > 0) {
    if (!flat.includes("简体中文")) failures.push("纯中文输入，语言锁定没锁到中文");
  }

  // 7. 已知阵容：卡上的人名要在
  if (!flat.includes(item.card.name)) failures.push("角色名没有进提示词");

  return { caseId: item.id, category: item.category, ok: failures.length === 0, failures };
}

/** 组装一次的完整结果，预算和指纹从它读。 */
function assembleFor(item: EvalCase) {
  const history: ChatMessage[] = (item.history ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  const attachmentNote = item.attachment
    ? `\n（附件：${item.attachment.kind === "image" ? "图片" : "文档"}，${item.attachment.note}）`
    : "";
  history.push({ role: "user", content: `<player>${item.playerInput}${attachmentNote}</player>` });

  return assemble({
    card: item.card,
    history,
    seed: 12,
    turn: 0,
    userName: "你",
    ...(item.regenerate ? { temporaryNote: regenerateNote(item.regenerate.discard) } : {}),
    budget: planBudget(16_000, 1024),
  });
}

/** 真机模式：真的调模型，算 12.3 的三族指标。 */
async function liveTurn(item: EvalCase): Promise<EvalTurn> {
  const messages = buildMessages(item);
  const events = await provider!.open({
    messages,
    model: MODEL,
    temperature: 0.9,
    maxTokens: 4096,
    reasoningEffort: "low",
  });
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }

  const blocks = parseRawBlocks(text);
  return {
    caseId: item.id,
    run: item.id,
    turn: 1,
    report: checkGeneration({
      raw: text,
      cardName: item.card.name,
      knownCharacters: item.knownCharacters ?? [item.card.name],
      playerInput: item.playerInput,
      turn: 1,
      providerId: "yosei-router",
      model: MODEL,
    }),
    // 正文里有 scene 块 = 这一轮明确交代过场景切换
    sceneShifted: blocks.some((block) => block.kind === "scene"),
  };
}

/**
 * 跑一条连贯性序列（Phase 12.3）。
 *
 * 每轮都走真实的导演阶段：状态和剧情线由导演顺带产出，
 * 和线上完全一致。这样算出来的连贯性指标才是真的——
 * 本地自己编一份状态去算，等于自己给自己打分。
 *
 * 导演失败时降级成「只有正文，没有状态」，指标会记成无从判定，
 * 而不是记成「丢了一条线」。
 */
async function liveSequence(sequence: EvalSequence): Promise<EvalTurn[]> {
  const turns: EvalTurn[] = [];
  let history: ChatMessage[] = [];
  let state = emptySceneState(Date.now());
  let threads: StoryThread[] = [];

  for (const [index, playerInput] of sequence.playerInputs.entries()) {
    history = [...history, { role: "user", content: `<player>${playerInput}</player>` }];

    const assembled = assemble({
      card: sequence.card,
      history,
      seed: 12,
      turn: index,
      userName: "你",
      ...(isEmptySceneState(state) ? {} : { sceneState: state }),
      ...(threads.length ? { storyThreads: threads } : {}),
      budget: planBudget(16_000, 1024),
    });

    // 导演阶段：顺带产出状态变化和剧情线变化
    let plan: ReturnType<typeof parseTurnPlan> = null;
    try {
      const directorEvents = await provider!.open({
        messages: buildDirectorMessages(assembled.messages),
        model: MODEL,
        temperature: 0.2,
        maxTokens: DIRECTOR_MAX_TOKENS,
        reasoningEffort: "low",
      });
      let directorText = "";
      for await (const event of directorEvents) {
        if (event.type === "delta") directorText += event.text;
      }
      plan = parseTurnPlan(directorText);
    } catch {
      plan = null;
    }

    const sceneUpdate = applyScenePatch(state, plan?.statePatch ?? null, index + 1, {
      now: Date.now(),
    });
    state = sceneUpdate.state;
    const threadUpdate = applyThreadPatch(threads, plan?.threadPatch ?? [], index + 1);
    threads = threadUpdate.threads;

    // 正文：把计划交给讲述者，和线上一样
    const events = await provider!.open({
      messages: plan
        ? [...assembled.messages, { role: "system", content: formatTurnPlan(plan) }]
        : assembled.messages,
      model: MODEL,
      temperature: 0.9,
      maxTokens: 4096,
      reasoningEffort: "low",
    });
    let text = "";
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") throw new Error(event.message);
    }
    history = [...history, { role: "assistant", content: text }];

    const blocks = parseRawBlocks(text);
    turns.push({
      caseId: `${sequence.id}#${index + 1}`,
      run: sequence.id,
      turn: index + 1,
      report: checkGeneration({
        raw: text,
        cardName: sequence.card.name,
        knownCharacters: [sequence.card.name],
        playerInput,
        turn: index + 1,
        providerId: "yosei-router",
        model: MODEL,
      }),
      scene: state,
      sceneChanges: sceneUpdate.changes,
      threads,
      sceneShifted: blocks.some((block) => block.kind === "scene"),
    });
  }

  return turns;
}

function readBaseline(): MetricFamily | null {  if (!existsSync(BASELINE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(BASELINE, "utf8")) as { metrics?: MetricFamily };
    return parsed.metrics ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(
    `评测集跑批（${LIVE ? `真机 · ${MODEL}` : "离线装配检查"}）：${cases.length} 组` +
      (ONLY ? ` · 只看 ${CATEGORY_LABELS[ONLY as EvalCategory]}` : ""),
  );
  console.log("");

  /*
   * 离线：只验装配。真机：调模型，算三族指标。
   * 两条路产出的东西不一样，所以分开走，最后写进不同的文件。
   */
  if (!LIVE) {
    const checks = cases.map(offlineCheck);
    const failed = checks.filter((check) => !check.ok);
    for (const check of checks) {
      if (check.ok) continue;
      console.log(`✗ ${check.caseId}（${CATEGORY_LABELS[check.category]}）`);
      for (const reason of check.failures) console.log(`    ${reason}`);
    }
    console.log("");
    console.log(
      failed.length === 0
        ? `装配检查全部通过：${checks.length} 组`
        : `装配检查失败 ${failed.length}/${checks.length} 组`,
    );
    console.log("");
    console.log("说明：离线模式不调模型，所以算不出 12.3 的叙事和连贯性指标。");
    console.log("要那三族指标，跑 pnpm test:roleplay:live（需要 API Key）。");

    const payload = {
      mode: "offline",
      generatedAt: new Date().toISOString(),
      note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
      caseCount: cases.length,
      category: ONLY ?? null,
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
    };
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log("");
    console.log(`已写入 ${OUT}`);
    if (failed.length > 0) process.exit(1);
    return;
  }

  const turns: EvalTurn[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (const [index, item] of cases.entries()) {
    const label = `[${index + 1}/${cases.length}] ${item.id}`;
    try {
      const result = await liveTurn(item);
      turns.push(result);
      const report = result.report;
      const bad =
        report.decision === "rejected"
          ? " 拒收"
          : report.decision === "degraded"
            ? " 降级"
            : "";
      console.log(
        `${label} ${CATEGORY_LABELS[item.category]} ${report.verdict}${bad} ` +
          `${report.blockCount}块 act ${report.actCount}(坏${report.invalidActCount}) dlg ${report.dialogueCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: item.id, error: message });
      console.log(`${label} 失败：${message}`);
    }
  }

  /*
   * 连贯性序列（Phase 12.3）。
   *
   * 单轮用例算不出连贯性——那四项全是跨轮次的东西。所以补几条 4 轮序列，
   * 每轮都走真实导演阶段，把场景状态和剧情线一路攒下来再比。
   */
  console.log("");
  console.log(`连贯性序列：${EVAL_SEQUENCES.length} 条`);
  const sequenceTurns: EvalTurn[] = [];
  for (const sequence of EVAL_SEQUENCES) {
    try {
      const result = await liveSequence(sequence);
      sequenceTurns.push(...result);
      const last = result[result.length - 1];
      console.log(
        `  ${sequence.id} ${result.length} 轮 · 地点「${last?.scene?.location || "未记"}」· ` +
          `剧情线 ${last?.threads?.length ?? 0} 条`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: sequence.id, error: message });
      console.log(`  ${sequence.id} 失败：${message}`);
    }
  }

  /*
   * 指标从合并后的轮次一次算出。
   *
   * 单轮用例只贡献结构和叙事（连贯性对它们无从判定，分母是 0），
   * 序列轮次三族都贡献。合并后的分子分母是两批相加的结果，
   * 所以不需要分别算再平均——平均会让 50 组单轮把 20 轮序列稀释掉。
   */
  const metrics = allMetrics([...turns, ...sequenceTurns]);
  const baseline = COMPARE ? readBaseline() : null;
  const regressions = baseline ? findRegressions(baseline, metrics) : [];

  console.log("");
  console.log(formatMetrics(metrics));
  console.log("");

  if (!COMPARE) {
    console.log("只跑了部分类别，不和基线比（分母不一样，比出来必然是假的退化）。");
  } else if (baseline) {
    if (regressions.length === 0) {
      console.log(`和基线（${BASELINE}）相比：没有退化的指标。`);
    } else {
      console.log(`和基线（${BASELINE}）相比，以下指标退化：`);
      for (const item of regressions) {
        console.log(
          `  ${item.key} ${Math.round(item.before * 1000) / 10}% → ${Math.round(item.after * 1000) / 10}%` +
            `（${item.direction === "higher-better" ? "越高越好" : "越低越好"}）`,
        );
      }
    }
  } else {
    console.log(`没有找到基线（${BASELINE}），这一次的结果会写成新基线。`);
  }

  const payload = {
    mode: "live",
    model: MODEL,
    generatedAt: new Date().toISOString(),
    note: "所有输入与输出均为合成用例，不含真实玩家聊天；不含 API Key。",
    caseCount: cases.length,
    category: ONLY ?? null,
    sequences: EVAL_SEQUENCES.length,
    metrics,
    regressions,
    failures,
    turns: [...turns, ...sequenceTurns].map((turn) => ({
      caseId: turn.caseId,
      verdict: turn.report.verdict,
      decision: turn.report.decision,
      blockCount: turn.report.blockCount,
      actCount: turn.report.actCount,
      invalidActCount: turn.report.invalidActCount,
      dialogueCount: turn.report.dialogueCount,
      issues: turn.report.issues.map((issue) => issue.code),
      // 连贯性那几项靠这些字段才能复核，所以一并落盘
      ...(turn.scene
        ? {
            scene: {
              location: turn.scene.location,
              time: turn.scene.time,
              present: turn.scene.presentCharacters,
            },
          }
        : {}),
      ...(turn.threads
        ? { threads: turn.threads.map((thread) => ({ id: thread.id, title: thread.title, status: thread.status })) }
        : {}),
    })),
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`已写入 ${OUT}`);

  // 有退化或有失败就非零退出，CI 才拦得住
  if (regressions.length > 0) process.exit(1);
  if (failures.length > 0) process.exit(1);
}

await main();
