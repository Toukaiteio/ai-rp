import type { ChatMessage } from "./types";
import { DIRECTOR_MODE_HINT, RESPONSE_MODES, type ResponseMode } from "./mode";
import { sanitizePatch, type ScenePatch } from "@/lib/scene";
import { sanitizeThreadPatch, type ThreadPatchEntry } from "@/lib/story";

/** 导演计划中的一个叙事节拍。正文模型会按顺序执行这些节拍。 */
export interface TurnBeat {
  kind: "narr" | "act" | "dlg" | "scene";
  text: string;
  who?: string;
}

/** 计划阶段要执行的工具调用。参数保持为 JSON 对象，交给调用方执行。 */
export interface TurnToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TurnPlan {
  beats: TurnBeat[];
  toolCalls: TurnToolCall[];
  /**
   * 导演判断的本轮回应模式。
   * 它看过完整聊天记录，比只看玩家这一句的推断准，所以允许覆盖。
   * 老数据或导演没给时留空，由调用方按玩家输入推断。
   */
  mode?: ResponseMode;
  /**
   * 这一轮的状态变化（Phase 5）。
   *
   * 由导演顺便给出，而不是每轮再叫一次模型重写全部状态：
   * 它本来就已经读过完整聊天记录，多输出一个字段几乎不花钱。
   * 没给的字段保持原样，绝不用空值清空已有状态。
   */
  statePatch?: ScenePatch;
  /**
   * 剧情线的变化（Phase 6）。只写变了的那些，没提到的线保持原样。
   * 标 resolved 表示这条线已经交代完了；已解决的线不会被重新打开。
   */
  threadPatch?: ThreadPatchEntry[];
}

export interface DirectorMessagesOptions {
  /** 可选的额外导演指令，放在原始聊天记录之前。 */
  instruction?: string;
  eventsEnabled?: boolean;
  goalsEnabled?: boolean;
  stagnantTurns?: number;
  eventAfterTurns?: number;
}

/** 把回合级 system 消息插到当前用户输入之前，保持用户消息位于请求末尾。 */
export function insertBeforeCurrentUser(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const currentUserIndex = [...messages].findLastIndex((item) => item.role === "user");
  if (currentUserIndex < 0) return [...messages, message];
  return [
    ...messages.slice(0, currentUserIndex),
    message,
    ...messages.slice(currentUserIndex),
  ];
}

/**
 * 导演阶段顺带做状态提取的说明（5.2 的第一版做法）。
 *
 * 三条约束写在提示里，直接对应 5.3：
 * 只有已经明确发生的事才能标 confirmed；推断标 inferred；拿不准标 uncertain。
 * 不写清楚，模型会把「她可能在躲什么」这种猜测写成既定事实，然后永久留在状态里。
 */
export const DIRECTOR_STATE_HINT = [
  "另外顺便给出这一轮的状态变化 statePatch，只写**发生变化**的字段，没变就不要写。",
  "可用字段：location（地点）、time（时间）、weather（天气）、presentCharacters（在场的人，数组）、currentAction（正在发生什么，一句话）、emotionalTone（气氛）、unresolvedThreads（还没收的线，数组）。",
  "如果状态里还没有地点或时间，这一轮要按角色卡的场景或正文里明确写到的东西补上——这两个字段空着，讲述者就不知道现在在哪儿。",
  "每个字段都要标可信度：正文里明确写到的事（人在哪儿、什么时候、谁在场、做了什么）标 confirmed；气氛、动机、猜测标 inferred；拿不准标 uncertain。",
  "宁可标 inferred，也不要把猜测写成 confirmed——confirmed 会被当成既定设定，后面很难改回来。",
  "没有变化就输出空的 statePatch。",
].join("\n");
/**
 * 导演阶段顺带维护剧情线的说明。
 *
 * 三条约束对应 6.4「防止的问题」：
 * - 只登记「还欠着的事」，不要求这一轮去推进；
 * - 只有真的交代完了才标 resolved，不能因为提到了就当成收线；
 * - 没变化就不要写，避免每轮都把整张表重写一遍。
 */
