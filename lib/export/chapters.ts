import { parseBlocks } from "@/lib/blocks";

/** 没有场景切换、也没有手动标记时，满这么多轮玩家发言就新开一章。 */
export const CHAPTER_TURN_LIMIT = 30;

export interface ExportMessage {
  role: "user" | "assistant";
  /** 当前选中的那一条。其他 swipe 不要放进来。 */
  content: string;
  chapterBreak?: boolean;
  cgSrc?: string;
}

export interface ExportChapter {
  title: string;
  messages: ExportMessage[];
}

/**
 * 只取当前选中的 swipe。
 * 有 swipes 时以 swipeIndex 为准，content 若和它对不上也以数组里的那条为准，
 * 避免把没选中的重生成结果写进书里。
 */
export function selectedSwipe(message: {
  content: string;
  swipes?: string[];
  swipeIndex?: number;
}): string {
  const swipes = message.swipes?.filter((item) => item.length > 0);
  if (!swipes?.length) return message.content;
  const index = Math.min(Math.max(message.swipeIndex ?? swipes.length - 1, 0), swipes.length - 1);
  return swipes[index] ?? message.content;
}

function sceneTitle(content: string): string | null {
  const text = parseBlocks(content).find((block) => block.kind === "scene")?.text.trim();
  return text ? text.slice(0, 40) : null;
}

function uniqueTitle(title: string, used: Set<string>): string {
  const base = title.trim().slice(0, 40) || "未命名";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  const next = `${base} ${n}`;
  used.add(next);
  return next;
}

/**
 * 分章，三条规则同时生效：
 * 用户打了标记、出现新的场景块、或者这一章里的玩家发言已经满 30 轮。
 * 新章从触发的那条消息开始。
 */
export function splitChapters(
  messages: ExportMessage[],
  every = CHAPTER_TURN_LIMIT,
): ExportChapter[] {
  const used = new Set<string>();
  const chapters: ExportChapter[] = [];
  let current: ExportChapter = { title: uniqueTitle("开场", used), messages: [] };
  let userTurns = 0;
  let currentScene: string | null = null;

  const open = (title: string) => {
    if (current.messages.length > 0) chapters.push(current);
    current = { title: uniqueTitle(title, used), messages: [] };
    userTurns = 0;
    currentScene = null;
  };

  for (const message of messages) {
    const scene = message.role === "assistant" ? sceneTitle(message.content) : null;
    const hitLimit =
      message.role === "user" && userTurns >= every && current.messages.length > 0;
    const hitScene = !!scene && current.messages.length > 0 && scene !== currentScene;
    if (message.chapterBreak || hitLimit || hitScene) {
      const fallback = `第 ${chapters.length + 2} 章`;
      const previousScene: string | null = currentScene;
      open(message.chapterBreak ? scene ?? fallback : hitScene ? scene! : fallback);
      if (!hitScene) currentScene = previousScene;
    } else if (scene && current.messages.length === 0) {
      current = { ...current, title: uniqueTitle(scene, used) };
    }

    current.messages.push(message);
    if (scene) currentScene = scene;
    if (message.role === "user") userTurns += 1;
  }

  if (current.messages.length > 0) chapters.push(current);
  if (chapters.length === 0) chapters.push({ title: "开场", messages: [] });
  return chapters;
}
