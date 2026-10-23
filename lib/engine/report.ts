/**
 * 一轮生成的检查流水线。
 *
 * 顺序固定：结构校验（validate.ts，质量门）→ 整轮级检查 → 汇总判定。
 * 后面的阶段（记忆、剧情线、文风）都从这里拿结论，所以这里只做判断，
 * 不写历史、不发请求、不碰存储。
 */
import { stripPseudoToolTags, type MessageBlock } from "@/lib/blocks";
import { hashString } from "@/lib/prompt/cache";
import {
  checkPlotOverreach,
  checkRepeat,
  checkResponseLength,
  checkStyle,
  checkVoiceBreach,
  type CheckContext,
} from "./checks";
import { bypassResponseValidation, validateResponseBlocks, type ResponseValidation } from "./validate";
import { detectLanguage, visibleLength } from "./text";
import {
  ISSUE_LABELS,
  ISSUE_SEVERITY,
  type CheckRun,
  type GateDecision,
  type GenerationInput,
  type GenerationIssue,
  type GenerationReport,
  type GenerationVerdict,
  type IssueCode,
} from "./types";
import { promptVersion } from "./version";

/** 面板里的固定顺序：协议在最前，人设和玩家主权在中间，文风垫底。 */
const CHECK_ORDER: IssueCode[] = [
  "no_blocks",
  "pseudo_tool_text",
  "player_block",
  "who_pronoun",
  "who_inexact",
  "act_overlong",
  "act_multi_action",
  "act_has_dialogue",
  "act_has_thought",
  "act_metaphor",
  "act_result",
  "dlg_has_action",
  "dlg_markup",
  "block_structure",
  "player_control",
  "repeated_expression",
  "plot_overreach",
  "response_overlong",
  "language_switch",
  "character_drift",
  "narrator_in_character",
  "summary_tone",
  "style_breach",
  "voice_breach",
];

export function checkGeneration(input: GenerationInput): GenerationReport {
  const validation = input.qualityGateEnabled === false
    ? bypassResponseValidation(input.raw ?? "")
    : validateResponseBlocks(input.raw ?? "", {
      cardName: input.cardName,
      userName: input.userName,
      knownCharacters: input.knownCharacters,
      playerInput: input.playerInput,
      previousReply: input.previousReply,
      checkCharacterNames: input.checkCharacterNames,
    });
  return reportForValidation(validation, input);
}

/**
 * 用已经跑过的结构校验结果拼报告。
 *
 * 质量门（validateResponseBlocks）和观测报告必须看同一批块、同一批问题，
 * 否则会出现「面板说通过、内容却被拒收」这种自相矛盾的情况。
 * 所以报告不自己重新解析一遍，而是接住校验结果，只补整轮级检查。
 */
export function reportForValidation(
  validation: ResponseValidation,
  input: GenerationInput,
): GenerationReport {
  const raw = input.raw ?? "";
  /*
   * 指标和检查都看模型**原始**的块（validation.rawBlocks），不看降级后的结果：
   * 降级只影响写进历史的正文，不该把「模型这一轮 act 写得不规范」这件事抹掉。
   * 否则 act 一降级，invalidActCount 就永远是 0，基线也就没法对比了。
   */
  const blocks: MessageBlock[] = validation.rawBlocks;
  const withoutPseudoTools = stripPseudoToolTags(raw);
  const responseLength = visibleLength(withoutPseudoTools);

  const context: CheckContext = {
    cardName: (input.cardName ?? "").trim(),
    userName: (input.userName ?? "你").trim() || "你",
    knownCharacters: dedupe(input.knownCharacters ?? []),
    playerInput: input.playerInput ?? "",
    previousReply: input.previousReply ?? "",
    ...(input.voice ? { voice: input.voice } : {}),
  };

  const qualityGateEnabled = input.qualityGateEnabled !== false;
  const repeat = qualityGateEnabled ? checkRepeat(blocks, context) : { issues: [], count: 0 };
  const issues: GenerationIssue[] = qualityGateEnabled
    ? [
        ...validation.issues,
        ...repeat.issues,
        ...checkPlotOverreach(blocks, responseLength),
        ...checkResponseLength(responseLength),
        ...checkStyle(blocks),
        ...checkVoiceBreach(blocks, context.voice),
      ]
    : [];

  const actBlocks = blocks.filter((block) => block.kind === "act");
  const dialogueBlocks = blocks.filter((block) => block.kind === "dlg");
  const sceneCount = blocks.filter((block) => block.kind === "scene").length;
  const invalidActCount = blocks.reduce(
    (count, block, index) =>
      block.kind === "act" && hasActIssueAt(issues, index) ? count + 1 : count,
    0,
  );

  return {
    responseLength,
    blockCount: blocks.length,
    actCount: actBlocks.length,
    invalidActCount,
    dialogueCount: dialogueBlocks.length,
    playerControlViolation: issues.some((issue) => issue.code === "player_control"),
    repeatedPhraseCount: repeat.count,
    repairAttempted:
      input.repair?.attempted ?? validation.decision === "degraded",
    repairSucceeded:
      input.repair?.succeeded ?? validation.decision === "degraded",

    turn: input.turn ?? 0,
    language: detectLanguage(dialogueBlocks.map((block) => block.text).join("")) || detectLanguage(raw),
    sceneCount,
    issues,
    checks: buildChecks(issues, blocks, context, qualityGateEnabled, input.checkCharacterNames === true),
    // verdict 是质量门结论的另一种口径，两者必须一致：
    // 报告说「可修复」而内容其实被拒收，面板就会骗人。
    verdict: verdictFor(validation.decision),
    severity: validation.severity,
    decision: validation.decision,
    qualityGateEnabled,
    degradations: validation.degradations,
    promptVersion: promptVersion(),
    replyHash: hashString(withoutPseudoTools),
    ...(input.repairNote ? { repairNote: input.repairNote } : {}),
    ...(input.latencyMs === undefined ? {} : { latencyMs: Math.round(input.latencyMs) }),
    generatedAt: input.now ?? Date.now(),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.lorebook ? { lorebook: input.lorebook } : {}),
  };
}

