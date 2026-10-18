import type { ChatMessage, WorldBook } from "@/lib/prompt/types";
import type { BranchTree } from "@/lib/chat";
import type { SceneState } from "@/lib/scene";
import type { StoryThread } from "@/lib/story";

export type StoredRole = Extract<ChatMessage["role"], "user" | "assistant">;

/** 挂在某一条回复上的场景 CG。src 由生成后固化为本机 data URL。 */
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
  /**
   * 当前聊天专属的作者注。只放「这一轮怎么写」，不放世界设定。
   * 没写就用角色卡上的默认注记，再没有就没有。
   */
  authorNote?: StoredAuthorNote;
  /**
   * 场景状态：此刻在哪儿、什么时候、谁在场、正在发生什么。
   * 跟着会话走——重置会话就该回到开场的场景，所以不挂在长期记忆上。
   */
  sceneState?: SceneState;
  /**
   * 未完成的剧情线。比场景状态长命：一条线可以跨几十轮才交代完。
   * 同样跟着会话走，重置会话就从零开始攒。
   */
  storyThreads?: StoryThread[];
  /**
   * 当前聊天专属的世界书（Phase 8 第二阶段）。
   * 只影响这一场：临时加的地点、只在这条线上成立的组织，都放这里，
   * 不会跟着角色卡跑到别的故事里去。
   */
  chatLorebook?: WorldBook;
  /**
   * 分支（Phase 11.3）。不同选择形成不同剧情线，而不是覆盖原来的故事。
   * 挂在会话上：一条会话是一棵树，主干加若干从某条消息分出去的支线。
   */
  branchTree?: BranchTree;
  /** 当前正在看哪条分支。没记就是主干 */
  activeBranch?: string;
  createdAt: number;
  updatedAt: number;
}

/** 会话里存的作者注。和提示词层的 AuthorNote 同形，独立声明避免存储层依赖提示词层。 */
export interface StoredAuthorNote {
  text: string;
  /** 0 = 从不，1 = 每轮，N = 每 N 轮。默认 1 */
  frequency?: number;
  /** 插在历史倒数第几条之前。默认 1 = 最后一条玩家输入之前 */
  depth?: number;
  /** false 时整条停用 */
  enabled?: boolean;
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
