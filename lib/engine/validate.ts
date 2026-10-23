/**
 * 消息块质量门。
 *
 * 输入是模型这一轮的原始输出，输出是「能不能写进历史」的结论，
 * 外加一份**可以安全落盘**的正文。中间只做两件事：检查、就地降级。
 * 纯函数：不发请求、不碰存储、不看时间。
 *
 * 三档严重度对应三种落地方式（见 types.ts 的 GATE_ACTION）：
 *   none  原文照存；
 *   soft  降级后照存（act 改 narr、dlg 剥掉舞台指示），不额外发修复请求；
 *   hard  拒绝，调用方必须原样丢弃候选内容。
 *
 * 为什么降级而不是「有错就整轮重写」：act 太长、dlg 里带了括号动作这类问题，
 * 内容本身是好的，只是挂错了块。改块类型比重新生成便宜，也不会把这一轮
 * 已经发生的事再写一遍。真正不能救的（替玩家行动、角色名不明、非法标签）
 * 才拒收，因为改写它们需要猜，猜错比拒绝更糟。
 */
import {
  blocksToRaw,
  parseRawBlocks,
  repairBlockStructure,
  stripPseudoToolTags,
  type BlockKind,
  type MessageBlock,
} from "@/lib/blocks";
import {
  checkActDialogue,
  checkActLength,
  checkActMetaphor,
  checkActMultiAction,
  checkActResult,
  checkActThought,
  checkDialogueAction,
  checkDialogueMarkup,
  checkLanguageSwitch,
  checkNarratorPerson,
  checkPlayerControl,
  checkProtocol,
  checkWho,
  type CheckContext,
} from "./checks";
import { visibleLength } from "./text";
import {
  GATE_ACTION,
  ISSUE_LABELS,
  type BlockDegradation,
  type GateDecision,
  type GenerationIssue,
  type GenerationResult,
  type ValidationSeverity,
} from "./types";

export interface ValidateOptions {
  /** 角色卡上的角色名。仅保留给兼容性调用方，不再参与默认质量门。 */
  cardName?: string;
  /** Legacy diagnostic mode only. Production callers leave this disabled. */
  checkCharacterNames?: boolean;
  /** 玩家称呼。出现在 who 里就算替玩家说话。 */
  userName?: string;
  /** 已经出场过的人名，来自角色卡、记忆与历史 */
  knownCharacters?: string[];
  /** 玩家这一轮的输入。用来判语言锁定。 */
  playerInput?: string;
  /** 上一轮 assistant 的原始输出。用来判复读。 */
  previousReply?: string;
}

export interface ResponseValidation {
  /** 三档严重度里最重的那一档 */
  severity: ValidationSeverity;
  /** 质量门结论 */
  decision: GateDecision;
  /** 全部结构问题（含只记录的） */
  issues: GenerationIssue[];
  /** 硬错误：只要有一条就不能写进历史 */
  hardIssues: GenerationIssue[];
  /** 软错误：已经就地改好了 */
  softIssues: GenerationIssue[];
  /** 模型原始输出解析出的块（已剔除 player 块）。指标和问题下标都以它为准。 */
  rawBlocks: MessageBlock[];
  /** 降级后的块。可以直接渲染，也可以序列化回历史。 */
  blocks: MessageBlock[];
  /** 降级后的正文（保留块标记）。rejected 时为空串。 */
  content: string;
  /** 哪几个块被改写了 */
  degradations: BlockDegradation[];
  /** 拒收时给玩家看的一句话，取第一条硬错误 */
  reason: string;
}

/** Skip semantic quality checks while keeping deterministic message-block compatibility repairs. */
export function bypassResponseValidation(raw: string): ResponseValidation {
  const source = typeof raw === "string" ? raw : "";
  const repaired = repairBlockStructure(stripPseudoToolTags(source));
  const normalizedSource = repaired.safe ? repaired.text : source;
  const blocks = parseRawBlocks(normalizedSource).filter((block) => block.kind !== "player");
  return {
    severity: "none",
    decision: "accepted",
    issues: [],
    hardIssues: [],
    softIssues: [],
    rawBlocks: blocks,
    blocks,
    content: normalizedSource,
    degradations: [],
    reason: "",
  };
}

