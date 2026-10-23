/**
 * 当前回合模式。
 *
 * 同一套规则不可能适配所有回合：玩家只说了两个字，和玩家要求「详细写一下这个房间」，
 * 该有的篇幅和节奏完全不同。模式就是把这个差别显式地告诉模型，
 * 而不是指望它从上下文里猜。
 *
 * 判定分两步：
 * 1. `inferResponseMode` 只看玩家这一句和上一轮的状态，纯函数、可复现；
 * 2. 导演阶段可以给出更准的 mode（它看过完整聊天记录），由调用方覆盖。
 */
import type { ChatMessage } from "./types";

export type ResponseMode = "normal" | "short" | "dialogue" | "scene" | "continue";

export const RESPONSE_MODES: readonly ResponseMode[] = [
  "normal",
  "short",
  "dialogue",
  "scene",
  "continue",
];

/** 面板和日志里的中文名。 */
export const MODE_LABELS: Record<ResponseMode, string> = {
  normal: "正常推进",
  short: "简短回应",
  dialogue: "以对白为主",
  scene: "场景推进",
  continue: "续写上一段",
};

/**
 * 每个模式给模型的具体要求。
 *
 * 写法上刻意用「写什么」而不是「不要写什么」：模式是节奏指令，
 * 列一堆禁止项反而会挤掉真正要它做的事。
 */
export const MODE_INSTRUCTIONS: Record<ResponseMode, string> = {
  normal: "按平常的节奏推进：接住玩家这一句，让在场角色作出具体反应，写出动作、对白和一点环境或他人的回应，停在玩家还能接话的地方。不要压成一句台词或一个孤立动作。",
  short:
    "这一轮要短。一个动作、一段对白就够，不主动引入新剧情、新人物或新场景，也不要补充背景说明。",
  dialogue:
    "这一轮以对白为主：让角色多说两句，动作只留必要的点缀，环境描写压到最低。",
  scene:
    "这一轮允许推进场景：可以换场、可以交代时间流逝，旁白可以多一些，不要求角色长篇对话。",
  continue:
    "这一轮只接着上一段被截断的内容往下写，不新增剧情转折，不重新解释前文，也不要重复已经写过的句子。",
};

export interface ModeInput {
  /** 玩家这一轮的输入 */
  playerInput: string;
  /** 上一轮的正文。用来判断是不是在要求续写 */
  previousReply?: string;
  /** 上一轮是不是被 max tokens 截断了 */
  truncated?: boolean;
}

/** 要求续写的说法。 */
const CONTINUE_HINT = /(?:^|[\s，,。])(?:继续|接着|然后呢|往下|再来|go on|continue)|继续写|接着说|往下写/i;
/** 要求换场或跳时间的说法，含括号里的元指令。 */
const SCENE_HINT = /(?:换个场景|换场景|下一个场景|第二天|次日|过了|跳(?:到|过)|时间(?:流逝|跳过)|场景切换|切到)/;
/** 疑问句。中文问句不一定带问号，所以也看疑问词。 */
const QUESTION_HINT = /[？?]|(?:吗|呢|什么|为什么|怎么|怎样|谁|哪里|哪儿|多少|是不是|有没有)/;

/**
 * 「什么也/没什么」是陈述里的固定说法，不是提问。
 * 不先抹掉它们，「我什么也没说」会被判成 dialogue，模型就会让角色一直说话。
 */
const NOT_A_QUESTION = /(?:什么也(?:没|不)|没什么|什么都)/g;

/**
 * 从玩家这一句推断回合模式。
 *
 * 顺序很重要：续写 > 换场 > 提问 > 太短 > 正常。
 * 「继续」这类指令必须最先判，否则「继续」两个字会被当成短回应。
 */
export function inferResponseMode(input: ModeInput): ResponseMode {
  const text = input.playerInput.replace(/<\/?player\b[^>]*>/gi, "").trim();
  if (!text) return "short";
  if (input.truncated || CONTINUE_HINT.test(text)) return "continue";
  if (SCENE_HINT.test(text)) return "scene";
  if (QUESTION_HINT.test(text.replace(NOT_A_QUESTION, ""))) return "dialogue";
  // 中文里 6 个字以内基本就是一声应和、一个动作或一句感叹
  if (text.length <= 6) return "short";
  return "normal";
}

/** 模式 → 一行提示词。 */
export function modeInstruction(mode: ResponseMode): string {
  return `本轮模式（${MODE_LABELS[mode]}）：${MODE_INSTRUCTIONS[mode]}`;
}

/** 导演阶段的 system 提示里要追加的一段：让导演也按同一套模式词汇说话。 */
export const DIRECTOR_MODE_HINT = [
  "除了节拍，你还要判断本轮的回应模式，取值为：",
  "normal（正常推进）、short（简短回应）、dialogue（以对白为主）、scene（场景推进）、continue（续写上一段）。",
  "玩家要求继续或上一段被截断时用 continue；玩家要求换场、跳时间时用 scene；",
  "玩家在提问、想听角色说话时用 dialogue；只有玩家这一轮确实只回了一声、一个动作或一两个词时才用 short，玩家说了完整句子就用 normal。",
].join("\n");

export type { ChatMessage };
