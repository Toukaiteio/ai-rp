/**
 * Prompt Inspector（Phase 10）。
 *
 * 问题：组装出来的是一串没有名字的 system 消息。出了问题只能靠
 * 「把 messages 打出来数一数第几条是什么」——世界书命中一变，序号全乱。
 *
 * 做法：组装时给每条消息贴一个**来源标签**（区段 + 说明），
 * 面板按标签分组展示。标签是组装器的副产品，不是另写一套推导——
 * 推导出来的标签迟早和实际消息对不上。
 *
 * 设计约束：
 * 1. 标签只描述「这条消息从哪来」，不改任何内容，也不参与指纹；
 * 2. 组装结果是纯函数的输出，所以 inspector 也是纯数据，可离线测；
 * 3. 面板展示的是**发给模型的最终形态**，包括 cache_control 标记。
 */
import type { ChatMessage } from "./types";
import { PER_MESSAGE_OVERHEAD, estimateTokens } from "./budget";

/**
 * 区段。顺序就是最终消息顺序，面板照这个顺序分组。
 *
 * 和 SillyTavern 的 Prompt Inspector 一样按「逻辑区段」分，
 * 而不是按 role 分——同一个 system 角色承担了五六种职责，
 * 按 role 分等于没分。
 */
export const INSPECTOR_SECTIONS = [
  "system",
  "card",
  "voice",
  "worldbook",
  "scene",
  "history",
  "director",
  "note",
  "post_history",
  "user",
] as const;

export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

export const SECTION_LABELS: Record<InspectorSection, string> = {
  system: "System",
  card: "Character Card",
  voice: "Character Voice",
  worldbook: "World Book",
  scene: "Scene State",
  history: "Chat History",
  director: "Director Plan",
  note: "Author's Note",
  post_history: "Post-History Rules",
  user: "User Input",
};

/** 这一条属于稳定层还是回合层。稳定层吃缓存，回合层每轮都变。 */
export type InspectorLayer = "prefix" | "post" | "history";

/** 一条消息的来源。 */
export interface MessageOrigin {
  section: InspectorSection;
  layer: InspectorLayer;
  /**
   * 具体是谁：`core_rules`、`worldbook:card`、`history:12`……
   * 面板里显示这一行，定位问题时能一眼看出是哪一段。
   */
  detail: string;
  /** 命中世界书的条目内容，面板里要单独列出「哪些条目被激活了」 */
  lorebook?: {
    source: "global" | "card" | "chat";
    priority: string;
    keys: string[];
  };
}

/** 面板里的一行。 */
export interface InspectorMessage {
  /** 在最终 messages 数组里的下标 */
  index: number;
  role: ChatMessage["role"];
  section: InspectorSection;
  layer: InspectorLayer;
  detail: string;
  /** 这条消息的 token 估算 */
  tokens: number;
  /** 正文。面板里可折叠，默认不展开 */
  content: string;
  /** 有没有打缓存断点 */
  cached: boolean;
  lorebook?: MessageOrigin["lorebook"];
}

export interface InspectorSectionSummary {
  section: InspectorSection;
  label: string;
  count: number;
  tokens: number;
}

/** 面板的完整数据。 */
export interface PromptInspector {
  messages: InspectorMessage[];
  sections: InspectorSectionSummary[];
  totals: {
    messages: number;
    tokens: number;
    /** 稳定层占多少 token。它决定缓存值不值得 */
    prefixTokens: number;
    historyTokens: number;
    postTokens: number;
  };
  /** 这一轮激活的世界书条目，按来源和优先级列出 */
  lorebook: Array<{
    source: "global" | "card" | "chat";
    priority: string;
    keys: string[];
    /** 注入到哪一段 */
    section: InspectorSection;
    tokens: number;
    content: string;
  }>;
}

/**
 * 默认的 token 估算。和预算那一套共用同一个函数，
 * 面板里的数字才会和预算环里的对得上。
 */
export function defaultCost(message: ChatMessage): number {
  return estimateTokens(message.content) + PER_MESSAGE_OVERHEAD;
}

/**
 * 从带标签的消息列表组装出面板数据。
 *
 * 纯函数：同样的 messages + origins 永远得到同样的结果。
 * token 估算复用预算那一套，所以面板里的数字和预算环里的对得上。
 */