/** 只做结构校验，不看复读、剧情推进、文风这些「整轮质量」问题。 */
export function validateResponseBlocks(
  raw: string,
  options: ValidateOptions = {},
): ResponseValidation {
  const source = typeof raw === "string" ? raw : "";
  const repairedStructure = repairBlockStructure(stripPseudoToolTags(source));
  const structureIssues: GenerationIssue[] = repairedStructure.safe
    ? []
    : repairedStructure.issues
        .filter((issue) => !issue.safe)
        .map((issue) => ({
          code: "block_structure" as const,
          severity: "block" as const,
          detail: issue.detail,
        }));
  const normalizedSource = repairedStructure.safe ? repairedStructure.text : source;
  const context: CheckContext = {
    cardName: (options.cardName ?? "").trim(),
    userName: (options.userName ?? "你").trim() || "你",
    knownCharacters: dedupe(options.knownCharacters ?? []),
    playerInput: options.playerInput ?? "",
    previousReply: options.previousReply ?? "",
  };

  // 检查看原始输出：模型把 act 写成什么样，就按什么样判。
  const parsed = parseRawBlocks(normalizedSource);
  // 模型自己输出的 player 块不能进 blocks：那是玩家主权的标记，
  // 留着会被 blocksToRaw 原样写回历史，下一轮就成了「模型写过玩家的话」。
  const playerBlocks = parsed.filter((block) => block.kind === "player").length;
  const rawBlocks = parsed.filter((block) => block.kind !== "player");
  const withoutPseudoTools = stripPseudoToolTags(source);
  /*
   * 剥掉了多少个字符。
   * 用原始长度相减，而不是比较归一化后的正文：归一化会把所有标签抹掉，
   * 于是「<remember_place name="旅店">」这种只有标签没有内容的误写会量成 0，
   * 检查就漏了。
   */
  const strippedLength = Math.max(0, source.length - withoutPseudoTools.length);

  const issues: GenerationIssue[] = [
    ...structureIssues,
    ...checkProtocol(source, rawBlocks, strippedLength, playerBlocks),
    ...(options.checkCharacterNames ? checkWho(rawBlocks, context) : []),
    ...checkNarratorPerson(rawBlocks),
    ...checkPlayerControl(rawBlocks, context),
    ...checkLanguageSwitch(rawBlocks, context.playerInput),
    ...checkActLength(rawBlocks),
    ...checkActMultiAction(rawBlocks),
    ...checkActDialogue(rawBlocks),
    ...checkActThought(rawBlocks),
    ...checkActMetaphor(rawBlocks),
    ...checkActResult(rawBlocks),
    ...checkDialogueAction(rawBlocks, [context.cardName, ...context.knownCharacters]),
    ...checkDialogueMarkup(rawBlocks),
  ];

  const hardIssues = issues.filter((issue) => GATE_ACTION[issue.code] === "reject");
  const softIssues = issues.filter((issue) => GATE_ACTION[issue.code] === "degrade");

  // 有硬错误就不再改写：改出来的内容也不会被采用，白算一遍还可能掩盖问题
  const { blocks, degradations } =
    hardIssues.length > 0 ? { blocks: rawBlocks, degradations: [] } : degrade(rawBlocks, softIssues);

  const severity: ValidationSeverity =
    hardIssues.length > 0 ? "hard" : softIssues.length > 0 ? "soft" : "none";
  const decision: GateDecision =
    severity === "hard" ? "rejected" : severity === "soft" ? "degraded" : "accepted";

  return {
    severity,
    decision,
    issues,
    hardIssues,
    softIssues,
    rawBlocks,
    blocks,
    /*
     * 合格且没有结构修补时原样返回模型写的字符串，不走 blocksToRaw 再序列化一遍。
     * 序列化会规范化换行、补上 who="" 这类空属性——对合法回复来说，
     * 「一个字都不动」比「等价重排」重要得多。
     */
     content:
       severity === "hard"
         ? ""
         : decision === "accepted"
           ? normalizedSource
           : blocksToRaw(blocks),
    degradations,
    reason:
      hardIssues.length > 0
        ? `${ISSUE_LABELS[hardIssues[0].code]}：${hardIssues[0].detail}`
        : "",
  };
}

/**
 * 把已经校验过的一轮送进质量门，产出可以直接消费的 GenerationResult。
 *
 * 这是 ChatScreen 唯一该调的函数：它保证 rejected 时 content 是空串，
 * 调用方不可能「顺手」把坏内容写进历史。接收已经算好的 validation 和 report，
 * 是为了让面板显示的结论和实际落地的内容必然一致，也避免重复校验一遍。
 */