export const DIRECTOR_THREAD_HINT = [
  "另外维护剧情线 threadPatch：只登记**还欠着的事**（悬念、约定、没解释的疑点），不登记已经交代完的普通事件。",
  "每条线写 title（一句话概括）、summary（现在知道什么，可选）、status、importance（1 到 5）、relatedCharacters（相关的人）。",
  "status 三档：open（还开着）、resolved（这一轮明确交代完了）、dormant（暂时搁下，以后还能捡起来）。",
  "只有正文里真的把事情说清楚了才标 resolved；只是又提了一次、或者你觉得该收了，都还是 open。",
  "importance 按它对整段关系或主线的影响给：主线悬念 4 到 5，日常小事 1 到 2。",
  "目标系统开启时，只有玩家明确想完成的事情才标 kind=goal，并补充可验证的 summary 与克制的 reward；普通悬念不要标目标。",
  "这一轮没有新的线、也没有线被交代完，就输出空的 threadPatch。不要为了凑数登记。",
].join("\n");

export const DIRECTOR_SYSTEM_PROMPT = [
  "你是故事导演，只负责为下一轮回复提供轻量的场景重点和叙事方向，不写最终正文。",
  "根据聊天记录规划 2 到 4 个按顺序参考的叙事节拍，覆盖环境或在场者的反应、角色的具体动作和一句对白；short 模式可以只有一个节拍。不要只给一个孤立动作或一句台词。节拍是场景意图提示，不是剧本，不要预写必须照搬的完整台词。标出角色当下的处境、关系和可能的情绪方向，让最终讲述者自己用角色的口吻临场表达。act 节拍只能是旁观者能直接看见的一个动作、姿势或表情，只保留一个动作中心；不要把说话、声音、心理判断、原因、评价或结果塞进 act。不要替玩家做决定，只使用聊天记录和当前场景里已经出现的人与物，不要凭空新增角色或关键设定。",
  "玩家不是可发言角色：不要给玩家安排替身、化身或同名角色，beats 里的 who 不能是玩家或玩家的名字。",
  "历史里的 act 可能不合规，不要模仿历史 act 的长度或内容；不确定是否是单一可见动作时，把节拍标为 narr。计划中的 narr、act、dlg、scene、player、diag 只能作为平级节拍，不能嵌套；每个标签必须成对闭合，禁止自闭合或交叉闭合。",
  "计划中的对白语言必须跟随玩家最近一条输入的主要语言。不要因为角色卡、角色名或原作语言而把中文对话改成日语或英语。",
  DIRECTOR_MODE_HINT,
  DIRECTOR_STATE_HINT,
  DIRECTOR_THREAD_HINT,
  "只输出 JSON 对象，格式为 {\"beats\":[{\"kind\":\"narr|act|dlg|scene\",\"text\":\"...\",\"who\":\"可选角色名\"}],\"toolCalls\":[{\"name\":\"...\",\"arguments\":{}}],\"mode\":\"normal|short|dialogue|scene|continue\",\"statePatch\":{\"location\":\"...\",\"time\":\"...\",\"presentCharacters\":[\"...\"],\"currentAction\":\"...\",\"emotionalTone\":\"...\",\"unresolvedThreads\":[\"...\"],\"status\":{\"location\":\"confirmed|inferred|uncertain\",\"currentAction\":\"confirmed|inferred|uncertain\"}},\"threadPatch\":[{\"title\":\"...\",\"summary\":\"...\",\"status\":\"open|resolved|dormant\",\"importance\":1,\"relatedCharacters\":[\"...\"],\"kind\":\"thread|goal\",\"reward\":\"可选奖励\"}]}。",
  "status 必须写，它是每个字段的可信度；只写你这一轮真的给出的字段。",
  "beats 至少有一个；toolCalls 没有时输出空数组；mode 从给定取值里选一个；没有状态变化时 statePatch 输出空对象；没有剧情线变化时 threadPatch 输出空数组。不要输出 Markdown、代码围栏或解释文字。",
].join("\n");

