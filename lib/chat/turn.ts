/**
 * 一轮对话的共享形状与纯辅助。
 *
 * 从 ChatScreen 摘出来的第一刀：类型和没有副作用的函数先离开组件，
 * 核心循环（组装、导演、流式、落地）逐步迁到 headless 控制器时以这里为家。
 */
import { parseBlocks, stripPseudoToolTags } from "@/lib/blocks";
import { embedDocument, type ChatDocument } from "@/lib/chat-document";
import type { ChatMessage } from "@/lib/prompt/types";
import type { StoredCg } from "@/lib/storage/types";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  /** 保留块标记的原始文本 */
  content: string;
  /** 新用户消息的实际发送版本；原始内容仍用于界面、编辑和导出。 */
  outboundContent?: string;
  cg?: StoredCg;
  swipes?: string[];
  swipeIndex?: number;
  chapterBreak?: boolean;
  image?: string;
  /** 本机模型看图后的描述，只发给不能看图的模型 */
  imageNote?: string;
  document?: ChatDocument;
}

export interface ChatError {
  status: number;
  code: string;
  message: string;
}

export interface PendingTool {
  id: string;
  name: string;
  arguments: string;
}

export function absorbToolCall(
  calls: PendingTool[],
  frame: { index: number; id?: string; name?: string; arguments?: string },
): void {
  while (calls.length <= frame.index) calls.push({ id: "", name: "", arguments: "" });
  const slot = calls[frame.index];
  if (frame.id) slot.id = frame.id;
  if (frame.name) slot.name = frame.name;
  if (frame.arguments) slot.arguments += frame.arguments;
}

/** 玩家那几轮在存储里带标记，导出时才能和旁白、对白区分开。 */
export function markPlayer(text: string): string {
  return `<player>${text}</player>`;
}

/** 取回玩家实际说了什么。旧会话里存的是纯文本，这里要能兼容。 */
export function playerText(content: string): string {
  const block = parseBlocks(content).find((b) => b.kind === "player");
  return block ? block.text : content;
}

/**
 * 本轮玩家输入进历史的形态。
 * 带 <player> 标记，让模型看到自己上一轮的输出格式时也能对上玩家的；
 * 服务端的 normalizeUserContent 会在组装时抹掉标记。
 */
export function historyContent(turn: Turn): string {
  // 模型偶尔把函数调用写成 XML 标签。原样存进历史，下一轮它就会在自己
  // 上一轮的输出里看见这种写法，从而有样学样。喂回去之前先剥掉。
  if (turn.role === "assistant") return stripPseudoToolTags(turn.content);
  const content = turn.role === "user" ? turn.outboundContent ?? turn.content : turn.content;
  const text = embedDocument(content, turn.document);
  if (!turn.imageNote) return text;
  return `${text}\n\n【图片】\n${turn.imageNote}`;
}

export function userTurnsAsMessages(turn: Turn): ChatMessage[] {
  return [{ role: "user", content: historyContent(turn) }];
}