/**
 * 一个 act 只要命中任意一条 act_* 问题就算不合格。
 * 用块下标对齐：问题里的 blockIndex 就是解析结果里的下标。
 */
function hasActIssueAt(issues: GenerationIssue[], index: number): boolean {
  return issues.some((issue) => issue.code.startsWith("act_") && issue.blockIndex === index);
}

function buildChecks(
  issues: GenerationIssue[],
  blocks: MessageBlock[],
  context: CheckContext,
  enabled: boolean,
  characterNameChecks: boolean,
): CheckRun[] {
  return CHECK_ORDER.map((code) => {
    if (!enabled) {
      return { code, label: ISSUE_LABELS[code], status: "skip", detail: "质量检测已关闭" };
    }
    if (!characterNameChecks && (code === "who_pronoun" || code === "who_inexact" || code === "character_drift")) {
      return { code, label: ISSUE_LABELS[code], status: "skip", detail: "角色名检测已停用，支持群像剧角色扩展" };
    }
    const matched = issues.filter((issue) => issue.code === code);
    if (code === "repeated_expression" && !context.previousReply.trim()) {
      return {
        code,
        label: ISSUE_LABELS[code],
        status: "skip",
        detail: "没有上一轮回复可比较",
      };
    }
    if (matched.length === 0) {
      return {
        code,
        label: ISSUE_LABELS[code],
        status: "pass",
        detail: passDetail(code, blocks),
      };
    }
    const status = matched.some((issue) => issue.severity === "block") ? "block" : "warn";
    return {
      code,
      label: ISSUE_LABELS[code],
      status,
      detail: `${matched.length} 处：${matched[0].detail}`,
    };
  });
}

/** 通过时也给一句「检查了什么」，否则面板上全是「通过」看不出覆盖范围。 */
function passDetail(code: IssueCode, blocks: MessageBlock[]): string {
  switch (code) {
    case "act_overlong":
    case "act_multi_action":
    case "act_has_dialogue":
    case "act_has_thought":
    case "act_metaphor":
    case "act_result": {
      const acts = blocks.filter((block) => block.kind === "act").length;
      return acts === 0 ? "本轮没有 act 块" : `${acts} 个 act 全部通过`;
    }
    case "dlg_has_action":
    case "dlg_markup": {
      const lines = blocks.filter((block) => block.kind === "dlg").length;
      return lines === 0 ? "本轮没有 dlg 块" : `${lines} 个 dlg 全部通过`;
    }
    case "no_blocks":
      return `解析出 ${blocks.length} 个块`;
    case "pseudo_tool_text":
      return "没有误写的工具标签";
    case "player_block":
      return "没有 player 块";
    case "who_pronoun":
    case "who_inexact":
    case "character_drift":
      return "所有 who 都是准确的角色名";
    case "player_control":
      return "没有玩家名下的块，也没有替玩家行动";
    case "plot_overreach":
      return `${blocks.length} 个块，换场 0 次以内`;
    case "language_switch":
      return "对白语言与玩家输入一致";
    case "narrator_in_character":
      return "旁白和动作里没有第一人称";
    case "summary_tone":
    case "style_breach":
      return "没有命中硬规则";
    case "response_overlong":
      return "篇幅在约定范围内";
    default:
      return "通过";
  }
}

/**
 * 判定口径以质量门为准。
 *
 * 只记录不落地的问题（复读、剧情推进、破折号）不该把一轮判成不合格，
 * 所以不能简单看「有没有 warn/block 问题」，而要看这一轮**实际能不能用**。
 */
function verdictFor(decision: GateDecision): GenerationVerdict {
  if (decision === "rejected") return "reject";
  if (decision === "degraded") return "repair";
  return "pass";
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const clean = name.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

/**
 * 给面板和跑批脚本用的扁平摘要。
 * 只保留问题码和数量，一行能看完；完整报告仍然在 GenerationReport 里。
 */
export function summarizeReport(report: GenerationReport): string {
  if (report.issues.length === 0) {
    return `${report.blockCount} 块 / ${report.responseLength} 字 / 全部通过`;
  }
  const counts = new Map<IssueCode, number>();
  for (const issue of report.issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => `${ISSUE_LABELS[code]}×${count}`)
    .join("，");
}

/** 按严重程度排序，block 在前。面板按这个顺序列问题。 */
export function sortIssues(issues: GenerationIssue[]): GenerationIssue[] {
  return [...issues].sort((a, b) => {
    const rank = (issue: GenerationIssue) => (issue.severity === "block" ? 0 : 1);
    return rank(a) - rank(b) || (a.blockIndex ?? -1) - (b.blockIndex ?? -1);
  });
}

export { ISSUE_SEVERITY };
