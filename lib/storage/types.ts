import type { ChatMessage } from "@/lib/prompt/types";

export type StoredRole = Extract<ChatMessage["role"], "user" | "assistant">;

/** 挂在某一条回复上的场景 CG。图片本身是 data URL 或上游临时地址。 */
export interface StoredCg {
  id: string;
  prompt: string;
  src: string;
  sceneKey: string;
  source: "manual" | "auto";
  /** 生成时的轮次，自动生图用它做「每 10 轮一张」的间隔 */
  turn: number;
  createdAt: number;
}

export interface StoredMessage {
  id: string;
  role: StoredRole;
  /** 保留块标记的原始文本，渲染时才解析成块 */
  content: string;
  createdAt: number;
  cg?: StoredCg;
  /** 同一条回复的几次生成。导出只用 swipeIndex 指到的那条。 */
  swipes?: string[];
  swipeIndex?: number;
  /** 用户手动从这里另起一章 */
  chapterBreak?: boolean;
  /** 玩家这条消息附的图，jpeg data URL */
  image?: string;
  /** 不能看图的模型用本机模型认出来的文字，只进提示词 */
  imageNote?: string;
  /** 玩家这条消息附的文档。正文在发请求时才拼进提示词 */
  document?: { name: string; text: string };
}

/**
 * 追加式会话：消息只往后加，不改写已有的。
 * 回退就是把尾部截掉，重新生成就是丢掉最后一条 assistant 再追加。
 */
export interface ChatSession {
  id: string;
  cardId: string;
  cardName: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionStore {
  list(): Promise<ChatSession[]>;
  get(id: string): Promise<ChatSession | null>;
  save(session: ChatSession): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(input: {
  cardId: string;
  cardName: string;
  opening: string;
}): ChatSession {
  const now = Date.now();
  return {
    id: createId(),
    cardId: input.cardId,
    cardName: input.cardName,
    messages: [
      {
        id: createId(),
        role: "assistant",
        content: input.opening,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendMessage(
  session: ChatSession,
  role: StoredRole,
  content: string,
): ChatSession {
  return {
    ...session,
    messages: [
      ...session.messages,
      { id: createId(), role, content, createdAt: Date.now() },
    ],
    updatedAt: Date.now(),
  };
}
