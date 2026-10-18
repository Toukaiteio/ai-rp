/**
 * 文本引擎的观测类型。
 *
 * Phase 0 只做一件事：把「这一轮生成到底发生了什么」变成结构化数据。
 * 所有判断都是纯函数、可离线复现，不依赖模型，也不写盘。
 *
 * 设计约束（对应 Phase 0 的验收标准）：
 * 1. 报告里只放长度、计数、问题码和结构化短描述，不放完整正文，也不放 API Key。
 *    唯一带正文的是 repeatedPhrases 的 12 字预览，那是模型自己刚生成的句子，
 *    且本来就画在屏幕上，用来人工核对「复读」是哪一句。
 * 2. 同一份输入永远得到同一份报告：没有时间戳之外的随机量（generatedAt 由调用方给）。
 *
 * Phase 1 在同一个类型空间里加了质量门：严重度三档（ValidationSeverity）、
 * 每类问题的处理方式（GateAction）和落地结果（GenerationResult）。
 */
import type { BlockKind } from "@/lib/blocks";
import type { ResponseMode } from "@/lib/prompt/mode";
import type { WorldBookReport } from "@/lib/prompt/worldbook";
import type { CharacterVoiceProfile } from "@/lib/voice";

/**
 * 问题码。前九个是 Phase 0 要求统计的错误类型，其余是同一批观测里
 * 顺带能量化、且后面阶段直接要用的项。
 */
export const ISSUE_CODES = [
  "act_overlong",
  "act_multi_action",
  "act_has_dialogue",
  "act_has_thought",
  "dlg_has_action",
  "player_control",
  "repeated_expression",
  "plot_overreach",
  "language_switch",
  "character_drift",
  "narrator_in_character",
  "response_overlong",
  "summary_tone",
  "style_breach",
  "no_blocks",
  "pseudo_tool_text",
  "player_block",
  "who_pronoun",
  "who_inexact",
  "act_metaphor",
  "act_result",
  "dlg_markup",
  "voice_breach",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

/**
 * warn：可以自动修一次，或者留着但不该污染后续上下文。
 * block：直接不合格，这一轮不该写进历史。
 *
 * 注意：这是**检查报告**里的严重度，回答「这轮内容有没有问题」。
 * 质量门能不能就地改好，是另一件事，见 GateAction。
 */
export type IssueSeverity = "warn" | "block";

/**
 * 质量门的严重程度。三档，直接决定这一轮怎么落地。
 *
 * none：干净，原文照存。
 * soft：可以就地降级（act 太长、act 里有两个动作、混了一点叙述），
 *       降级后仍然存，不额外发修复请求。
 * hard：不能靠改写救（替玩家行动、角色名不明、生成非法标签、
 *       讲述者变成角色、把工具调用写进正文），拒绝写入历史。
 */
export type ValidationSeverity = "none" | "soft" | "hard";

/**
 * 某一类问题在质量门里允许的处理方式。
 *
 * degrade：就地降级，把违规的块改写成合法形态。
 * reject：不改写，整轮拒收。
 * report：只记录，不影响落地（复读、剧情推进这类要靠后续阶段处理）。
 */
export type GateAction = "degrade" | "reject" | "report";

export interface GenerationIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** 出问题的块在解析结果里的下标。整轮级的问题不填。 */
  blockIndex?: number;
  /** 结构化短描述：只写长度、计数、命中的模式名，不写完整正文。 */
  detail: string;
}

/** 一项检查在这一轮的结果。开发模式就是靠这个看「经过了哪些检查」。 */
export interface CheckRun {
  code: IssueCode;
  label: string;
  status: "pass" | "warn" | "block" | "skip";
  /** 命中数量，或者跳过原因 */
  detail: string;
}

/** 与目标架构里的三个分支一一对应：合格 / 可修复 / 不合格。 */
export type GenerationVerdict = "pass" | "repair" | "reject";

/** 质量门的最终结论。 */
export type GateDecision = "accepted" | "degraded" | "rejected";

