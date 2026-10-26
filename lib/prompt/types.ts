import type { Journal, ToolTrace } from "@/lib/memory/journal";
import type { SceneState } from "@/lib/scene";
import type { StoryThread } from "@/lib/story";
import type { CharacterVoiceProfile } from "@/lib/voice";
import type { CardAttachment } from "@/lib/attachments";
import type { WorldBookReport } from "./worldbook";
import type { PromptInspector } from "./inspector";
import type { ResponseMode } from "./mode";

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
  /**
   * 激活后额外保持激活的轮数（酒馆 sticky）。期间不需要关键词再命中。
   * 只对关键词条目生效，常驻条目本来就每轮都在。
   */
  sticky?: number;
  /** sticky 窗口结束后多少轮内不能再激活（酒馆 cooldown） */
  cooldown?: number;
  /** 会话开始的头几轮不激活（酒馆 delay）。第 N 轮起才参与匹配。 */
  delay?: number;
}

/** 一条世界书条目的时效记录：上次激活的轮次，以及 sticky 还剩几轮。 */
export interface LorebookTimingEntry {
  lastTurn: number;
  stickyLeft: number;
}

/**
 * 世界书时效状态，按 `${来源}#${条目在书内的序号}` 记。
 *
 * 序号是书在磁盘上的数组下标，改动一本书的条目顺序会让后续记录对错位——
 * 和酒馆的 UID 行为一致，属已知取舍。三来源分开计数，互不影响。
 */
export type LorebookTimingState = Record<string, LorebookTimingEntry>;

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

/**
 * 世界书的三本来源（Phase 8 第二阶段）。
 *
 * 全局：这个部署通用的规则；
 * 角色：跟着卡走，换卡即换；
 * 聊天：只影响这一场，玩家临时加的设定。
 *
 * 分开的意义是「不要一整套世界设定强行应用到所有角色和所有小说线」。
 */
export interface LorebookSet {
  global?: WorldBook;
  card?: WorldBook;
  chat?: WorldBook;
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

/**
 * 作者注。只放「这一轮怎么写」，不放世界设定。
 *
 * 插入位置固定在聊天历史里、最后一条玩家输入之前（depth 1）。
 * 这个位置比系统提示开头更有影响力：它离生成最近，又不会盖过玩家刚说的话。
 */
export interface AuthorNote {
  text: string;
  /** 默认 1 */
  frequency?: NoteFrequency;
  /**
   * 插在历史倒数第几条之前。1（默认）= 最后一条之前，0 = 最后一条之后。
   * 上限见 note.ts 的 MAX_NOTE_DEPTH。
   */
  depth?: number;
  /** false 时整条停用 */
  enabled?: boolean;
}

/* ------------------------------------------------------------------ 组装输入 */

export interface AssembleInput {
  card: CharacterCardCore;
  /** 世界书。简化版只有 keys/content/constant 也能跑 */
  lorebook?: WorldBook;
  /** 三来源世界书（Phase 8）。给了就忽略 lorebook，按优先级合并三本。
   * 只给其中一本也可以。
   */
  lorebooks?: LorebookSet;
  /**
   * 世界书时效状态（sticky / cooldown / delay 的轮次记录）。
   * 上一轮 assemble 返回的 lorebookTiming 原样传回来。
   */
  lorebookTiming?: LorebookTimingState;
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
  /** 上下文窗口，用于按比例决定何时开始增量摘要。 */
  maxContext?: number;
  /** 已经跑过的轮次，用于 Author's Note 的频率判定 */
  turn?: number;
  summary?: RollingSummary;
  facts?: KeyFacts;
  /** 本机记下的人物、地点、事件。放在历史后面，不进前缀缓存 */
  journal?: Journal;
  /** 这一轮已经执行过的函数调用结果，只在续写时带上 */
  toolTrace?: ToolTrace[];
  authorNote?: AuthorNote;
  /** 本轮临时作者注（重新生成纠偏）。有内容时独占，压过常规作者注。 */
  temporaryNote?: string;
  style?: StyleId;
  userName?: string;
  /**
   * 回合层的当前场景状态。默认用角色卡的 scenario；
   * 有场景线时传它，让「现在在哪儿、什么时候」跟着剧情走。
   */
  scene?: string;
  /**
   * 结构化的场景状态（Phase 5）。给了就用它替掉 scene，
   * 每个字段带上可信度，模型才知道哪些是事实、哪些只是推断。
   */
  sceneState?: SceneState;
  /** 当前活跃的剧情线，一行一条。不传就从场景状态和关键事实里现算。 */
  threads?: string[];
  /**
   * 完整的剧情线列表（Phase 6）。给了就按 6.3 的策略挑几条注入，
   * 不是全部塞进去——每轮提醒模型「你还有一堆悬念」会把它逼成急着收线的写手。
   */
  storyThreads?: StoryThread[];
  storySystems?: {
    events?: boolean;
    goals?: boolean;
    eventAfterTurns?: number;
    stagnantTurns?: number;
  };
  /** 当前回合模式。不传就按玩家输入推断。 */
  mode?: ResponseMode;
  budget: number;
  /** 是否给前缀打缓存断点 */
  cache?: boolean;
}

/** 提示词字段及只读宏可引用的角色卡上下文。 */
export interface CharacterCardCore {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes?: string;
  alternate_greetings?: string[];
  character_version?: string;
  extensions?: Record<string, unknown>;
  /** 卡作者写的额外系统提示，接在核心规则后面 */
  system_prompt?: string;
  /** 对话示例。稳定内容，进前缀，不进历史预算 */
  mes_example?: string;
  /**
   * 角色声音（Phase 9）。结构化地描述她怎么说话，
   * 组装时压成一句自然语言放进前缀，和 personality 挨着。
   */
  voice?: CharacterVoiceProfile;
  /** 长对话后的人设兜底，贴在历史后面，靠后才能压住漂移 */
  post_history_instructions?: string;
  /**
   * 这张卡的默认作者注。管「这一轮怎么写」，不放世界设定。
   * 会话里单独设过作者注时以会话的为准。
   */
  author_note?: string;
  /** 卡片声明的能力附件。附件内容由工具查询，脚本永不执行。 */
  attachments?: CardAttachment[];
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
  /** 世界书的预算观测：命中多少、注入多少、被预算丢掉多少、各档各来源各几条 */
  lorebook?: WorldBookReport;
}

export interface AssembleResult {
  messages: ChatMessage[];
  budget: BudgetReport;
  /**
   * 前缀指纹。只要前缀（System + 角色卡 + 风格 + 世界书 + 摘要）字节级不变，
   * 这个值就不变，可以直接当缓存版本用。
   */
  cacheKey: string;
  /** 这一轮实际用的回合模式，方便日志和跑批对比 */
  mode: ResponseMode;
  /** 这一次是否刚好触发了压缩阈值（由调用方决定要不要压） */
  needsSummarize: boolean;
  /**
   * Prompt Inspector 的数据（Phase 10）：每条消息的来源、区段、token，
   * 以及这一轮激活了哪些世界书条目。只在开发模式下展示，
   * 不影响发给模型的内容，也不参与前缀指纹。
   */
  inspector: PromptInspector;
  /** 本轮结束后的世界书时效状态，调用方原样带回下一轮 */
  lorebookTiming: LorebookTimingState;
}
