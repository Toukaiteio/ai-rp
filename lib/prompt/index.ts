import { applyMacros } from "./macros";
import { blocksToPlainText, parseBlocks } from "@/lib/blocks";
import {
  estimateTokens,
  PER_MESSAGE_OVERHEAD,
  trimHistory,
} from "./budget";
import { buildInspector, type MessageOrigin } from "./inspector";
import {
  BASE_RULES,
  DEFAULT_RESPONSE_TOKENS,
  DEFAULT_USER_NAME,
  OUTPUT_CONTRACT,
  STYLE_PROMPTS,
  buildTurnLayer,
} from "./system";
import { inferResponseMode, modeInstruction } from "./mode";
import { noteInsertIndex, resolveAuthorNote, selectAuthorNote } from "./note";
import { markCache, prefixFingerprint } from "./cache";
import { formatJournal, formatToolTrace } from "@/lib/memory/journal";
import { formatSceneState } from "@/lib/scene";
import { formatThreads, selectThreads } from "@/lib/story";
import { describeVoice } from "@/lib/voice";
import { formatAttachmentCatalog } from "@/lib/attachments";
import { activeThreads, formatFacts, needsSummarize, summarizeThresholdFor } from "./summarize";
import { dialogueLanguageInstruction } from "./language";
import {
  decodeMarkedBase64,
  hasMarkedBase64,
  USER_MESSAGE_BASE64_INSTRUCTION,
} from "@/lib/chat";
import {
  INJECTION_GROUPS,
  LOREBOOK_SOURCES,
  matchWorldBook,
  type InjectionGroup,
  type MatchedEntry,
  type SourcedLorebook,
} from "./worldbook";
import type {
  AssembleInput,
  AssembleResult,
  BudgetReport,
  ChatMessage,
  LorebookSet,
  WorldBook,
  WorldBookEntry,
} from "./types";

/* ---------------------------------------------------------------- 类型导出 */

export * from "./types";
export { applyMacros, expandMacroSegments, type MacroSegment, type MacroVars } from "./macros";
export {
  parseBlocks,
  blocksToRaw,
  blocksToPlainText,
  stripBlocks,
} from "@/lib/blocks";
export type { BlockKind, MessageBlock, PlainTextOptions } from "@/lib/blocks";
export {
  estimateTokens,
  estimateMessages,
  trimHistory,
  PER_MESSAGE_OVERHEAD,
} from "./budget";
export {
  BASE_RULES,
  OUTPUT_CONTRACT,
  STYLE_PROMPTS,
  DEFAULT_RESPONSE_TOKENS,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_USER_NAME,
  SUMMARIZE_THRESHOLD_TOKENS,
} from "./system";
export { matchWorldBook, rollDice, buildScanText, mergeLorebooks } from "./worldbook";
export {
  INSPECTOR_SECTIONS,
  SECTION_LABELS,
  buildInspector,
  defaultCost,
  formatInspector,
  withExtraMessage,
  type InspectorLayer,
  type InspectorMessage,
  type InspectorSection,
  type InspectorSectionSummary,
  type MessageOrigin,
  type PromptInspector,
} from "./inspector";
export {
  ENTRY_PRIORITIES,
  LOREBOOK_SOURCES,
  PRIORITY_LABELS,
  SOURCE_LABELS,
  type EntryPriority,
  type LorebookSource,
  type MatchedEntry,
  type SourcedLorebook,
  type WorldBookReport,
} from "./worldbook";
export { GLOBAL_LOREBOOK } from "./global-book";
export {
  buildSummarizeMessages,
  formatFacts,
  needsSummarize,
  applySummary,
  appendSummary,
  emptySummary,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_TARGET_TOKENS,
  summaryOverBudget,
  summarizeThresholdFor,
} from "./summarize";
export { mergeFacts, parseFactsPayload, sanitizeFacts, activeThreads } from "./facts";
export {
  correctionNote,
  resolveAuthorNote,
  selectAuthorNote,
  noteInsertIndex,
  DEFAULT_NOTE_DEPTH,
  MAX_NOTE_DEPTH,
  MAX_NOTE_CHARS,
  type NoteSources,
} from "./note";
export { dialogueLanguageInstruction } from "./language";
export {
  inferResponseMode,
  modeInstruction,
  DIRECTOR_MODE_HINT,
  MODE_INSTRUCTIONS,
  MODE_LABELS,
  RESPONSE_MODES,
  type ResponseMode,
} from "./mode";
export {
  BLOCK_EXAMPLES,
  TURN_RULES,
  buildTurnLayer,
} from "./system";
export {
  buildDirectorMessages,
  formatTurnPlan,
  insertBeforeCurrentUser,
  parseTurnPlan,
  shouldPlanTurn,
  DIRECTOR_SYSTEM_PROMPT,
  DIRECTOR_MAX_TOKENS,
} from "./turn-plan";
export type { DirectorMessagesOptions, TurnBeat, TurnPlan, TurnToolCall } from "./turn-plan";
export {
  buildSuggestionMessages,
  parseSuggestions,
  SUGGESTION_SYSTEM_PROMPT,
} from "@/lib/suggest";
export {
  hashString,
  prefixFingerprint,
  markCache,
  cacheStatsFor,
  resetCacheStats,
  CacheStats,
} from "./cache";
export type { CacheObservation } from "./cache";

