/**
 * 自动修复。
 *
 * 质量门判 hard 之后，允许再试一次：只让模型修**格式和叙述分工**，
 * 不许重写剧情。这里只有纯函数（提示词、解析、结果判定），
 * 真正发请求的是调用方（ChatScreen / 跑批脚本），方便离线测试和替换模型。
 *
 * 三条硬约束：
 * 1. 每轮最多修一次。不循环，因为模型可能在第二次修复里引入新问题。
 * 2. 修复请求不重发完整聊天历史：只给候选正文、玩家这一轮说了什么、
 *    角色名和块协议。历史越长越容易把「补全剧情」带进来，也越贵。
 * 3. 修完必须重新过一遍质量门。修不好就拒收，不因为是「修复版」就放行。
 */
import type { ChatMessage } from "@/lib/prompt/types";
import { stripPseudoToolTags } from "@/lib/blocks";
import { ISSUE_LABELS, type GenerationIssue, type IssueCode } from "./types";

export interface RepairPromptOptions {
  /** 模型这一轮的候选正文（保留块标记） */
  candidate: string;
  /** 玩家这一轮说的话。修复模型只用来判断「哪些是玩家的话，不能写」 */
  playerInput: string;
  /** 角色卡上的角色名 */
  cardName: string;
  /** 已经出场过的人名，让修复模型知道哪些 who 是合法的 */
  knownCharacters?: string[];
  /** 质量门判定的硬错误 */
  issues: GenerationIssue[];
}

/** 块协议摘要。只写修复需要知道的四条，不抄整份输出契约。 */
export const REPAIR_CONTRACT = [
  "每轮只输出下面四种块，块之外不要写任何说明：",
  "<narr>旁白。写环境、氛围、时间流逝和非当前角色的反应。</narr>",
  '<act who="角色名">一个旁观者能直接看见的短动作、姿势或表情，最多 20 个汉字，不带逗号。</act>',
  '<dlg who="角色名">角色实际说出口的原话，只放原话。</dlg>',
  "<scene>场景切换、时间流逝或状态变化，一句写完。</scene>",
  "player 块只用来标记玩家输入，你永远不要输出它。",
].join("\n");

/**
 * 修复阶段的系统提示。
 *
 * 「不改变」那一段是重点：模型看到一段有问题的文本时，最容易顺手把剧情写顺、
 * 补全因果、把话说圆，那就等于换了一版剧情。所以逐条列出不许动的东西，
 * 并且明确「宁可删掉一句，也不要补一句」。
 */
export const REPAIR_SYSTEM_PROMPT = [
  "你是角色扮演回复的格式修复器。你的唯一任务是修正块标记和叙述分工，让这段回复符合输出协议。",
  "严禁改变剧情。以下内容一个字都不能动：",
  "- 已经发生的事件、谁做了什么",
  "- 角色关系、称呼和态度",
  "- 人物设定、外貌、来历",
  "- 玩家说过的话和玩家做的选择",
  "- 场景地点、时间、天气",
  "- 时间线、事情发生的先后顺序",
  "允许做的只有这几件事：",
  "1. 把不规范的 act 改成 narr，或者拆成一个短动作；",
  "2. 把混在 act 里的对白拆成 dlg；",
  "3. 把混在 dlg 里的动作、括号、星号拆出来或删掉，dlg 只留说出口的原话；",
  "4. 删掉替玩家说的话、替玩家做的动作、替玩家写的心情；",
  "5. 删掉非消息块的标签、函数调用、JSON；",
  "6. 把 who 改成准确的角色名。",
  "关于 who：只有下面「可以出现在 who 里的名字」名单里的名字能用。名单之外的名字一个都不能留，"
    + "包括原作角色、路人和临时起的名；确实需要那块内容时，改成名单里的角色，或者整块删掉。",
  "不要新增原文没有的事件、动作、对白或环境描写。宁可删掉一句，也不要补一句。",
  "不要扩写，不要润色，不要调整语气，不要补充心理活动。修复后的篇幅不应明显长于原文。",
  REPAIR_CONTRACT,
  "只输出修复后的块，不要输出解释、前言、代码围栏或「以下是修复后的内容」这类话。",
].join("\n");

/**
 * 组装修复请求。
 *
 * 刻意只给三样东西：失败原因、候选正文、必要的上下文（玩家这句 + 合法人名）。
 * 不传聊天历史——历史会让模型把「接着写」当成任务，也会把旧错误带回来。
 */