export function buildInspector(
  messages: readonly ChatMessage[],
  origins: Readonly<Record<number, MessageOrigin>>,
  cost: (message: ChatMessage) => number = defaultCost,
): PromptInspector {
  const rows: InspectorMessage[] = messages.map((message, index) => {
    const origin = origins[index];
    return {
      index,
      role: message.role,
      section: origin?.section ?? "system",
      layer: origin?.layer ?? "prefix",
      detail: origin?.detail ?? "未标注",
      tokens: cost(message),
      content: message.content,
      cached: hasCacheBreakpoint(message),
      ...(origin?.lorebook ? { lorebook: origin.lorebook } : {}),
    };
  });

  const sections: InspectorSectionSummary[] = INSPECTOR_SECTIONS.map((section) => {
    const group = rows.filter((row) => row.section === section);
    return {
      section,
      label: SECTION_LABELS[section],
      count: group.length,
      tokens: group.reduce((sum, row) => sum + row.tokens, 0),
    };
  })
    .filter((summary) => summary.count > 0)
    /*
     * 按「这个区段第一次出现的位置」排，而不是按枚举顺序。
     *
     * 枚举顺序是逻辑上的先后，但作者注在历史里（靠前），导演计划在最后，
     * 照枚举排会让面板上 [Director Plan] 出现在 [Author's Note] 前面，
     * 读起来像是计划先于注记——那和实际发出去的消息顺序不符。
     */
    .sort((a, b) => firstIndex(rows, a.section) - firstIndex(rows, b.section));

  const sum = (layer: InspectorLayer) =>
    rows.filter((row) => row.layer === layer).reduce((total, row) => total + row.tokens, 0);

  const lorebook = rows
    .filter((row) => row.lorebook)
    .map((row) => ({
      source: row.lorebook?.source ?? "card",
      priority: row.lorebook?.priority ?? "background",
      keys: row.lorebook?.keys ?? [],
      section: row.section,
      tokens: row.tokens,
      content: row.content,
    }));

  return {
    messages: rows,
    sections,
    totals: {
      messages: rows.length,
      tokens: rows.reduce((total, row) => total + row.tokens, 0),
      prefixTokens: sum("prefix"),
      historyTokens: sum("history"),
      postTokens: sum("post"),
    },
    lorebook,
  };
}

/** 一个区段在消息列表里第一次出现的位置。用来给区段排序。 */
function firstIndex(rows: readonly InspectorMessage[], section: InspectorSection): number {
  const found = rows.find((row) => row.section === section);
  return found ? found.index : Number.MAX_SAFE_INTEGER;
}

/**
 * 往面板数据末尾追加一条消息。
 *
 * 给「组装之后才加进去的东西」用：导演计划是在 assemble 返回之后才拼上的
 * （它由模型现场生成，组装时还不存在），所以面板要单独补这一条，
 * 否则显示的就不是最终发出去的那份。
 */
export function withExtraMessage(
  inspector: PromptInspector,
  message: ChatMessage,
  origin: MessageOrigin,
  cost: (message: ChatMessage) => number,
): PromptInspector {
  const index = inspector.messages.length;
  return buildInspector(
    [...inspector.messages.map((item) => ({ role: item.role, content: item.content })), message],
    {
      ...Object.fromEntries(
        inspector.messages.map((item) => [
          item.index,
          {
            section: item.section,
            layer: item.layer,
            detail: item.detail,
            ...(item.lorebook ? { lorebook: item.lorebook } : {}),
          } satisfies MessageOrigin,
        ]),
      ),
      [index]: origin,
    },
    cost,
  );
}

/**
 * 一条消息有没有打缓存断点。
 *
 * cache_control 不在 ChatMessage 的类型里——它是发给上游的额外字段，
 * 组装时用 markCache 挂上去的。所以这里按存在性读，读不到就是没打。
 */
function hasCacheBreakpoint(message: ChatMessage): boolean {
  return Boolean((message as { cache_control?: unknown }).cache_control);
}

/** 把面板数据压成一段纯文本，用于日志和跑批输出。 */
export function formatInspector(inspector: PromptInspector): string {
  const lines: string[] = [];
  for (const summary of inspector.sections) {
    lines.push(`[${summary.label}] ${summary.count} 条 · ${summary.tokens} token`);
    for (const row of inspector.messages.filter((message) => message.section === summary.section)) {
      lines.push(
        `  #${row.index} ${row.role} · ${row.detail} · ${row.tokens}t${row.cached ? " · cache" : ""}`,
      );
    }
  }
  lines.push(
    `合计 ${inspector.totals.messages} 条 · ${inspector.totals.tokens} token` +
      `（前缀 ${inspector.totals.prefixTokens} / 历史 ${inspector.totals.historyTokens} / 回合 ${inspector.totals.postTokens}）`,
  );
  return lines.join("\n");
}