/* ---------------------------------------------------------------- 预算 */

/**
 * 可用预算：maxContext - responseTokens - 3。
 * 那 3 个 token 给结尾收尾留的，照减就行。
 */
export function planBudget(
  maxContext: number,
  responseTokens = DEFAULT_RESPONSE_TOKENS,
): number {
  return Math.max(0, maxContext - responseTokens - 3);
}

/* ---------------------------------------------------------------- 组装 */

/** 只放 content。keys 是命中索引，永远不进提示词。 */
function contents(entries: WorldBookEntry[]): string[] {
  return entries.map((entry) => entry.content).filter((text) => text.length > 0);
}

/**
 * 常驻条目进前缀，关键词条目放到历史后面。
 * 关键词命中会随对话变，若塞进前缀，缓存每换一个词就失效。
 */
function stableContents(entries: WorldBookEntry[]): string[] {
  return contents(entries.filter((entry) => entry.constant === true));
}

function triggeredContents(entries: WorldBookEntry[]): string[] {
  return contents(entries.filter((entry) => entry.constant !== true));
}

/**
 * 提示词组装。纯函数：同样的输入永远得到同样的输出。
 *
 * 结构分四层，从前往后：
 *
 * **稳定层（前缀，字节级稳定，缓存断点打在这里）**
 *   System（核心规则 + 输出协议 + 卡上的 system_prompt）
 *   → [世界书 before_char 常驻]
 *   → 角色卡（description + personality + 对话示例，persona 紧跟）
 *   → [世界书 after_char 常驻]
 *   → 场景
 *   → [世界书 before_scene / after_scene 常驻]
 *   → 风格包
 *   → 关键事实
 *
 * **参考层（缓存断点之后，仍在历史之前）**
 *   [世界书 in_chat 与关键词条目] → 玩家消息 Base64 标记说明 → 滚动摘要
 *
 * **历史层**
 *   尚未摘要的近期对话（coveredIndex 之后，中间优先丢），作者注按 depth 插在里面
 *
 * **回合层（放在历史之后，每轮都变）**
 *   语言锁定 → 当前场景状态 → 活跃剧情线 → 回合模式 → 输出要求（含 act 约束与正向示例）
 *   → 记忆目录 / 工具结果 → post_history_instructions
 *   当前用户消息恒定是最后一条。
 *
 * 为什么摘要紧贴历史：它是「已经发生的剧情」的文字版，和近期历史之间不该再夹
 * 一层每轮都变的参考；放进前缀则会每压一次摘要就打掉一次缓存。
 * 为什么回合层在历史之后：隔了几十轮历史之后约束力会明显衰减，放在离生成最近
 * 的位置才压得住。作者注比回合层更靠近生成，所以按 depth 插进历史末尾。
 *
 * 前缀里没有时间戳、随机数、请求 ID，所以字节级稳定，各家的前缀缓存才打得中。
 */