export function buildRepairMessages(options: RepairPromptOptions): ChatMessage[] {
  const reasons = summarizeReasons(options.issues);
  const known = dedupe([options.cardName, ...(options.knownCharacters ?? [])]);
  const context = [
    `角色名：${options.cardName}`,
    known.length > 0
      ? `可以出现在 who 里的名字（只有这些）：${known.join("、")}`
      : "",
    options.playerInput.trim()
      ? `玩家这一轮说的是（只作参照，不能替他说别的话）：${clip(options.playerInput, 400)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: REPAIR_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `需要修复的问题：\n${reasons}`,
        context,
        `原始回复：\n${stripPseudoToolTags(options.candidate)}`,
      ].join("\n\n"),
    },
  ];
}

/** 把硬错误翻译成「要修什么」，同一类只列一次，最多六条。 */
export function summarizeReasons(issues: GenerationIssue[]): string {
  const seen = new Map<IssueCode, GenerationIssue>();
  for (const issue of issues) {
    if (!seen.has(issue.code)) seen.set(issue.code, issue);
  }
  const lines = [...seen.values()].slice(0, 6).map((issue) => {
    const label = ISSUE_LABELS[issue.code];
    const hint = REPAIR_HINTS[issue.code];
    return hint ? `- ${label}：${hint}` : `- ${label}：${issue.detail}`;
  });
  return lines.length > 0 ? lines.join("\n") : "- 回复不符合输出协议";
}

/** 给修复模型的可执行指令，比检查器的 detail 更直接。 */
const REPAIR_HINTS: Partial<Record<IssueCode, string>> = {
  player_control: "删掉替玩家说的话、做的动作和心情，只保留世界这一侧",
  player_block: "删掉 player 块，它不是模型该输出的东西",
  who_pronoun: "把 who 换成准确的角色名，不要用她、他、那个人",
  who_inexact: "把 who 换成角色卡上的完整名字",
  character_drift: "把 who 换回已经出场的角色名，不要保留没出场过的人",
  narrator_in_character: "旁白里不要出现第一人称「我」，改成讲述者的观察",
  act_overlong: "把这条 act 缩短到一个短动作，或整条改成 narr",
  act_multi_action: "一条 act 只留一个动作，其余并进 narr 或删掉",
  act_has_dialogue: "把 act 里的对白拆成 dlg，act 只留动作",
  act_has_thought: "把 act 里的心理、原因、评价并进 narr，act 只留看得见的动作",
  act_metaphor: "删掉 act 里的比喻和拟人，只留白描动作",
  act_result: "把动作造成的结果并进 narr，act 只留动作本身",
  dlg_has_action: "把 dlg 里的括号、星号、叙述前缀去掉，只留说出口的原话",
  dlg_markup: "删掉 dlg 里的标签和 JSON，只留说出口的原话",
  language_switch: "把对白改回玩家正在使用的语言，不要整句换成外语",
  no_blocks: "用 narr / act / dlg / scene 重新包一遍，不要输出裸文本",
  pseudo_tool_text: "删掉函数调用标签，只保留剧情正文",
};

/**
 * 从修复模型的输出里取出正文。
 *
 * 修复模型常见的多话形态：代码围栏、一句「以下是修复后的回复」、
 * 或者把整段再包一层。这里只做最小的清洗，判断合不合格仍交给质量门。
 */
export function extractRepairedText(raw: string): string {
  let text = raw.trim();
  // 去掉整段代码围栏
  const fence = /^```[a-zA-Z]*\s*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  if (fence) text = fence[1].trim();
  // 去掉第一行「以下是修复后的回复：」这类前言（后面必须紧跟块标记）
  text = text.replace(/^[^\n<]{0,40}\n(?=\s*<(?:narr|act|dlg|scene)\b)/i, "");
  return text.trim();
}

export interface RepairOutcome {
  /** 修复有没有拿到可用的文本（拿到不代表合格，还要再过质量门） */
  attempted: boolean;
  /** 修复后的文本；没有修出东西时是 null */
  text: string | null;
  /** 失败原因，给开发面板看 */
  note: string;
}

/** 修复提示词里引用的原文上限，防止把超长回复整段塞进去。 */
function clip(text: string, limit: number): string {
  const value = text.trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** 角色名和已知人名可能重复，去重后再写进提示词。 */
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