/**
 * 导演阶段最多看多少条对话。
 *
 * 导演只负责这一轮的节拍和状态变化，整份上下文（System、世界书、卡设定）
 * 对它是噪音：这些内容每轮都要重新 prefill 一遍，直接翻倍首字时间。
 * 只发最近的对话，等于把导演的输入砍掉大半，计划质量不受影响。
 */
export const DIRECTOR_HISTORY_MESSAGES = 16;

/** 导演只需要对话本身：system 层是给讲述者的规则，不是聊天记录。 */
function directorHistory(messages: ChatMessage[]): ChatMessage[] {
  // 只带回合层（语言锁定、当前场景、本轮模式）。它不是最后一条 system：
  // 记忆目录和 post_history_instructions 都排在它后面，按位置取会取错。
  const turnLayer = [...messages].reverse().find(
    (message) => message.role === "system" && message.content.includes("本轮模式（"),
  );
  const dialogue = messages.filter((message) => message.role !== "system");
  const recent = dialogue.length > DIRECTOR_HISTORY_MESSAGES
    ? dialogue.slice(-DIRECTOR_HISTORY_MESSAGES)
    : dialogue;
  return turnLayer ? [turnLayer, ...recent] : recent;
}

/**
 * 这一轮要不要跑导演阶段。
 *
 * 导演存在的唯一目的是顺带产出场景状态和剧情线；两个系统都关掉时，
 * 它只剩节拍提示，却仍然要一次完整的上游调用并卡在首字之前。
 * 关掉就该真的省掉这次调用，而不是只把结果丢掉。
 */
export function shouldPlanTurn(
  systems: { events?: boolean; goals?: boolean } | undefined,
): boolean {
  return systems?.events !== false || systems?.goals !== false;
}

/**
 * 导演阶段的输出上限。状态和剧情线都在同一份 JSON 里，太小会把尾部截断。
 * 推理模型会先烧掉一大段 reasoning 再写 JSON，几千的余量对它们都不够，
 * 所以这里只当余量上限用：非推理模型输出完就停，不会真的花这么多。
 */
export const DIRECTOR_MAX_TOKENS = 65536;

/** 把原始聊天记录包装成导演阶段的 system + user 消息。 */
export function buildDirectorMessages(
  messages: ChatMessage[],
  options: DirectorMessagesOptions = {},
): ChatMessage[] {
  const instruction = options.instruction?.trim();
  const systems = options.eventsEnabled === undefined && options.goalsEnabled === undefined
    ? ""
    : [
        options.eventsEnabled === false
          ? "事件系统已关闭：不要主动制造外部事件或强行改变局势。"
          : `事件系统已开启：优先从玩家最新消息提取意图；当前已连续 ${options.stagnantTurns ?? 0} 轮没有实质推进，只有达到 ${Math.max(2, options.eventAfterTurns ?? 4)} 轮时才提出一个低强度、可被玩家回应的事件，不要连续制造事件。`,
        options.goalsEnabled === false
          ? "目标系统已关闭：不要创建或维护 RPG 目标、任务或奖励。"
          : "目标系统已开启：只有玩家明确表达想做的事，或剧情自然形成可验证的承诺时，才登记一个目标；目标应有清晰完成条件和克制的奖励，不要每轮创建。",
      ].join("\n");
  const payload = JSON.stringify(directorHistory(messages));
  return [
    { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
    {
      role: "user",
      content: [systems, instruction, `聊天记录（JSON）：\n${payload}`].filter(Boolean).join("\n\n"),
    },
  ];
}

/** 安全解析导演输出；任何格式或字段错误都返回 null，不把未知 JSON 传播出去。 */
export function parseTurnPlan(text: string): TurnPlan | null {
  if (typeof text !== "string") return null;

  const source = stripJsonFence(text).trim();
  if (!source) return null;

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    // 输出被 max_tokens 截断时，尾部 statePatch/threadPatch 会只剩半段 JSON。
    // 整份丢掉等于白等一次调用，所以先削到最后一个完整字段再试。
    value = parseTruncatedPlan(source);
    if (value === null) return null;
  }

  if (!isRecord(value) || !Array.isArray(value.beats) || !Array.isArray(value.toolCalls)) {
    return null;
  }

  const beats: TurnBeat[] = [];
  for (const beat of value.beats) {
    if (!isRecord(beat)) return null;
    if (
      beat.kind !== "narr" &&
      beat.kind !== "act" &&
      beat.kind !== "dlg" &&
      beat.kind !== "scene"
    ) {
      return null;
    }
    if (typeof beat.text !== "string" || !beat.text.trim()) return null;
    if (beat.who !== undefined && (typeof beat.who !== "string" || !beat.who.trim())) {
      return null;
    }
    beats.push({
      kind: beat.kind,
      text: beat.text,
      ...(beat.who === undefined ? {} : { who: beat.who }),
    });
  }
  if (beats.length === 0) return null;

  const toolCalls: TurnToolCall[] = [];
  for (const call of value.toolCalls) {
    if (!isRecord(call) || typeof call.name !== "string" || !call.name.trim()) return null;
    if (!isRecord(call.arguments)) return null;
    toolCalls.push({ name: call.name, arguments: call.arguments });
  }

  // mode 是可选增强：取值不认识就当成没给，让调用方按玩家输入推断，
  // 不能因为一个陌生的 mode 把整份计划丢掉。
  const mode = isResponseMode(value.mode) ? value.mode : undefined;
  // statePatch 同理：坏字段在 sanitizePatch 里就被丢掉了，不会影响计划本身
  const statePatch = sanitizePatch(value.statePatch) ?? undefined;
  // threadPatch 只保留合法条目；一条都没有就等于没给
  const threadEntries = sanitizeThreadPatch(value.threadPatch);
  const threadPatch = threadEntries.length > 0 ? threadEntries : undefined;

  return {
    beats,
    toolCalls,
    ...(mode ? { mode } : {}),
    ...(statePatch ? { statePatch } : {}),
    ...(threadPatch ? { threadPatch } : {}),
  };
}

