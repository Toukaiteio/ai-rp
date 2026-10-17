import type { ChatMessage } from "./types";

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
}

export interface DirectorMessagesOptions {
  /** 可选的额外导演指令，放在原始聊天记录之前。 */
  instruction?: string;
}

export const DIRECTOR_SYSTEM_PROMPT = [
  "你是故事导演，只负责为下一轮回复提供轻量的场景重点和叙事方向，不写最终正文。",
  "根据聊天记录规划少量、按顺序参考的叙事节拍。节拍是场景意图提示，不是剧本，不要预写必须照搬的完整台词。标出角色当下的处境、关系和可能的情绪方向，让最终讲述者自己用角色的口吻临场表达。不要替玩家做决定，不要创造聊天记录中没有依据的关键设定。",
  "计划中的对白语言必须跟随玩家最近一条输入的主要语言。不要因为角色卡、角色名或原作语言而把中文对话改成日语或英语。",
  "只输出 JSON 对象，格式为 {\"beats\":[{\"kind\":\"narr|act|dlg|scene\",\"text\":\"...\",\"who\":\"可选角色名\"}],\"toolCalls\":[{\"name\":\"...\",\"arguments\":{}}]}。",
  "beats 至少有一个；toolCalls 没有时输出空数组。不要输出 Markdown、代码围栏或解释文字。",
].join("\n");

/** 把原始聊天记录包装成导演阶段的 system + user 消息。 */
export function buildDirectorMessages(
  messages: ChatMessage[],
  options: DirectorMessagesOptions = {},
): ChatMessage[] {
  const instruction = options.instruction?.trim();
  const payload = JSON.stringify(messages);
  return [
    { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
    {
      role: "user",
      content: instruction
        ? `${instruction}\n\n聊天记录（JSON）：\n${payload}`
        : `聊天记录（JSON）：\n${payload}`,
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
    return null;
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

  return { beats, toolCalls };
}

/** 把已校验的计划交给最终讲述者；计划是约束，不是需要照抄的正文。 */
export function formatTurnPlan(plan: TurnPlan): string {
  return [
    "下面的导演计划只提供本轮的场景重点和可能的叙事方向，不是需要逐项执行的脚本。",
    "请先自然回应玩家最近一句，再参考计划写最终回复。不要逐字照抄计划里的 text，不要为了完成每个 beat 补充无关内容；必要时可以合并、展开或忽略节拍，让玩家保留回应空间。没有列出的角色不要强行发言。",
    JSON.stringify(plan),
  ].join("\n");
}

function stripJsonFence(text: string): string {
  const match = /^\s*```(?:json)?\s*\r?\n([\s\S]*?)\r?\n\s*```\s*$/i.exec(text);
  return match ? match[1] : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