export function assemble(input: AssembleInput): AssembleResult {
  const {
    card,
    lorebook,
    lorebooks,
    persona,
    history: rawHistory,
    seed,
    maxContext,
    turn = 0,
    summary,
    facts,
    lorebookTiming,
    journal,
    toolTrace,
    authorNote,
    temporaryNote,
    style,
    scene,
    sceneState,
    threads,
    storyThreads,
    storySystems,
    mode,
    userName = "你",
  } = input;

  const note = selectAuthorNote(
    resolveAuthorNote({
      temporary: temporaryNote,
      session: authorNote,
      card: card.author_note?.trim() ? { text: card.author_note } : undefined,
    }),
    turn,
  );
  const macroVars = {
    char: card.name,
    user: userName,
    card,
    persona,
    history: rawHistory,
    summary: summary?.text,
    authorsNote: note?.text,
    input: lastUserText(rawHistory),
  };
  const apply = (text: string) => applyMacros(text, macroVars);
  const history = normalizeHistory(rawHistory).map((message) => ({ ...message, content: apply(message.content) }));
  const logicHistory = normalizeHistory(
    rawHistory.map((message) =>
      message.role === "user" ? { ...message, content: decodeMarkedBase64(message.content) } : message,
    ),
  ).map((message) => ({ ...message, content: apply(message.content) }));
  const hasCurrentUser = rawHistory.length > 0 && rawHistory[rawHistory.length - 1]?.role === "user";
  const currentUser = hasCurrentUser ? history[history.length - 1] : undefined;
  const completedHistory = hasCurrentUser ? history.slice(0, -1) : history;
  const coveredIndex = Math.max(
    0,
    Math.min(summary?.coveredIndex ?? 0, completedHistory.length),
  );
  const pendingHistory = completedHistory.slice(coveredIndex);
  const expandBook = (book: WorldBook): WorldBook => ({
    ...book,
    entries: book.entries.map((entry) => ({
      ...entry,
      keys: entry.keys.map(apply),
      content: apply(entry.content),
    })),
  });

  /*
   * 世界书（Phase 8）：三本来来源合并成一次匹配。
   *
   * 预算按「常驻规则 → 当前场景相关 → 玩家刚提到的关键词 → 普通背景」花，
   * 所以预算不够时丢的是背景条目，不是常驻设定。
   * 场景文字用当前场景状态，命中它的条目算「当前场景相关」。
   */
  const sceneScan = [
    sceneState?.location,
    sceneState?.currentAction,
    sceneState?.presentCharacters.join("、"),
  ]
    .filter(Boolean)
    .join(" ");
  const book = matchWorldBook({
    ...(lorebooks
      ? { books: toSourcedBooks(lorebooks).map(({ source, book }) => ({ source, book: expandBook(book) })) }
      : { lorebook: lorebook ? expandBook(lorebook) : undefined }),
    history: logicHistory,
    userMessage: lastUserText(logicHistory),
    sceneText: apply(sceneScan),
    seed,
    budgetCap: budgetCapOf(lorebooks, lorebook),
    tokenCap: tokenCapOf(lorebooks, lorebook),
    turn,
    timing: lorebookTiming,
  });

  /* ---- 稳定层：字节级稳定 ---- */

  /*
   * 组装时给每条消息贴来源标签（Phase 10）。
   *
   * 标签是组装的副产品，不是事后按内容猜出来的——猜出来的标签迟早和实际
   * 消息对不上，而 Inspector 的价值就在于「它显示的确实是发出去的东西」。
   *
   * 下标不能边攒边算：历史夹在前缀和回合层中间，而历史长度要等裁剪完才知道。
   * 所以标签先按层分开攒，最后拼成 messages 时统一算下标。
   */
  const buckets = {
    prefix: { messages: [] as ChatMessage[], origins: [] as MessageOrigin[] },
    /** 参考层：关键词世界书与摘要。紧随前缀、仍在历史之前，跟着吃缓存断点之后的位子。 */
    pre: { messages: [] as ChatMessage[], origins: [] as MessageOrigin[] },
    /** 回合层：历史之后、当前用户消息之前，离生成最近。 */
    post: { messages: [] as ChatMessage[], origins: [] as MessageOrigin[] },
  };
  const push = (
    bucket: keyof typeof buckets,
    origin: MessageOrigin,
    message: ChatMessage,
  ) => {
    buckets[bucket].messages.push(message);
    buckets[bucket].origins.push(origin);
  };

  // 1. 顶层 System Prompt：核心规则、输出协议与角色卡核心信息合为一条主系统提示。
  const voice = card.voice ? describeVoice(card.voice) : "";
  const attachmentCatalog = formatAttachmentCatalog(card.attachments);
  const systemParts: string[] = [
    card.system_prompt?.trim()
      ? applyMacros(card.system_prompt, { ...macroVars, original: BASE_RULES })
      : BASE_RULES,
    OUTPUT_CONTRACT,
    ...(userName !== DEFAULT_USER_NAME
      ? [`玩家名：${apply(userName)}。这是玩家本人，不是场景里的角色；不要创建同名人物，也不要把 who 写成这个名字。`]
      : []),
    [
      `角色名：${card.name}`,
      `设定：${apply(card.description)}`,
      `性格：${apply(card.personality)}`,
    ].join("\n"),
    ...(voice ? [`她说话的样子：${apply(voice)}`] : []),
    ...(card.mes_example?.trim()
      ? [`角色语言参考（只参考说话方式、措辞和节奏，不照抄事件或句子）：\n${apply(card.mes_example)}`]
      : []),
    ...(persona?.trim() ? [`玩家设定：${apply(persona)}`] : []),
    ...(card.scenario.trim() ? [`当前场景：${apply(card.scenario)}`] : []),
    ...(attachmentCatalog ? [attachmentCatalog] : []),
    ...(style ? [STYLE_PROMPTS[style]] : []),
  ];
  const systemDetails: string[] = [
    "core_rules",
    "output_contract",
    ...(userName !== DEFAULT_USER_NAME ? ["玩家名"] : []),
    "name / description / personality",
    ...(voice ? ["describeVoice 压缩后的一句话"] : []),
    ...(card.mes_example?.trim() ? ["card.mes_example"] : []),
    ...(persona?.trim() ? ["persona"] : []),
    ...(card.scenario.trim() ? ["card.scenario"] : []),
    ...(attachmentCatalog ? ["角色卡附件目录"] : []),
    ...(style ? [`style:${style}`] : []),
  ];
  push(
    "prefix",
    { section: "system", layer: "prefix", detail: systemDetails.join(" + ") },
    { role: "system", content: systemParts.join("\n\n") },
  );

  // 2. 常驻世界书。关键词条目不进前缀，免得缓存跟着命中闪断
  for (const text of stableContents(book.group.before_char)) {
    push(
      "prefix",
      {
        section: "worldbook",
        layer: "prefix",
        detail: "worldbook.before_char（常驻）",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }
  for (const text of stableContents(book.group.after_char)) {
    push(
      "prefix",
      {
        section: "worldbook",
        layer: "prefix",
        detail: "worldbook.after_char（常驻）",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }
  for (const text of stableContents(book.group.before_scene)) {
    push(
      "prefix",
      {
        section: "worldbook",
        layer: "prefix",
        detail: "worldbook.before_scene（常驻）",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }
  for (const text of stableContents(book.group.after_scene)) {
    push(
      "prefix",
      {
        section: "worldbook",
        layer: "prefix",
        detail: "worldbook.after_scene（常驻）",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }

  // 3. 关键事实
  if (facts) {
    const text = formatFacts(facts);
    if (text) {
      push("prefix",{ section: "worldbook", layer: "prefix", detail: "关键事实（facts）" }, {
        role: "system",
        content: `已确认的事实：\n${apply(text)}`,
      });
    }
  }

  const markedPrefix = input.cache === false ? buckets.prefix.messages : markCache(buckets.prefix.messages);
  const prefixTokens = tokenSum(markedPrefix);

  /* ---- 参考层：缓存断点之后、历史之前 ---- */

  const triggered = new Set<string>();
  for (const group of [
    book.group.before_char,
    book.group.after_char,
    book.group.before_scene,
    book.group.after_scene,
  ]) {
    for (const text of triggeredContents(group)) triggered.add(text);
  }
  for (const text of triggered) {
    push(
      "pre",
      {
        section: "worldbook",
        layer: "post",
        detail: "worldbook（关键词命中）",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }
  for (const text of contents(book.group.in_chat)) {
    push(
      "pre",
      {
        section: "worldbook",
        layer: "post",
        detail: "worldbook.in_chat",
        ...(lorebookOrigin(book.matched, text) ?? {}),
      },
      { role: "system", content: text },
    );
  }

  if (rawHistory.some((message) => message.role === "user" && hasMarkedBase64(message.content))) {
    push(
      "pre",
      { section: "history", layer: "post", detail: "玩家消息 Base64 标记说明" },
      { role: "system", content: USER_MESSAGE_BASE64_INSTRUCTION },
    );
  }

  // 语言锁定要按「玩家最近一条输入」现算，所以放在历史之后、回合层里
  const language = dialogueLanguageInstruction(logicHistory);
  const responseMode = mode ?? inferResponseMode({ playerInput: lastUserText(logicHistory) });
  /*
   * 剧情线（Phase 6）：从完整列表里按策略挑几条，不是全部注入。
   * 挑选理由有四种——玩家追问、最近提到、当前场景相关、高重要度；
   * 其余的一律不出现，免得每轮都在提醒模型「你还有一堆悬念」。
   */
  const pickedThreads = storyThreads?.length && storySystems?.goals !== false
    ? selectThreads(storyThreads, {
        playerInput: lastUserText(logicHistory),
        recentText: recentText(logicHistory),
        presentCharacters: sceneState?.presentCharacters ?? [],
        location: sceneState?.location ?? "",
        turn,
      })
    : [];
  const storyPacing = buildStoryPacing(storySystems);
  const turnLayer: ChatMessage = {
    role: "system",
    content: buildTurnLayer({
      language,
      scene: apply(scene ?? card.scenario ?? ""),
      // 结构化场景状态优先：它每轮更新，比角色卡里那句静态场景更贴近此刻
      ...(sceneState ? { sceneState: apply(formatSceneState(sceneState)) } : {}),
      // 状态只记变化，地点没变就不在里面——补一句角色卡的场景，别让模型失去空间感
      ...(sceneState && !sceneState.location.trim() ? { sceneFallback: apply(card.scenario) } : {}),
      // 有剧情线列表就用挑选结果；没有就退回旧的「场景状态 + 关键事实」合并
      threads: pickedThreads.length
        ? pickedThreads.map((item) => apply(item.thread.title))
        : (threads ?? activeThreads(facts, undefined, sceneState?.unresolvedThreads)).map(apply),
      // 选中理由更详细的那一段（含 summary）单独拼，附在剧情线标题之后
      ...(pickedThreads.length ? { threadDetail: apply(formatThreads(pickedThreads)) } : {}),
      ...(storyPacing ? { storyPacing } : {}),
      mode: modeInstruction(responseMode),
    }),
  };
  push(
    "post",
    {
      section: "scene",
      layer: "post",
      detail: sceneState
        ? `场景状态 + 剧情线 ${pickedThreads.length} 条 + 模式 ${responseMode}`
        : `场景 + 剧情线 ${pickedThreads.length} 条 + 模式 ${responseMode}`,
    },
    turnLayer,
  );

  const memoryNote = formatJournal(journal);
  const traceNote = formatToolTrace(toolTrace ?? []);
  push(
    "post",
    { section: "worldbook", layer: "post", detail: "记忆目录 / 工具结果" },
    {
      role: "system",
      content: apply(traceNote ? `${memoryNote}\n\n${traceNote}` : memoryNote),
    },
  );

  if (card.post_history_instructions?.trim()) {
    push("post", { section: "post_history", layer: "post", detail: "card.post_history_instructions" }, {
      role: "system",
      content: apply(card.post_history_instructions),
    });
  }

  if (summary?.text) {
    push("pre", { section: "history", layer: "post", detail: "滚动摘要" }, {
      role: "system",
      content: `之前的剧情：\n${apply(summary.text)}`,
    });
  }
  const preTokens = tokenSum(buckets.pre.messages);
  const postTokens = tokenSum(buckets.post.messages);

  /* ---- 历史：最新优先，先丢中间 ---- */

  /*
   * 作者注（Phase 4）：插进历史末尾，比回合层更靠近生成。
   * depth 1 = 历史末尾（当前用户消息之前）；当前用户消息恒定最后、
   * 不参与 depth 计数，所以下标按 kept.length + 1 算。
   * depth 0 的老语义是「最后一条之后」，现在取最近邻——紧挨当前用户消息之前，
   * 也就是整条回合层之后，由下面单独拼。
   * 它的 token 从历史预算里扣：作者注不该把历史挤爆，也不该让总预算超出去。
   */
  const noteMessage: ChatMessage | undefined = note
    ? { role: "system", content: formatNote(apply(note.text)) }
    : undefined;
  const noteTokens = noteMessage ? tokenSum([noteMessage]) : 0;

  const currentUserTokens = currentUser ? tokenSum([currentUser]) : 0;
  const historyBudget = Math.max(
    0,
    input.budget - prefixTokens - preTokens - postTokens - currentUserTokens - noteTokens,
  );
  // 玩家那几轮在存储里带 <player> 标记（导出时要能区分），
  // 但模型只需要看到玩家说了什么，role 已经说明是谁说的了
  const trimmed = trimHistory(pendingHistory, historyBudget);
  const kept =
    note && noteMessage && note.depth !== 0
      ? insertNote(trimmed.kept, noteMessage, note.depth)
      : trimmed.kept;

  const postMessages = [...buckets.post.messages];
  const postOrigins = [...buckets.post.origins];
  if (note && noteMessage && note.depth === 0) {
    postMessages.push(noteMessage);
    postOrigins.push({ section: "note", layer: "post", detail: "depth 0" });
  }

  const messages: ChatMessage[] = [
    ...markedPrefix,
    ...buckets.pre.messages,
    ...kept,
    ...postMessages,
    ...(currentUser ? [currentUser] : []),
  ];

  /*
   * 来源标签按最终顺序拼出来（Phase 10）。
   *
   * 顺序是：稳定层 → 参考层（关键词世界书 / 摘要）→ 未摘要历史（含作者注）
   * → 回合层 → 当前用户消息。历史那一段的下标要等裁剪之后才知道，
   * 所以标签在这里才拼。
   */
  const historyOrigins: MessageOrigin[] = [
    ...kept,
    ...(currentUser ? [currentUser] : []),
  ].map((message) => {
    if (noteMessage && message === noteMessage) {
      return { section: "note", layer: "history", detail: `depth ${note?.depth ?? 1}` };
    }
    if (currentUser && message === currentUser) {
      return { section: "user", layer: "history", detail: "玩家输入" };
    }
    if (message.role === "user") {
      return { section: "user", layer: "history", detail: "玩家输入" };
    }
    if (message.role === "assistant") {
      return { section: "history", layer: "history", detail: "角色回复" };
    }
    return { section: "history", layer: "history", detail: "历史 system 消息" };
  });

  const origins: Record<number, MessageOrigin> = {};
  [
    ...buckets.prefix.origins,
    ...buckets.pre.origins,
    ...historyOrigins,
    ...postOrigins,
  ].forEach((origin, index) => {
    origins[index] = origin;
  });

  const used =
    prefixTokens + preTokens + postTokens + noteTokens + trimmed.tokens + currentUserTokens;

  const budget: BudgetReport = {
    max: input.budget,
    used,
    remaining: Math.max(0, input.budget - used),
    blocks: {
      prefix: prefixTokens,
      history: trimmed.tokens + currentUserTokens,
      post: preTokens + postTokens,
      note: noteTokens,
      lorebook: book.tokens,
    },
    dropped: trimmed.dropped,
    kept: trimmed.kept.length,
    lorebookEntries: countEntries(book.group),
    lorebook: book.report,
  };

  // 指纹只覆盖前缀正文：角色卡一改这个值就变，缓存自然失效，不会串卡。
  // cache_control 是标记，不参与指纹。
  const cacheKey = prefixFingerprint(markedPrefix.map((m) => m.content));

  return {
    messages,
    budget,
    cacheKey,
    mode: responseMode,
    needsSummarize: needsSummarize(
      history,
      summary,
      summarizeThresholdFor(maxContext),
    ),
    lorebookTiming: book.timing,
    inspector: buildInspector(messages, origins, (message) => estimateTokens(message.content) + PER_MESSAGE_OVERHEAD),
  };
}

/**
 * 从世界书命中记录里找出这条内容是谁带来的。
 *
 * 只用于 Inspector 展示。找不到就返回 undefined——面板显示「世界书」，
 * 总比显示一个猜错的名字好。
 */
function lorebookOrigin(
  matched: readonly MatchedEntry[],
  content: string,
): { lorebook: MessageOrigin["lorebook"] } | undefined {
  const hit = matched.find((item) => item.entry.content === content);
  if (!hit) return undefined;
  return {
    lorebook: {
      source: hit.source,
      priority: hit.priority,
      keys: hit.matchedKeys,
    },
  };
}

/** 玩家最近一条输入。回合模式靠它判断。 */
function lastUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "user") return history[i].content;
  }
  return "";
}

/**
 * 三来源世界书转成匹配器要的形状。
 *
 * 预算上限取三本里最宽的那个：每本各配一套只会让人困惑，
 * 真正需要精细控制时再按来源分别限制。
 */
function toSourcedBooks(set: LorebookSet): SourcedLorebook[] {
  const books: SourcedLorebook[] = [];
  for (const source of LOREBOOK_SOURCES) {
    const book = set[source];
    if (!book?.entries?.length) continue;
    books.push({ source, book });
  }
  return books;
}

function budgetCapOf(set: LorebookSet | undefined, book: WorldBook | undefined): number | undefined {
  if (!set) return book?.budgetCap;
  const caps = LOREBOOK_SOURCES.map((source) => set[source]?.budgetCap).filter(
    (cap): cap is number => typeof cap === "number",
  );
  return caps.length > 0 ? Math.max(...caps) : undefined;
}

function tokenCapOf(set: LorebookSet | undefined, book: WorldBook | undefined): number | undefined {
  if (!set) return book?.tokenCap;
  const caps = LOREBOOK_SOURCES.map((source) => set[source]?.tokenCap).filter(
    (cap): cap is number => typeof cap === "number",
  );
  return caps.length > 0 ? Math.max(...caps) : undefined;
}

/** 最近几轮的正文，用来判断一条剧情线「最近有没有被提到」。 */
function recentText(history: ChatMessage[], limit = 6): string {
  return history
    .slice(-limit)
    .map((message) => message.content)
    .join("\n");
}

/**
 * 作者注进提示词时的包装。
 *
 * 只加一句「优先级高于上面的常规要求」，并说明它的边界：它管的是这一轮怎么写，
 * 不是新的世界设定。不写这句，模型会把注记里的句子当成剧情事实写进正文。
 */
export function formatNote(text: string): string {
  return [
    "作者注（管这一轮的节奏和写法，优先级高于上面的常规要求；不是新的设定或事件，不要照抄进正文）：",
    text,
  ].join("\n");
}

/**
 * 把作者注按 depth 插进历史。depth 1 = 最后一条之前。
 * 当前用户消息恒定在最后、不参与 depth 计数，所以下标按 length + 1 算：
 * depth 1 落在历史末尾，紧挨当前用户消息之前。depth 0 由调用方单独处理。
 */
function insertNote(
  history: ChatMessage[],
  note: ChatMessage,
  depth: number | undefined,
): ChatMessage[] {
  const index = noteInsertIndex(history.length + 1, depth);
  return [...history.slice(0, index), note, ...history.slice(index)];
}

function tokenSum(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD,
    0,
  );
}

/** 抹掉玩家消息里的 <player> 标记。assistant 的块标记保留，模型要照着格式续写。 */
function normalizeHistory(history: ChatMessage[]): ChatMessage[] {
  return history.map((message) =>
    message.role === "user"
      ? {
          ...message,
          content: blocksToPlainText(parseBlocks(message.content), {
            quoteDialogue: false,
          }),
        }
      : message,
  );
}

function countEntries(group: Record<InjectionGroup, WorldBookEntry[]>): number {
  return INJECTION_GROUPS.reduce((sum, key) => sum + group[key].length, 0);
}

function buildStoryPacing(storySystems: AssembleInput["storySystems"]): string {
  if (!storySystems || storySystems.events === false) return "";
  const threshold = Math.max(2, storySystems.eventAfterTurns ?? 4);
  const stagnantTurns = Math.max(0, storySystems.stagnantTurns ?? 0);
  if (stagnantTurns < threshold) return "";
  return `故事辅助提醒：当前已连续 ${stagnantTurns} 轮没有实质推进（阈值为 ${threshold} 轮）。优先回应玩家刚才的话；若玩家没有新动作，本轮顺手引入一个符合当前场景的小动静、新线索或角色主动举动，把停滞的场面往前推一步，但不要强行转折或替玩家做决定。`;
}