function isResponseMode(value: unknown): value is ResponseMode {
  return typeof value === "string" && (RESPONSE_MODES as readonly string[]).includes(value);
}

/**
 * 截断补救：从尾部逐步削掉不完整的部分，直到能解析。
 *
 * 只在 JSON.parse 失败时走这条路，正常输出不受影响。削到某个逗号位置时，
 * 上层可能已经拿到完整的 beats 和 mode，丢掉的只是半截 statePatch——
 * 那比「整份计划作废、白等一次调用」好得多。
 */
function parseTruncatedPlan(source: string): Record<string, unknown> | null {
  // 从末尾找一个还没闭合的字段边界：逗号或开引号之前的位置
  let cut = source.lastIndexOf(",");
  let guard = 0;
  while (cut > 0 && guard < 200) {
    guard += 1;
    const candidate = `${source.slice(0, cut)}\n}`;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.beats)) {
        return {
          ...parsed,
          toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
        };
      }
    } catch {
      // 继续往前削
    }
    cut = source.lastIndexOf(",", cut - 1);
  }
  return null;
}

/** 把已校验的计划交给最终讲述者；计划是约束，不是需要照抄的正文。 */
export function formatTurnPlan(plan: TurnPlan): string {
  return [
    "下面的导演计划只提供本轮的场景重点和可能的叙事方向，不是需要逐项执行的脚本。",
    "请先自然回应玩家最近一句，再参考计划写最终回复。不要逐字照抄计划里的 text，不要为了完成每个 beat 补充无关内容；必要时可以合并、展开或忽略节拍，让玩家保留回应空间。没有列出的角色不要强行发言。",
    // 回合模式已经写在回合层里了，这里只说一句「以那条为准」，
    // 避免同一份要求出现两种措辞，模型不知道该听哪个。
    plan.mode ? "本轮模式以回合层里那条「本轮模式」为准，计划里的 mode 只是同一个意思。" : "",
    JSON.stringify(plan),
  ]
    .filter(Boolean)
    .join("\n");
}

function stripJsonFence(text: string): string {
  const match = /^\s*```(?:json)?\s*\r?\n([\s\S]*?)\r?\n\s*```\s*$/i.exec(text);
  return match ? match[1] : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
