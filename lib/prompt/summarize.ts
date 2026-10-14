import { parseBlocks, stripBlocks } from "@/lib/blocks";
import { estimateTokens } from "./budget";
import type { ChatMessage, KeyFacts, RollingSummary } from "./types";

/** 历史超过这个 token 量才压一次，不要每轮都压。 */
export const SUMMARIZE_THRESHOLD_TOKENS = 8000;
/** 压完之后目标保留多少 token 的历史。压过头会让最近语境变薄。 */
export const SUMMARIZE_TARGET_TOKENS = 4000;

/**
 * 增量摘要的提示词。
 *
 * 三类硬约束写在提示词里，压出来的摘要才不会漂移：
 * 只总结新增部分、不加入新人物和事件、不评价不续写。
 */
export const SUMMARIZE_SYSTEM_PROMPT = [
  "你在给一段角色扮演对话做增量摘要。只总结这批新增消息里发生的事。",
  "",
  "必须包含：",
  "- 关键事件（谁做了什么，结果是什么）",
  "- 人物关系变化",
  "- 已揭示的设定",
  "- 当前场景（时间、地点、在场的人）",
  "- 未完成的悬念",
  "",
  "禁止：",
  "- 不要加入这批消息里没有出现的新人物和新事件",
  "- 不要评价、不要总结主题、不要写感想",
  "- 不要续写，不要推测接下来会发生什么",
  "- 不要复述对话原文",
  "",
  "用第三人称，客观陈述，控制在 300 字以内。只输出摘要正文，不要标题，不要前缀。",
].join("\n");

export interface SummarizeInput {
  /** 上一次的摘要，第一次传空串 */
  previous: string;
  /** 只总结这些新增消息 */
  additions: ChatMessage[];
  /** 已固化的关键事实，用来提醒模型别把它重写进去 */
  facts?: KeyFacts;
}

/**
 * 生成摘要请求的消息。
 *
 * 关键：把已有摘要和新增内容分开传，让模型只总结新增部分，
 * 再把结果拼到已有摘要后面。整段重写会让旧细节一层层丢掉，这就是漂移的来源。
 */
export function buildSummarizeMessages(input: SummarizeInput): ChatMessage[] {
  const transcript = input.additions
    .map((message) => {
      const text = stripBlocks(message.content, { quoteDialogue: false });
      return `${message.role === "user" ? "玩家" : "角色"}：${text}`;
    })
    .join("\n");

  const parts = [
    input.previous
      ? `已有的摘要（保留它，只补充新增部分）：\n${input.previous}`
      : "目前还没有摘要。",
    `这批新增对话：\n${transcript}`,
  ];

  if (input.facts) {
    const known = formatFacts(input.facts);
    if (known) {
      parts.push(
        `这些关键事实已经单独记录了，不要在摘要里重复它们：\n${known}`,
      );
    }
  }

  parts.push(
    [
      "只输出新增部分的摘要，不要复述已有摘要，也不要改写它。",
      "如果这批对话里出现了新的人物现状、地点现状或已经发生的事，在摘要之后另起一段输出：",
      '<facts>{"characters":{"名字":"一句话"},"places":{"地点":"一句话"},"flags":{"事件":true}}</facts>',
      "没有新事实就不要输出 facts 段。",
    ].join("\n"),
  );

  return [
    { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/** 关键事实渲染成文本。进提示词时用得上，也用来提醒模型别重复。 */
export function formatFacts(facts: KeyFacts): string {
  const lines: string[] = [];

  const characters = Object.entries(facts.characters ?? {});
  if (characters.length > 0) {
    lines.push(
      `人物：${characters.map(([name, state]) => `${name}（${state}）`).join("、")}`,
    );
  }

  const places = Object.entries(facts.places ?? {});
  if (places.length > 0) {
    lines.push(
      `地点：${places.map(([name, state]) => `${name}（${state}）`).join("、")}`,
    );
  }

  const flags = Object.entries(facts.flags ?? {});
  if (flags.length > 0) {
    lines.push(
      `旗标：${flags
        .map(([name, value]) =>
          typeof value === "boolean"
            ? `${name}${value ? " ✓" : " ✗"}`
            : `${name} = ${value}`,
        )
        .join("、")}`,
    );
  }

  return lines.join("\n");
}

export function emptySummary(): RollingSummary {
  return { text: "", coveredIndex: 0, compressedCount: 0 };
}

/**
 * 是否需要压一次。
 * 只看历史总量，不看轮次：短对话聊很多轮也不该压。
 */
export function needsSummarize(
  history: ChatMessage[],
  summary: RollingSummary | undefined,
  threshold = SUMMARIZE_THRESHOLD_TOKENS,
): boolean {
  if (!history.length) return false;

  // 只算还没被压过的那部分，已经总结过的不再计入
  const covered = summary?.coveredIndex ?? 0;
  const pending = history.slice(covered);
  if (pending.length === 0) return false;

  let tokens = 0;
  for (const message of pending) {
    tokens += estimateTokens(message.content) + 4;
  }
  return tokens > threshold;
}

/**
 * 把新增摘要接到旧摘要后面。
 * 不让模型重写整段：重写一次就丢一层细节，五十轮之后人设和关键剧情就没了。
 */
export function appendSummary(previous: string, addition: string): string {
  const prev = previous.trim();
  const next = addition.trim();
  if (!next) return prev;
  if (!prev) return next;
  return `${prev}\n${next}`;
}

/**
 * 结算一次压缩。coveredIndex 由调用方给出（压到历史的哪一条），
 * 这里不读时钟，同样的输入永远得到同样的结果。
 * 即使新增摘要是空的，索引也要往前走，否则下一轮会把同一段再压一遍。
 */
export function applySummary(
  summary: RollingSummary,
  addition: string,
  coveredIndex: number,
): RollingSummary {
  return {
    text: appendSummary(summary.text, addition),
    coveredIndex,
    compressedCount: summary.compressedCount + 1,
  };
}

/** 从模型输出里抽出关键事实的候选，供调用方确认后写入。 */
export function extractFactMentions(text: string): string[] {
  return parseBlocks(text)
    .map((block) => block.text)
    .filter((line) => line.trim().length > 0);
}
