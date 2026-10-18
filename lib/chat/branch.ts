/**
 * 分支聊天（Phase 11.3）。
 *
 * 目的：**不同选择形成不同剧情线，而不是覆盖原来的故事。**
 *
 * 重新生成和编辑本质上都是「这一轮换个写法」。如果只保留最新一版，
 * 玩家试过的另一条路就永久消失了。分支把「从哪条消息分出去的」
 * 记下来，每条分支各自往下长。
 *
 * 数据结构按建议的形状，另加两处：
 * - `messages`：分支自己的消息。没有它，「分支」只是个标签；
 * - `note`：为什么分出来。回头翻的时候能想起当时在想什么。
 *
 * 分支是**会话内的**结构：一条会话有一个主干加若干分支，
 * 所以它挂在 ChatSession 上，不单独开一个存储层。
 */

export interface ChatBranch {
  id: string;
  /** 从哪条消息分出去的。空串表示从开场分出去 */
  parentMessageId: string;
  title?: string;
  createdAt: number;
}

/** 一条分支的完整内容。主干用 `id: "main"`。 */
export interface BranchTree {
  branches: ChatBranch[];
  /** 每条分支各自的消息 id 列表 */
  messages: Record<string, string[]>;
}

export const MAIN_BRANCH = "main";
export const MAIN_TITLE = "主线";

/** 分支标题的长度上限。它显示在切换器里，不能长。 */
export const MAX_TITLE_CHARS = 24;
/** 一条会话最多留多少条分支。 */
export const MAX_BRANCHES = 12;

export function mainBranch(): ChatBranch {
  return { id: MAIN_BRANCH, parentMessageId: "", title: MAIN_TITLE, createdAt: 0 };
}

/** 从哪条消息分出去。给界面显示「从第几轮分出来的」用。 */
export function describeBranch(branch: ChatBranch, index: number): string {
  if (branch.id === MAIN_BRANCH) return MAIN_TITLE;
  const title = branch.title?.trim() || `分支 ${index}`;
  return title;
}

/**
 * 建一条新分支。
 *
 * id 由调用方给（时间戳或随机串都行），这个模块不引入随机源——
 * 纯函数才好测。同一条消息上可以分多条，id 不重复就行。
 */
export function createBranch(params: {
  id: string;
  parentMessageId: string;
  title?: string;
  createdAt: number;
  /** 分出去时复制过来的消息 id。分支从这一刻开始，和主干共享到这里 */
  inheritedMessageIds: readonly string[];
  existing?: readonly ChatBranch[];
}): { tree: BranchTree; branch: ChatBranch } | null {
  const existing = params.existing ?? [];
  if (existing.length >= MAX_BRANCHES) return null;
  if (existing.some((branch) => branch.id === params.id)) return null;

  const branch: ChatBranch = {
    id: params.id,
    parentMessageId: params.parentMessageId,
    ...(params.title?.trim() ? { title: clip(params.title, MAX_TITLE_CHARS) } : {}),
    createdAt: params.createdAt,
  };

  return {
    branch,
    tree: {
      branches: [...existing, branch],
      messages: { [params.id]: [...params.inheritedMessageIds] },
    },
  };
}

/**
 * 一条分支从哪条消息接下去。
 *
 * 找不到父消息（被删了、或者旧存档没记）就退到主干末尾——
 * 宁可接在末尾，也不要让这条分支变成空的。
 */
export function branchPoint(
  branch: ChatBranch,
  mainMessages: readonly string[],
): number {
  if (branch.id === MAIN_BRANCH) return mainMessages.length;
  if (!branch.parentMessageId) return 0;
  const index = mainMessages.indexOf(branch.parentMessageId);
  return index < 0 ? mainMessages.length : index + 1;
}

/**
 * 切到某条分支时，主干上要显示到哪一条。
 *
 * 分支不是独立的一棵新树，而是「主干 + 从某点起换成另一串」。
 * 所以切换时要给出：主干留到第几条 + 接上这条分支的消息。
 */
export function resolveBranch(
  branch: ChatBranch,
  tree: BranchTree,
  mainMessages: readonly string[],
): { baseIds: string[]; branchIds: string[] } {
  const point = branchPoint(branch, mainMessages);
  return {
    baseIds: mainMessages.slice(0, point),
    branchIds: [...(tree.messages[branch.id] ?? [])],
  };
}

/** 往一条分支上追加消息 id。主干不在这里管。 */
export function appendToBranch(
  tree: BranchTree,
  branchId: string,
  messageIds: readonly string[],
): BranchTree {
  if (branchId === MAIN_BRANCH) return tree;
  const current = tree.messages[branchId] ?? [];
  return { ...tree, messages: { ...tree.messages, [branchId]: [...current, ...messageIds] } };
}

/** 删掉一条分支。主干不能删。 */
export function removeBranch(tree: BranchTree, branchId: string): BranchTree {
  if (branchId === MAIN_BRANCH) return tree;
  const messages = { ...tree.messages };
  delete messages[branchId];
  return {
    branches: tree.branches.filter((branch) => branch.id !== branchId),
    messages,
  };
}

/** 旧存档补全。坏值丢掉，主干永远在。 */
export function normalizeTree(value: unknown): BranchTree {
  const empty: BranchTree = { branches: [mainBranch()], messages: { [MAIN_BRANCH]: [] } };
  if (!isRecord(value)) return empty;

  const branches: ChatBranch[] = [mainBranch()];
  const seen = new Set<string>([MAIN_BRANCH]);
  for (const item of Array.isArray(value.branches) ? value.branches : []) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 60) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    branches.push({
      id,
      parentMessageId:
        typeof item.parentMessageId === "string" ? item.parentMessageId.slice(0, 60) : "",
      ...(typeof item.title === "string" && item.title.trim()
        ? { title: clip(item.title, MAX_TITLE_CHARS) }
        : {}),
      createdAt:
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? Math.floor(item.createdAt)
          : 0,
    });
    if (branches.length >= MAX_BRANCHES) break;
  }

  const messages: Record<string, string[]> = { [MAIN_BRANCH]: [] };
  const raw = isRecord(value.messages) ? value.messages : {};
  for (const branch of branches) {
    const list = raw[branch.id];
    messages[branch.id] = Array.isArray(list)
      ? list.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 2000)
      : [];
  }

  return { branches, messages };
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
