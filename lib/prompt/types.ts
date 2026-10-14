export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Anthropic 的缓存断点标记。只有设置了 cache_control 的消息才是断点，
   * 各家适配层自己决定要不要读它。
   */
  cache_control?: { type: "ephemeral" };
}

/* ------------------------------------------------------------------ 世界书 */

/**
 * 可选逻辑。两个及以上关键词时用 AND 还是 OR 判定。
 * 没写就按 constant 走：constant 为 true 时无条件注入。
 */
export type EntryLogic = "and" | "or";

/** 条目插在哪儿。before_char 会排在角色卡之前，用来压住设定冲突。 */
export type EntryPosition =
  | "before_char"
  | "after_char"
  | "before_scene"
  | "after_scene"
  | "in_chat";

export interface WorldBookEntry {
  keys: string[];
  content: string;
  constant?: boolean;
  /** 关键词判定方式。没写按 or：命中任意一个词就注入 */
  logic?: EntryLogic;
  /** 同一 position 内的排序，小的在前 */
  order?: number;
  /** 插入位置，默认 after_char */
  position?: EntryPosition;
  /** 0 到 100。命中后按此概率注入，默认 100 */
  probability?: number;
  /** 只扫描最近这几条消息。不设就用全局 scanDepth */
  scanDepth?: number;
  /** 命中后是否继续扫描别的条目，默认 false */
  cascade?: boolean;
  /** false 则整条停用 */
  enabled?: boolean;
}

export interface WorldBook {
  name?: string;
  entries: WorldBookEntry[];
  /** 全局默认扫描深度，默认 4 */
  scanDepth?: number;
  /** 单次注入的条目上限，默认 8 */
  budgetCap?: number;
  /** 单次注入的文本预算，默认 2000 token */
  tokenCap?: number;
  /** true 时命中条目的 keys 继续参与扫描，默认 false */
  recursiveScan?: boolean;
}

/* ------------------------------------------------------------------ 摘要 */

/**
 * 滚动摘要。增量更新：只总结「上次压到哪」之后新增的部分，
 * 再把结果挂到已有摘要后面，不每轮重写整段。
 */
export interface RollingSummary {
  text: string;
  /** 已经总结到历史里的哪一条（用消息 id），下一次从这里之后开始 */
  coveredIndex: number;
  /** 生成这段摘要时压缩掉的消息数，用于统计 */
  compressedCount: number;
  updatedAt?: number;
}

/** 结构化关键事实。摘要会漂移，这类事实必须记住就不漂移。 */
export interface KeyFacts {
  /** 人物：名字 → 一句话现状，最多 20 条 */
  characters: Record<string, string>;
  /** 地点：名字 → 一句话现状 */
  places: Record<string, string>;
  /** 旗标：事件名 → 是否发生（或状态字符串） */
  flags: Record<string, boolean | string>;
}

export function emptyKeyFacts(): KeyFacts {
  return { characters: {}, places: {}, flags: {} };
}

/* ------------------------------------------------------------------ Author's Note */

/** 0 = 从不，1 = 每轮，N = 每 N 轮。 */
export type NoteFrequency = number;

export type NotePosition =
  | "after_scenario"
  | "after_char"
  | "in_chat";

export interface AuthorNote {
  text: string;
  /** 默认 1 */
  frequency?: NoteFrequency;
  /** 默认 after_scenario */
  position?: NotePosition;
  /** 排在聊天历史里的第几条之后（0 = 最末），仅在 position 为 in_chat 时有用 */
  depth?: number;
}

/* ------------------------------------------------------------------ 组装输入 */

export interface AssembleInput {
  card: CharacterCardCore;
  /** 世界书。简化版只有 keys/content/constant 也能跑 */
  lorebook?: WorldBook;
  /** 玩家扮演的角色设定，可选 */
  persona?: string;
  /** 完整历史，按时间正序。组装器自己决定丢什么 */
  history: ChatMessage[];
  /**
   * 当前这一轮的确定性依据。
   * 概率条目与摘要判定的随机源必须是可复现的，
   * 否则同样输入两次会得到不同输出，前缀就不稳定了。
   */
  seed: number;
  /** 已经跑过的轮次，用于 Author's Note 的频率判定 */
  turn?: number;
  summary?: RollingSummary;
  facts?: KeyFacts;
  authorNote?: AuthorNote;
  style?: StyleId;
  userName?: string;
  budget: number;
  /** 是否给前缀打缓存断点 */
  cache?: boolean;
}

/** 组装器只需要这几个角色卡字段，多给不用。 */
export interface CharacterCardCore {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  /** 卡作者写的额外系统提示，接在核心规则后面 */
  system_prompt?: string;
  /** 对话示例。稳定内容，进前缀，不进历史预算 */
  mes_example?: string;
  /** 长对话后的人设兜底，贴在历史后面，靠后才能压住漂移 */
  post_history_instructions?: string;
}

export type StyleId = "haruhi" | "mushoku";

/* ------------------------------------------------------------------ 输出 */

export interface BudgetReport {
  max: number;
  used: number;
  remaining: number;
  /** 各段实际用量 */
  blocks: Record<string, number>;
  /** 被丢掉的历史条数 */
  dropped: number;
  kept: number;
  /** 世界书注入了几条 */
  lorebookEntries: number;
}

export interface AssembleResult {
  messages: ChatMessage[];
  budget: BudgetReport;
  /**
   * 前缀指纹。只要前缀（System + 角色卡 + 风格 + 世界书 + 摘要）字节级不变，
   * 这个值就不变，可以直接当缓存版本用。
   */
  cacheKey: string;
  /** 这一次是否刚好触发了压缩阈值（由调用方决定要不要压） */
  needsSummarize: boolean;
}