/** 一个块被降级成了什么。开发面板用它说明「改写发生在哪」。 */
export interface BlockDegradation {
  /** 在解析结果里的下标 */
  index: number;
  from: BlockKind;
  /** 降级后的块类型。dropped 表示剥完内容为空、整块丢掉。 */
  to: BlockKind | "dropped";
  /** 降级原因，取第一条命中的问题码 */
  code: IssueCode;
  detail: string;
}

/**
 * 一轮生成的结果。质量门的输出，也是写不写历史的唯一依据。
 *
 * content 是**改写后**、可以安全写进历史的正文；rejected 时为空串，
 * 调用方必须原样丢弃，绝不能把候选内容当成新历史。
 */
export type GenerationResult =
  | { status: "accepted"; content: string; report: GenerationReport }
  | { status: "repaired"; content: string; report: GenerationReport }
  | { status: "rejected"; reason: string; report: GenerationReport };


/**
 * 一轮生成的观测报告。
 *
 * 前九个字段是 Phase 0 明确要求的指标，保持名字不变，方便跨版本对比基线。
 * 其余字段是同一份观测的扩展：本轮跑过哪些检查、问题清单、判定结果。
 */
export interface GenerationReport {
  /* ---- Phase 0 指定指标 ---- */
  responseLength: number;
  blockCount: number;
  actCount: number;
  invalidActCount: number;
  dialogueCount: number;
  playerControlViolation: boolean;
  repeatedPhraseCount: number;
  repairAttempted: boolean;
  repairSucceeded: boolean;

  /* ---- 观测扩展 ---- */
  turn: number;
  /** 本轮回复里的对白语言分布，用来核对语言锁定 */
  language: LanguageId;
  sceneCount: number;
  issues: GenerationIssue[];
  checks: CheckRun[];
  verdict: GenerationVerdict;
  /** 质量门的严重程度与结论，和 verdict 是同一件事的两种口径 */
  severity: ValidationSeverity;
  decision: GateDecision;
  /** 被就地降级的块。没有降级时为空数组。 */
  degradations: BlockDegradation[];
  /** 提示词版本指纹。换了规则或输出契约，这个值就变，基线才有可比性。 */
  promptVersion: string;
  /** 正文指纹。不存正文也能核对两轮是不是同一段。 */
  replyHash: string;
  /**
   * 自动修复的备注：修了没修成、为什么没修成。
   * 只给开发模式看，玩家界面上不出现技术细节。
   */
  repairNote?: string;
  /** 上游耗时，只有真实跑批时才有 */
  latencyMs?: number;
  generatedAt: number;
  providerId?: string;
  model?: string;
  /** 这一轮用的回合模式。观测用，方便对照「模式有没有真的改变输出」。 */
  mode?: ResponseMode;
  /**
   * 世界书的注入情况（Phase 8）：命中多少、注入多少、被预算丢掉多少、
   * 各优先级档和各来源各几条。观测用，方便核对预算有没有花在该花的地方。
   */
  lorebook?: WorldBookReport;
  /** Whether the generation quality gate was executed for this report. */
  qualityGateEnabled: boolean;
}

/** 生成报告的输入。全部来自本轮已经拿到的数据，不需要额外请求。 */
export interface GenerationInput {
  /** 模型这一轮的原始输出（保留块标记） */
  raw: string;
  /** 玩家这一轮的输入。用来判定语言锁定和替玩家行动。 */
  playerInput?: string;
  /** 上一轮 assistant 的原始输出。用来判定复读。 */
  previousReply?: string;
  cardName?: string;
  /** Legacy diagnostic mode only; disabled by default for group-story cards. */
  checkCharacterNames?: boolean;
  userName?: string;
  /** 已经出场过的人名，来自角色卡、记忆与历史 */
  knownCharacters?: string[];
  turn?: number;
  providerId?: string;
  model?: string;
  latencyMs?: number;
  /** 这一轮有没有走过修复，以及修复有没有成功 */
  repair?: { attempted: boolean; succeeded: boolean };
  /** 修复没成功时的原因，写进报告给开发面板看 */
  repairNote?: string;
  /** 这一轮用的回合模式 */
  mode?: ResponseMode;
  /** 世界书这一轮的注入情况。由组装器算好传进来，检查阶段不重复匹配。 */
  lorebook?: WorldBookReport;
  qualityGateEnabled?: boolean;
  /** 角色声音档案（Phase 9）。有它才检查对白有没有违背声明的禁令。 */
  voice?: CharacterVoiceProfile;
  /** 注入时间，测试里传固定值保证可复现 */
  now?: number;
}