export function resolveGeneration(
  validation: ResponseValidation,
  options: {
    report: GenerationResult["report"];
    repairAttempted?: boolean;
    repairSucceeded?: boolean;
  },
): GenerationResult {
  const degraded = validation.decision === "degraded";
  const report = {
    ...options.report,
    severity: validation.severity,
    decision: validation.decision,
    degradations: validation.degradations,
    // 调用方已经算过修复标记（比如「修了一次，修好了」）时以它为准；
    // 没算过才退回「降级算一次修复」的默认口径。
    repairAttempted: options.repairAttempted ?? options.report.repairAttempted ?? degraded,
    repairSucceeded: options.repairSucceeded ?? options.report.repairSucceeded ?? degraded,
  };

  switch (validation.decision) {
    case "accepted":
      return { status: "accepted", content: validation.content, report };
    case "degraded":
      return { status: "repaired", content: validation.content, report };
    default:
      return { status: "rejected", reason: validation.reason, report };
  }
}

/* ------------------------------------------------------------------ 降级 */

/**
 * 按软错误逐块改写。只改块类型，不删内容、不改字句：
 * 玩家看到的还是模型写的东西，只是不再假装它是一条「即时动作」或一句「台词」。
 */
function degrade(
  blocks: MessageBlock[],
  softIssues: GenerationIssue[],
): { blocks: MessageBlock[]; degradations: BlockDegradation[] } {
  const degradations: BlockDegradation[] = [];
  const next: MessageBlock[] = [];

  blocks.forEach((block, index) => {
    const hit = softIssues.find((issue) => issue.blockIndex === index);
    if (!hit) {
      next.push(block);
      return;
    }

    const target = degradeTarget(block, hit.code);
    if (target === undefined) {
      next.push(block);
      return;
    }
    if (target === null) {
      degradations.push({
        index,
        from: block.kind,
        to: "dropped",
        code: hit.code,
        detail: hit.detail,
      });
      return;
    }

    degradations.push({
      index,
      from: block.kind,
      to: target.kind,
      code: hit.code,
      detail: hit.detail,
    });
    next.push(target);
  });

  return { blocks: next, degradations };
}

/**
 * 一个块降级成什么。
 *
 * act 的问题一律降成 narr：动作写长了、写了两个动作、混了对白或心理，
 * 它本质上已经是一段叙述，降级后语义仍然成立。
 *
 * dlg 的问题只剥舞台指示，不整块降级：剩下的话仍然是角色说出口的，
 * 降成 narr 反而把对白吞掉了。剥完如果空了，才整块丢掉（返回 null）。
 */
function degradeTarget(
  block: MessageBlock,
  code: GenerationIssue["code"],
): MessageBlock | null | undefined {
  if (block.kind === "act") {
    return { kind: "narr" as BlockKind, text: block.text };
  }
  if (block.kind === "dlg" && code === "dlg_has_action") {
    const cleaned = stripStageDirections(block.text);
    if (!cleaned) return null;
    return { kind: "dlg", who: block.who, text: cleaned };
  }
  return undefined;
}

/** 括号、星号包起来的舞台指示，以及开头的「她笑了笑，」这类转述前缀。 */
export function stripStageDirections(text: string): string {
  return text
    .replace(/[（(][^）)]{0,60}[）)]/g, "")
    .replace(/\*[^*\n]{1,60}\*/g, "")
    .replace(
      /^(?:她|他|它|对方|[\u4e00-\u9fff]{2,4})(?:又|也|只|才|就|便)?(?:笑了笑|笑|叹气|叹了口气|点头|摇头|沉默|停顿|顿了顿|皱眉|抬眼|低头|转身|回头|伸手|坐下|站起|愣|怔)[，,：:]\s*/,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 模型自己输出了几个 player 块。它们不会进 blocks（那是玩家主权的标记），所以单独数。 */
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

/** 给日志和面板用的一句话：降级了几处、拒收原因是什么。 */
export function describeValidation(validation: ResponseValidation): string {
  if (validation.decision === "rejected") return `拒收 · ${validation.reason}`;
  if (validation.decision === "degraded") {
    return `降级 ${validation.degradations.length} 处 · ${validation.degradations
      .map((item) => `${item.from}→${item.to}`)
      .join("，")}`;
  }
  return `通过 · ${visibleLength(validation.content)} 字`;
}
