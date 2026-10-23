import { stripBlocks } from "@/lib/blocks";
import { hasMarkedBase64, USER_MESSAGE_BASE64_INSTRUCTION } from "@/lib/chat";
import type { ChatMessage } from "@/lib/prompt/types";

/**
 * 开场建议输入是现场生成的，不写死在卡里。
 * 角色各有各的语境，固定一套换个人就对不上；让模型看着最近几轮对话现想才贴题。
 */

export const SUGGESTION_SYSTEM_PROMPT = [
  "你在给一个角色扮演客户端生成「玩家接下来可能输入什么」的建议。",
  "只输出 3 条，每条一行。",
  "不要编号，不要引号，不要解释，不要输出任何别的东西。",
  "每条 5 到 18 个字，用玩家第一人称，写玩家会打出来的话。",
  "必须贴住最近这轮对话里的具体人事，不要写「继续」「然后呢」这种放到哪儿都成立的空话。",
].join("\n");

/** 只看最近这几轮，越早的内容越不该影响当前建议。 */
const SUGGESTION_CONTEXT_TURNS = 6;

export function buildSuggestionMessages(history: ChatMessage[]): ChatMessage[] {
  const transcript = history
    .slice(-SUGGESTION_CONTEXT_TURNS)
    .map((message) => {
      const text = stripBlocks(message.content, { quoteDialogue: false });
      return `${message.role === "user" ? "玩家" : "角色"}：${text}`;
    })
    .join("\n");

  return [
    {
      role: "system",
      content: history.some((message) => message.role === "user" && hasMarkedBase64(message.content))
        ? `${SUGGESTION_SYSTEM_PROMPT}\n\n${USER_MESSAGE_BASE64_INSTRUCTION}`
        : SUGGESTION_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `最近的对话：\n${transcript}\n\n给出 3 条玩家接下来可能输入的话。`,
    },
  ];
}

/** 模型偶尔会把三条挤在一行，或者加上编号。这里按编号和中文标点再切一次。 */
function splitInline(raw: string): string[] {
  return raw
    .split(/(?:\d+\s*[.、)）]|；|;|｜|\|)+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tidy(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·]|\d+\s*[.、)）])\s*/, "")
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .trim();
}

/**
 * 把模型的自由输出收拾成干净的几条。
 * 优先按行切；只有一行（或者切不出两条）时再按编号、分号这类内联分隔符切。
 */
export function parseSuggestions(raw: string): string[] {
  const byLine = raw
    .split("\n")
    .map(tidy)
    .filter((line) => line.length > 0);

  const candidates = byLine.length >= 2 ? byLine : splitInline(raw).map(tidy);

  return candidates
    .filter((line) => line.length >= 2 && line.length <= 30)
    .slice(0, 3);
}
