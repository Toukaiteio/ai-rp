/**
 * 角色卡：兼容 SillyTavern Character Card V2 的字段名。
 * 只做 JSON，不做 PNG 内嵌卡，也不做 CHARX。
 */
import type { CharacterVoiceProfile } from "@/lib/voice";

/**
 * 世界书条目。keys / content / constant 是最小集，其余都可选。
 * 只有 content 会进提示词，keys 只负责判断该不该命中。
 */
export interface WorldBookEntry {
  keys: string[];
  content: string;
  /** 常驻条目：不靠关键词命中，每轮都注入 */
  constant?: boolean;
  /** 多个关键词时，and 要全中，or 中一个即可。没写按 or */
  logic?: "and" | "or";
  /** 同一位置内的排序，小的在前 */
  order?: number;
  position?: "before_char" | "after_char" | "before_scene" | "after_scene" | "in_chat";
  /** 0 到 100，命中后再按这个概率注入 */
  probability?: number;
  /** 只扫描最近这几条消息 */
  scanDepth?: number;
  /** 命中后把 content 交给后面的条目继续扫 */
  cascade?: boolean;
  /** false 则整条停用 */
  enabled?: boolean;
}

export interface WorldBook {
  name?: string;
  entries: WorldBookEntry[];
  scanDepth?: number;
  budgetCap?: number;
  tokenCap?: number;
  recursiveScan?: boolean;
}

export interface CharacterCardData {
  name: string;
  /** 外貌、来历、习惯、与玩家的关系 */
  description: string;
  /** 矛盾点与触发点 */
  personality: string;
  /** 时间、地点、氛围 */
  scenario: string;
  first_mes: string;
  /** 用 <START> 分段的对话示例，可含 {{char}} / {{user}} 宏 */
  mes_example?: string;
  system_prompt?: string;
  /** 长对话后的人设兜底 */
  post_history_instructions?: string;
  /**
   * 这张卡的默认作者注：管「这一轮怎么写」。
   * 只放节奏、写作重点、格式提醒和临时风格约束，不放世界设定——
   * 世界设定属于 description / scenario / character_book。
   * 会话里单独设过作者注时，以会话的为准。
   */
  author_note?: string;
  /**
   * 角色声音（Phase 9）。放在 extensions 里，因为它不是 V2 规范字段，
   * 别的客户端读卡时会原样忽略，不会因为我们加了它而认不出这张卡。
   */
  voice?: CharacterVoiceProfile;
  alternate_greetings?: string[];
  character_book?: WorldBook;
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: Record<string, unknown>;
}

export interface CharacterCard {
  spec: string;
  spec_version: string;
  data: CharacterCardData;
}

export const CARD_SPEC = "chara_card_v2";
export const CARD_SPEC_VERSION = "2.0";

/** 卡在界面上的身份：在线下载或本地导入，全都存在本机。 */
export interface CardEntry {
  id: string;
  card: CharacterCard;
  source: "preset" | "imported";
}