export type LanguageId = "zh" | "ja" | "ko" | "latin" | "unknown";

export const ISSUE_SEVERITY: Record<IssueCode, IssueSeverity> = {
  act_overlong: "warn",
  act_multi_action: "warn",
  act_has_dialogue: "warn",
  act_has_thought: "warn",
  act_metaphor: "warn",
  act_result: "warn",
  dlg_has_action: "warn",
  dlg_markup: "block",
  player_control: "block",
  player_block: "block",
  repeated_expression: "warn",
  plot_overreach: "warn",
  language_switch: "block",
  character_drift: "block",
  who_pronoun: "block",
  who_inexact: "block",
  narrator_in_character: "block",
  response_overlong: "warn",
  summary_tone: "warn",
  style_breach: "warn",
  no_blocks: "block",
  pseudo_tool_text: "block",
  voice_breach: "warn",
};

/**
 * 质量门对每一类问题的处理方式。
 *
 * 这张表是 Phase 1 的核心约定，改它等于改「什么样的回复能进历史」，
 * 所以只有一处定义，检查和落地都读它。
 */
export const GATE_ACTION: Record<IssueCode, GateAction> = {
  // 能就地改好：act 拆不动，但降级成 narr 仍然保留原文信息
  act_overlong: "degrade",
  act_multi_action: "degrade",
  act_has_dialogue: "degrade",
  act_has_thought: "degrade",
  act_metaphor: "degrade",
  act_result: "degrade",
  // dlg 混了动作：剥掉舞台指示，剩下的原话仍然是角色说的话
  dlg_has_action: "degrade",
  // 不能改写，整轮拒收
  player_control: "reject",
  player_block: "reject",
  who_pronoun: "reject",
  who_inexact: "reject",
  character_drift: "reject",
  narrator_in_character: "reject",
  language_switch: "reject",
  dlg_markup: "reject",
  no_blocks: "reject",
  pseudo_tool_text: "reject",
  // 只记录：这些要靠后续阶段（记忆、剧情线、文风）处理，不该拦住这一轮
  repeated_expression: "report",
  plot_overreach: "report",
  response_overlong: "report",
  summary_tone: "report",
  style_breach: "report",
  // 声音违背只记录：语气是最主观的一类判断，误报代价比漏报大。
  // 只有「说了禁用的话」这种确凿情况才 warn，但也不该拦住这一轮。
  voice_breach: "report",
};

/** 开发模式面板里的中文标签。 */
export const ISSUE_LABELS: Record<IssueCode, string> = {
  act_overlong: "act 过长",
  act_multi_action: "act 含多个动作",
  act_has_dialogue: "act 混入对白",
  act_has_thought: "act 混入心理解释",
  act_metaphor: "act 含文学化比喻",
  act_result: "act 写了动作结果",
  dlg_has_action: "dlg 混入动作",
  dlg_markup: "dlg 混入标签或 JSON",
  player_control: "替玩家说话或行动",
  player_block: "模型输出了 player 块",
  repeated_expression: "重复上一轮表达",
  plot_overreach: "一次性推进太多剧情",
  language_switch: "角色语言切换错误",
  character_drift: "角色行为脱离设定",
  who_pronoun: "who 用了代词",
  who_inexact: "角色名写得不准确",
  narrator_in_character: "讲述者变成了角色",
  response_overlong: "回复过长",
  summary_tone: "旁白像说明文",
  style_breach: "违反文风硬规则",
  no_blocks: "没有输出消息块",
  pseudo_tool_text: "把工具调用写成了标签",
  voice_breach: "说话方式偏离设定",
};
