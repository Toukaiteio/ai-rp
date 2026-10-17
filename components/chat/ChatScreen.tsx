"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import {
  ActPill,
  ActionBlock,
  CgCard,
  CgLoading,
  ChatColumn,
  ChatScroll,
  Composer,
  Dialog,
  ChapterMark,
  DialogueBlock,
  MarkdownText,
  MessageActions,
  NarratorBlock,
  PillButton,
  PlayerBubble,
  SceneEvent,
  Sheet,
  TaskBrief,
  SuggestChip,
  SuggestDivider,
  SuggestRow,
  TopBar,
  TypingCursor,
  Veil,
} from "@/components/ui";
import { IconCheck, IconCopy, IconEdit, IconImage } from "@/components/icons";
import { cn } from "@/components/ui/cn";
import { hashSeed } from "@/lib/seed";
import {
  dialogueContinues,
  parseBlocks,
  stripPseudoToolTags,
  type MessageBlock,
} from "@/lib/blocks";
import { buildSuggestionMessages, parseSuggestions } from "@/lib/suggest";
import { DICE_TOOL } from "@/lib/dice";
import {
  applyChatTool,
  emptyJournal,
  MEMORY_TOOLS,
  normalizeJournal,
  putPortrait,
  type Journal,
  type ToolTrace,
} from "@/lib/memory/journal";
import { adaptGreeting } from "@/lib/cards/builder-opening";
import { openingGreetings } from "@/lib/cards/greetings";
import type { CharacterCardData } from "@/lib/cards/types";
import type { ChatMessage } from "@/lib/prompt/types";
import type { KeyFacts, RollingSummary } from "@/lib/prompt/types";
import { findProvider, presetChat } from "@/lib/providers/config";
import {
  canSend,
  imageProviderId,
  isConfigured,
  isImageConfigured,
  usesBrowserModel,
  type ProviderConfig,
} from "@/lib/providers/settings";
import { authHeaders, cleanApiKey } from "@/lib/providers/apikey";
import { createId, createSession, emptyCardMemory, getSessionStore, loadCardMemory, saveCardMemory } from "@/lib/storage";
import type { ChatSession, StoredCg, StoredMessage } from "@/lib/storage";
import {
  allowAutoCg,
  extractAppearance,
  sceneKey,
  sceneText,
  scoreAllows,
} from "@/lib/image";
import { decodeSseBuffer, readSseText, type WireFrame } from "@/lib/wire";
import { useI18n } from "@/lib/i18n/use-i18n";
import { persistGeneratedImage, readChatImage, shrinkPortrait } from "@/lib/chat-image";
import { embedDocument, normalizeDocument, readChatDocument, type ChatDocument } from "@/lib/chat-document";
import { BROWSER_PROVIDER_ID, describeImage, probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { browserChatEndpoint, streamBrowserOpenAI } from "@/lib/browser-openai";
import { applyMacros, assemble, buildDirectorMessages, formatTurnPlan, parseTurnPlan, planBudget } from "@/lib/prompt";
import { cardPortraitUrl } from "@/lib/cards/online";
import { AnnouncementBell, AnnouncementDialog } from "./Announcements";
import { Avatar } from "./Avatar";

/** 这次 remember_character 是不是第一次记下这个人。更新旧条目不重新出头像。 */
function newCharacter(journal: Journal, raw: string): { name: string; detail: string } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as { name?: unknown; detail?: unknown };
    const name = typeof record.name === "string" ? record.name.replace(/\s+/g, " ").trim().slice(0, 24) : "";
    if (!name || name in journal.characters) return null;
    return { name, detail: typeof record.detail === "string" ? record.detail : "" };
  } catch {
    return null;
  }
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  /** 保留块标记的原始文本 */
  content: string;
  cg?: StoredCg;
  swipes?: string[];
  swipeIndex?: number;
  chapterBreak?: boolean;
  image?: string;
  /** 本机模型看图后的描述，只发给不能看图的模型 */
  imageNote?: string;
  document?: ChatDocument;
}

type ComposerAttachment =
  | { kind: "image"; src: string }
  | { kind: "document"; name: string; text: string };

interface ChatError {
  status: number;
  code: string;
  message: string;
}

interface PendingTool {
  id: string;
  name: string;
  arguments: string;
}

type GenerationStage = "attachment" | "plan" | "write";

interface TocItem {
  id: string;
  n: number;
  text: string;
}

function chapterList(turns: Turn[], opening: string): TocItem[] {
  if (!turns[0]) return [];
  const list: TocItem[] = [{ id: "start", n: 1, text: chapterHeading(turns[0].content) || opening }];
  let n = 1;
  for (const turn of turns) {
    if (!turn.chapterBreak) continue;
    n += 1;
    list.push({ id: turn.id, n, text: chapterHeading(turn.content) });
  }
  return list;
}

function chapterHeading(content: string): string {
  const text = parseBlocks(content).find((block) => block.kind === "scene")?.text.trim();
  return text ? text.slice(0, 40) : "";
}

/** 手动分章画在这条对话下面。第 1 章固定在最开头，这里从第 2 章数起。 */
function chapterAt(turns: Turn[], index: number): { n: number; title: string } | null {
  const turn = turns[index];
  if (!turn?.chapterBreak) return null;
  let n = 1;
  for (let i = 0; i <= index; i += 1) {
    if (turns[i]?.chapterBreak) n += 1;
  }
  return { n, title: chapterHeading(turn.content) };
}

function absorbToolCall(
  calls: PendingTool[],
  frame: { index: number; id?: string; name?: string; arguments?: string },
): void {
  while (calls.length <= frame.index) calls.push({ id: "", name: "", arguments: "" });
  const slot = calls[frame.index];
  if (frame.id) slot.id = frame.id;
  if (frame.name) slot.name = frame.name;
  if (frame.arguments) slot.arguments += frame.arguments;
}

const SUGGESTION_TEMPERATURE = 0.8;
const SUGGESTION_MAX_TOKENS = 160;

/** 玩家那几轮在存储里带标记，导出时才能和旁白、对白区分开。 */
function markPlayer(text: string): string {
  return `<player>${text}</player>`;
}

/** 取回玩家实际说了什么。旧会话里存的是纯文本，这里要能兼容。 */
function playerText(content: string): string {
  const block = parseBlocks(content).find((b) => b.kind === "player");
  return block ? block.text : content;
}

/**
 * 本轮玩家输入进历史的形态。
 * 带 <player> 标记，让模型看到自己上一轮的输出格式时也能对上玩家的；
 * 服务端的 normalizeUserContent 会在组装时抹掉标记。
 */
function historyContent(turn: Turn): string {
  // 模型偶尔把函数调用写成 XML 标签。原样存进历史，下一轮它就会在自己
  // 上一轮的输出里看见这种写法，从而有样学样。喂回去之前先剥掉。
  if (turn.role === "assistant") return stripPseudoToolTags(turn.content);
  const text = embedDocument(turn.content, turn.document);
  if (!turn.imageNote) return text;
  return `${text}\n\n【图片】\n${turn.imageNote}`;
}

function userTurnsAsMessages(turn: Turn): ChatMessage[] {
  return [{ role: "user", content: historyContent(turn) }];
}

/**
 * 一条回复可能由多个块组成，逐块渲染。
 *
 * 同一轮里的块间距收紧到 10px（轮与轮之间仍由 ChatColumn 的 26px 分隔），
 * 否则旁白、对白、旁白会被拉成三张互不相干的卡片，读起来是断的。
 *
 * 四类块的渲染差异：
 * narr 无头像无名牌，暗一档小半号，左缘一条细线；
 * dlg 带圆形头像与姓名，墨色最亮；player 走右侧气泡；scene 是居中中性胶囊。
 */
function AssistantTurn({
  content,
  streaming,
  cardName,
  portraitUrl,
  portraits,
  actions,
  stage,
}: {
  content: string;
  streaming: boolean;
  cardName: string;
  /** 这张卡的立绘地址。没有就不画头像槽 */
  portraitUrl?: string | null;
  /** 生成出来的配角头像，按 who 的名字取 */
  portraits?: Record<string, string>;
  actions?: ReactNode;
  stage?: GenerationStage;
}) {
  const { t } = useI18n();
  const stageInfo = {
    attachment: {
      title: t("chat.stage.attachment.title"),
    },
    plan: {
      title: t("chat.stage.plan.title"),
    },
    write: {
      title: t("chat.stage.write.title"),
    },
  } satisfies Record<GenerationStage, { title: string }>;
  const stageText = stage ? stageInfo[stage] : null;
  // 解析和续接判断都按 content 缓存：输入时整个界面会重渲染，
  // 不能让每一回合都把整段重新解析一遍。
  const blocks: MessageBlock[] = useMemo(() => parseBlocks(content), [content]);
  const lastIsDialogue = blocks.length > 0 && blocks[blocks.length - 1].kind === "dlg";
  const continuedFlags = useMemo(
    () => blocks.map((_, index) => dialogueContinues(blocks, index, cardName)),
    [blocks, cardName],
  );

  if (blocks.length === 0) {
    return (
      <NarratorBlock>
        {streaming && stageText ? (
          <TaskBrief key={stage} title={stageText.title} />
        ) : (
          <p className="text-ink-3">{t("chat.empty")}</p>
        )}
      </NarratorBlock>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {streaming && stageText ? (
        <div className="ml-12">
          <TaskBrief key={stage} title={stageText.title} />
        </div>
      ) : null}
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const cursor = streaming && isLast ? <TypingCursor /> : null;
        // 操作按钮只贴在最后一块上；对白块内联，其余块追加在末尾
        const slot = isLast && lastIsDialogue ? actions : undefined;
        const key = `${index}-${block.kind}`;

        if (block.kind === "narr") {
          return (
            <NarratorBlock key={key}>
              <MarkdownText text={block.text} />
              {cursor}
            </NarratorBlock>
          );
        }

        if (block.kind === "act") {
          return (
            <ActionBlock key={key}>
              <MarkdownText text={block.text} />
              {cursor}
            </ActionBlock>
          );
        }

        if (block.kind === "scene") {
          return (
            <SceneEvent key={key}>
              <MarkdownText text={block.text} />
              {cursor}
            </SceneEvent>
          );
        }

        if (block.kind === "player") {
          // 模型不该产出 player 块，真出现了也按玩家气泡渲染，别混进对白
          return (
            <PlayerBubble key={key}>
              <MarkdownText tone="bubble" text={block.text} />
              {cursor}
            </PlayerBubble>
          );
        }

        const who = (block.who ?? cardName).trim() || cardName;
        const src = who === cardName ? portraitUrl : portraits?.[who];
        return (
          <DialogueBlock
            key={key}
            who={who}
            avatar={src ? <Avatar name={who} src={src} /> : undefined}
            continued={continuedFlags[index]}
            actions={slot}
          >
            <MarkdownText text={block.text} />
            {cursor}
          </DialogueBlock>
        );
      })}
      {/* 末块不是对白时按钮追加在末尾，缩进 48 与旁白、对白正文对齐 */}
      {!lastIsDialogue ? <div className="ml-12">{actions}</div> : null}
    </div>
  );
}

/**
 * Keep the draft state next to the textarea.  A draft changes on every
 * keystroke, so it must not live in ChatScreen, whose state also owns the
 * complete message history and its markdown tree.
 */
function ChatComposer({
  hasExtra,
  onPlus,
  onSend,
  onStop,
  placeholder,
  hintAlerts,
  hint,
  streaming,
  sendDisabled,
}: {
  hasExtra: boolean;
  onPlus: () => void;
  onSend: (text: string) => boolean;
  onStop: () => void;
  placeholder: string;
  hintAlerts: boolean;
  hint?: ReactNode;
  streaming: boolean;
  sendDisabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (onSend(draft)) setDraft("");
  }

  return (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={submit}
      onStop={onStop}
      hasExtra={hasExtra}
      onPlus={onPlus}
      placeholder={placeholder}
      hintAlerts={hintAlerts}
      hint={hint}
      streaming={streaming}
      sendDisabled={sendDisabled}
    />
  );
}

export function ChatScreen({
  cardId,
  card,
  config,
  userName = "你",
  style,
  onOpenSettings,
  onOpenShelf,
}: {
  cardId: string;
  card: CharacterCardData;
  config: ProviderConfig;
  userName?: string;
  style?: "haruhi" | "mushoku";
  onOpenSettings: () => void;
  onOpenShelf: () => void;
}) {
  const { t, locale } = useI18n();
  const greetings = useMemo(
    () =>
      openingGreetings(card).map((text) =>
        // 开场白也要走一遍宏：界面上和发给模型的历史里都不能留 {{user}}
        applyMacros(adaptGreeting(text, locale), { char: card.name, user: userName }),
      ),
    [card, locale, userName],
  );
  const [greetingIndex, setGreetingIndex] = useState(0);
  /** 建议输入由模型看着当前对话现生成，不写死在卡里 */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: "opening", role: "assistant", content: greetings[0] ?? card.first_mes },
  ]);
  const [composerReset, setComposerReset] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const [memory, setMemory] = useState<number | null>(null);
  const [cgBusy, setCgBusy] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const cgBusyRef = useRef<string | null>(null);
  /** 重新生成时留下的旧回复。新回复落地后成为最后一条 swipe，失败则原样放回去。 */
  const carrySwipesRef = useRef<string[] | null>(null);
  const carryTurnRef = useRef<Turn | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const swipeRef = useRef<{ x: number; y: number; left: boolean } | null>(null);
  const tapRef = useRef<{ x: number; t: number } | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  /** 正在编辑哪一条玩家消息，以及编辑框里的草稿 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  /** 刚复制过哪一条，用来把按钮文字短暂换成「已复制」 */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [includeNarration, setIncludeNarration] = useState(true);
  const [includeOoc, setIncludeOoc] = useState(false);
  const [exporting, setExporting] = useState(false);
  const summarizingRef = useRef(false);
  /** 这一轮的 meta 说历史超阈值了。用 ref，避免流结束时读到过期的 state。 */
  const needsSummarizeRef = useRef(false);

  const sessionRef = useRef<ChatSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const suggestingRef = useRef(false);
  /** 已经为哪一条回复生成过建议，避免同一轮反复请求 */
  const suggestedForRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 玩家有没有往回翻。翻上去了就别再把他拽回底部 */
  const pinnedRef = useRef(true);

  /**
   * 会话标识，服务端用它按会话统计缓存命中率。
   * 不在服务端渲染时生成：crypto.randomUUID() 会被当成不稳定值，预渲染直接失败。
   * 这个值不进页面，只在发请求时用，所以客户端首次渲染再填不会造成水合不一致。
   */
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null && typeof window !== "undefined") {
    sessionIdRef.current = createId();
  }
  const sessionId = sessionIdRef.current ?? "";
  /**
   * 概率条目与摘要判定的确定性依据。
   * 用会话 id 派生，整场不变——世界书条目不会随机闪现。
   */
  const seed = useMemo(() => hashSeed(sessionId), [sessionId]);
  /** 已经跑过几轮，Author's Note 的频率判定用 */
  const turnRef = useRef(0);
  /** 滚动摘要与关键事实，由 /api/chat 的 meta 与 PUT 端点维护，并加密存本机 */
  const summaryRef = useRef<RollingSummary | null>(null);
  const factsRef = useRef<KeyFacts>({ characters: {}, places: {}, flags: {} });
  const journalRef = useRef<Journal>(emptyJournal());
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const portraitBusy = useRef(new Set<string>());
  /** 额度或频率到顶后，自动生图和头像都停。手动再点仍会试一次。 */
  const imageHaltRef = useRef(false);
  useEffect(() => {
    imageHaltRef.current = false;
  }, [config.providerId, config.model, config.image.model, config.image.baseURL, config.apiKey, config.image.apiKey]);
  /** 长期记忆是否已经灌进来。没灌完就发请求会丢掉前面的剧情。 */
  const memoryReadyRef = useRef(false);
  const [memoryReady, setMemoryReady] = useState(false);

  /** 这张卡的立绘。卡里带着出处才拼得出来，拼不出来就退回首字母 */
  const portraitUrl = useMemo(() => cardPortraitUrl(card), [card]);
  const chatRoute = useMemo(
    () => presetChat({ providerId: config.providerId, model: config.model, baseURL: config.baseURL }),
    [config.providerId, config.model, config.baseURL],
  );

  const [browserReady, setBrowserReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void probeBrowserModel().then((ready) => {
      if (!cancelled) setBrowserReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const ready = canSend(config, browserReady);

  /** 还没说过话时，操作按钮的文案是「换一条开场」而不是「重新生成」 */
  /**
   * 压一次历史。独立端点，不占对话流的首字时间。
   * 只总结 coveredIndex 之后的新增部分，再把结果挂到旧摘要后面，
   * 整段重写会让旧细节一层层丢掉，那就是漂移。
   */
  async function summarizeNow(allTurns: Turn[]) {
    if (!isConfigured(config) || summarizingRef.current) return;
    const previous = summaryRef.current;
    const covered = previous?.coveredIndex ?? 0;
    const additions: ChatMessage[] = allTurns
      .slice(covered)
      .map((turn) => ({ role: turn.role, content: turn.content }));
    if (additions.length === 0) return;

    summarizingRef.current = true;
      needsSummarizeRef.current = false;
    try {
      const response = await fetch("/api/chat", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(config.apiKey),
        },
        body: JSON.stringify({
          providerId: config.providerId,
          model: chatRoute.model,
          ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
          previous: previous?.text ?? "",
          additions,
          facts: factsRef.current,
          coveredIndex: allTurns.length,
          compressedCount: previous?.compressedCount ?? 0,
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        summary?: { text: string; coveredIndex: number; compressedCount: number };
        facts?: KeyFacts;
      };
      if (payload.summary) {
        summaryRef.current = {
          text: payload.summary.text,
          coveredIndex: allTurns.length,
          compressedCount: payload.summary.compressedCount,
        };
      }
      if (payload.facts) factsRef.current = payload.facts;
      void saveCardMemory({
        cardId,
        summary: summaryRef.current,
        facts: factsRef.current,
        journal: journalRef.current,
        turn: turnRef.current,
        updatedAt: Date.now(),
      });
    } catch {
      // 压缩失败不影响对话，下一轮还会再提示一次
      needsSummarizeRef.current = true;
    } finally {
      summarizingRef.current = false;
    }
  }

  /**
   * 现场生成「玩家接下来可能输入什么」。
   * 这是次要请求：失败就保持原有建议，不弹错误，也不影响对话。
   */
  const requestSuggestions = useCallback(
    async (history: Turn[]) => {
      if (!isConfigured(config) || suggestingRef.current) return;
      const messages = buildSuggestionMessages(
        history.map((turn) => ({ role: turn.role, content: turn.content })),
      );

      suggestingRef.current = true;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(config.apiKey),
          },
          body: JSON.stringify({
            mode: "complete",
            providerId: config.providerId,
            model: chatRoute.model,
            messages,
            temperature: SUGGESTION_TEMPERATURE,
            maxTokens: SUGGESTION_MAX_TOKENS,
            ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
          }),
        });
        if (!response.ok || !response.body) return;

        const list = parseSuggestions(await readSseText(response.body));
        if (list.length > 0) setSuggestions(list);
      } catch {
        // 建议生成失败不影响对话
      } finally {
        suggestingRef.current = false;
      }
    },
    [config],
  );

  // 恢复这张卡上次的会话与长期记忆；没有就从开场白建一个。
  // ChatScreen 以卡 id 为 key 挂载，换角色即重跑这一段。
  // 只在异步回调里 setState，不在 effect 体内同步 setState。
  useEffect(() => {
    let cancelled = false;
    const store = getSessionStore();
    memoryReadyRef.current = false;
    sessionRef.current = null;

    void (async () => {
      // 长期记忆必须先到位，否则第一轮的提示词里没有上次的剧情
      const memory = await loadCardMemory(cardId);
      if (cancelled) return;
      summaryRef.current = memory.summary;
      factsRef.current = memory.facts;
      journalRef.current = normalizeJournal(memory.journal);
      setPortraits(journalRef.current.portraits ?? {});
      turnRef.current = memory.turn;
      const sessions = await store.list();
      if (cancelled) return;

      const existing = sessions.find((s) => s.cardId === cardId);
      if (existing) {
        sessionRef.current = existing;
        const restored = existing.messages.map((m, index) => ({
          id: m.id,
          role: m.role,
          // 开场白是卡里来的，可能带 {{user}} / {{char}}；旧存档也要补上这一步
          content:
            index === 0
              ? applyMacros(adaptGreeting(m.content, locale), {
                  char: card.name,
                  user: userName,
                })
              : adaptGreeting(m.content, locale),
          cg: m.cg,
          image: m.image,
          imageNote: m.imageNote,
          document: normalizeDocument(m.document),
          swipes: m.swipes,
          swipeIndex: m.swipeIndex,
          chapterBreak: m.chapterBreak,
        }));
        setTurns(restored);
        // 占用百分比只在发送时由服务端带回。刷新后用同一套组装再算一次，环才不会归零。
        const assembled = assemble({
          card: {
            name: card.name,
            description: card.description,
            personality: card.personality,
            scenario: card.scenario,
            system_prompt: card.system_prompt,
            mes_example: card.mes_example,
            post_history_instructions: card.post_history_instructions,
          },
          lorebook: card.character_book ? { entries: card.character_book.entries } : undefined,
          history: restored.map((turn) => ({ role: turn.role, content: historyContent(turn) })),
          seed: hashSeed(existing.id),
          turn: turnRef.current,
          summary: summaryRef.current ?? undefined,
          facts: factsRef.current,
          journal: journalRef.current,
          style,
          userName,
          budget: planBudget(16_000, 1024),
        });
        setMemory(Math.round((assembled.budget.used / Math.max(assembled.budget.max, 1)) * 100));
        memoryReadyRef.current = true;
        setMemoryReady(true);
        return;
      }

      const created = createSession({
        cardId,
        cardName: card.name,
        opening: greetings[0] ?? card.first_mes,
      });
      sessionRef.current = created;
      await store.save(created);
      memoryReadyRef.current = true;
      setMemoryReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId, card.name, card.first_mes, greetings, locale, userName]);

  /**
   * 每次回复落地后刷新建议。
   * 用最后一条回复的 id 做闸门：同一轮只生成一次，
   * 否则 effect 会跟着 turns 的变化反复触发。
   */
  useEffect(() => {
    if (!ready || streaming) return;
    const last = turns[turns.length - 1];
    if (!last || last.role !== "assistant" || !last.content) return;
    if (suggestedForRef.current === last.id) return;

    suggestedForRef.current = last.id;
    void requestSuggestions(turns);
  }, [turns, ready, streaming, requestSuggestions]);

  /**
   * 自动滚到最新一条。流式期间每次增量都会触发，
   * 但只有在玩家本来就贴着底部时才跟随，往回翻看旧内容时不会被拽走。
   * 建议胶囊加载后会改变底部高度，所以也算一个触发点。
   */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [turns, suggestions, cgBusy]);

  /** 落盘时保留已有消息的 createdAt，只给新消息盖时间戳。 */
  function persist(nextTurns: Turn[]) {
    const session = sessionRef.current;
    if (!session) return;

    const previous = new Map(session.messages.map((m) => [m.id, m]));
    const messages: StoredMessage[] = nextTurns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      createdAt: previous.get(turn.id)?.createdAt ?? Date.now(),
      ...(turn.cg ? { cg: turn.cg } : {}),
      ...(turn.swipes?.length
        ? { swipes: turn.swipes, swipeIndex: turn.swipeIndex ?? turn.swipes.length - 1 }
        : {}),
      ...(turn.chapterBreak ? { chapterBreak: true } : {}),
      ...(turn.image ? { image: turn.image } : {}),
      ...(turn.imageNote ? { imageNote: turn.imageNote } : {}),
      ...(turn.document ? { document: turn.document } : {}),
    }));

    const updated: ChatSession = { ...session, messages, updatedAt: Date.now() };
    sessionRef.current = updated;
    void getSessionStore().save(updated);
  }

  /**
   * 跑一轮：baseTurns 是「不含本轮玩家输入」的历史，
   * 函数自己把玩家这一轮和 assistant 占位追加进去。
   *
   * 远程模型仍由服务端组装。本机 LanguageModel 在浏览器里组装并生成。
   */
  async function runTurn(
    userMessage: string,
    baseTurns: Turn[],
    image?: string,
    document?: ChatDocument,
  ) {
    setError(null);
    needsSummarizeRef.current = false;
    setGenerationStage(null);
    setStreaming(true);
    setSuggestions([]);

    const controller = new AbortController();
    abortRef.current = controller;

    // 先把玩家这一轮和空的 assistant 占位画出来，再做图片识别、导演规划
    // 或网络请求。否则这些 await 期间界面仍停在上一条回复下面，玩家会以为
    // 点击没有生效；流式光标也会暂时挂在上一条回复末尾。
    const userTurn: Turn = {
      id: createId(),
      role: "user",
      content: markPlayer(userMessage),
      ...(image ? { image } : {}),
      ...(document ? { document } : {}),
    };
    const assistantId = createId();
    setTurns((prev) => [
      ...prev,
      userTurn,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const local = usesBrowserModel(config, browserReady);
    if (process.env.NODE_ENV === "development") {
      console.debug("[ai-rp] chat transport", {
        providerId: config.providerId,
        model: config.model,
        hasApiKey: cleanApiKey(config.apiKey).value.length > 0,
        apiKeyJunkChars: cleanApiKey(config.apiKey).removed,
        browserReady,
        local,
        reason: local
          ? config.providerId === BROWSER_PROVIDER_ID
            ? "browser provider selected"
            : "browser fallback because no API key was available"
          : "remote API route",
      });
    }
    const seesImages = local || (chatRoute.vision ?? config.vision);
    let imageNote = "";
    let outboundImage = image;
    if (image && !seesImages) {
      setGenerationStage("attachment");
      outboundImage = undefined;
      if (browserReady) {
        try {
          imageNote = await describeImage(image, controller.signal);
        } catch (caught) {
          if (caught instanceof Error && caught.name === "AbortError") {
            setStreaming(false);
            abortRef.current = null;
            setTurns(baseTurns);
            return;
          }
        }
      }
    }

    if (imageNote) {
      userTurn.imageNote = imageNote;
      setTurns((prev) =>
        prev.map((turn) => (turn.id === userTurn.id ? { ...turn, imageNote } : turn)),
      );
    }

    const history: ChatMessage[] = [
      ...baseTurns.map((turn) => ({ role: turn.role, content: historyContent(turn) })),
      ...userTurnsAsMessages(userTurn),
    ];

    // 远程模型优先从浏览器直连。只有 CORS、网络或上游协议失败时，才回退到 /api/chat。
    // 组装器是纯函数，因此可以安全地在浏览器运行；服务端路径仍保留作后备。
    let directMessages: ChatMessage[] | null = null;
    let directEndpoint = "";
    if (!local) {
      setGenerationStage("plan");
      const preset = findProvider(config.providerId);
      const baseURL = config.providerId === "custom" ? config.baseURL : preset?.baseURL ?? "";
      try {
        directEndpoint = browserChatEndpoint(baseURL);
        const assembled = assemble({
          card: {
            name: card.name,
            description: card.description,
            personality: card.personality,
            scenario: card.scenario,
            system_prompt: card.system_prompt,
            mes_example: card.mes_example,
            post_history_instructions: card.post_history_instructions,
          },
          lorebook: card.character_book ? { entries: card.character_book.entries } : undefined,
          history,
          seed,
          turn: turnRef.current,
          summary: summaryRef.current ?? undefined,
          facts: factsRef.current,
          journal: journalRef.current,
          style,
          userName,
          budget: planBudget(16_000, 1024),
        });
        directMessages = assembled.messages;
        let planText = "";
        await streamBrowserOpenAI({
          endpoint: directEndpoint,
          apiKey: cleanApiKey(config.apiKey).value,
          model: chatRoute.model,
          messages: buildDirectorMessages(assembled.messages),
          temperature: 0.2,
          maxTokens: 420,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              planText += event.text;
            }
          },
        });
        const plan = parseTurnPlan(planText);
        if (plan) directMessages = [...assembled.messages, { role: "system", content: formatTurnPlan(plan) }];
      } catch {
        directMessages = null;
      }
    }

    let replyText = "";
    let toolTrace: ToolTrace[] = [];
    let allowTools = true;

    const appendReply = (text: string) => {
      replyText += text;
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === assistantId ? { ...turn, content: turn.content + text } : turn,
        ),
      );
    };

    try {
      if (local) {
        setGenerationStage("write");
        const assembled = assemble({
          card: {
            name: card.name,
            description: card.description,
            personality: card.personality,
            scenario: card.scenario,
            system_prompt: card.system_prompt,
            mes_example: card.mes_example,
            post_history_instructions: card.post_history_instructions,
          },
          lorebook: card.character_book ? { entries: card.character_book.entries } : undefined,
          history,
          seed,
          turn: turnRef.current,
          summary: summaryRef.current ?? undefined,
          facts: factsRef.current,
          journal: journalRef.current,
          style,
          userName,
          budget: planBudget(16_000, 1024),
        });
        setMemory(Math.round((assembled.budget.used / Math.max(assembled.budget.max, 1)) * 100));
        await streamBrowserChat({
          messages: assembled.messages,
          temperature: config.temperature,
          image: outboundImage,
          signal: controller.signal,
          onDelta: appendReply,
        });
      }
      for (let round = 0; local ? round < 0 : round < 2; round += 1) {
        const calls: PendingTool[] = [];
        const handleEvent = (frame: WireFrame) => {
          if (frame === "[DONE]") return;
          if (frame.type === "delta") {
            replyText += frame.text;
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId ? { ...turn, content: turn.content + frame.text } : turn,
              ),
            );
          } else if (frame.type === "tool") {
            absorbToolCall(calls, frame);
          } else if (frame.type === "meta") {
            setMemory(Math.round((frame.used / Math.max(frame.max, 1)) * 100));
            needsSummarizeRef.current = frame.needsSummarize;
          } else if (frame.type === "error") {
            setError({ status: 502, code: "stream", message: frame.message });
          }
        };

        if (directMessages && directEndpoint) {
          setGenerationStage("write");
          try {
            await streamBrowserOpenAI({
              endpoint: directEndpoint,
              apiKey: cleanApiKey(config.apiKey).value,
              model: chatRoute.model,
              messages: directMessages,
              temperature: config.temperature,
              maxTokens: 1024,
              tools: allowTools ? [...MEMORY_TOOLS, DICE_TOOL] : undefined,
              image: outboundImage,
              signal: controller.signal,
              onEvent: (event) => handleEvent(event),
            });
          } catch (caught) {
            // 只在还没有收到正文时回退，避免把已显示的半段回复重复一遍。
            if (replyText) throw caught;
            directMessages = null;
            continue;
          }
        } else {
        setGenerationStage("write");
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Key 走请求头，绝不进 URL
            ...authHeaders(config.apiKey),
          },
          signal: controller.signal,
          body: JSON.stringify({
            providerId: config.providerId,
            model: chatRoute.model,
            temperature: config.temperature,
            ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
            sessionId,
            tools: allowTools,
            ...(outboundImage ? { image: outboundImage } : {}),
            context: {
              card: {
                name: card.name,
                description: card.description,
                personality: card.personality,
                scenario: card.scenario,
                system_prompt: card.system_prompt,
                mes_example: card.mes_example,
                post_history_instructions: card.post_history_instructions,
              },
              // 卡上的简化世界书翻译成新版结构：常驻条目原样保留
              lorebook: card.character_book
                ? { entries: card.character_book.entries }
                : undefined,
              history,
              seed,
              turn: turnRef.current,
              summary: summaryRef.current ?? undefined,
              facts: factsRef.current,
              journal: journalRef.current,
              ...(toolTrace.length > 0 ? { toolTrace } : {}),
              style,
              userName,
            },
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: ChatError }
            | null;
          throw Object.assign(new Error("request failed"), {
            chatError: payload?.error ?? {
              status: response.status,
              code: `http_${response.status}`,
              message: t("chat.httpFail", { status: response.status }),
            },
          });
        }

        if (!response.body) {
          throw Object.assign(new Error("no body"), {
            chatError: { status: 502, code: "no_body", message: t("chat.noBody") },
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const { frames, rest } = decodeSseBuffer(buffer);
          buffer = rest;

          for (const frame of frames) handleEvent(frame);
        }
        }

        const named = calls.filter((call) => call.name);
        if (!allowTools || named.length === 0) break;

        let rolled = false;
        const freshCharacters: Array<{ name: string; detail: string }> = [];
        for (const call of named) {
          if (call.name === "roll_dice") rolled = true;
          if (call.name === "remember_character") {
            const created = newCharacter(journalRef.current, call.arguments);
            if (created) freshCharacters.push(created);
          }
          // 带上当前轮次：模型不传 turn 时，目录也能知道哪条是新的
          const applied = applyChatTool(journalRef.current, call.name, call.arguments, turnRef.current);
          journalRef.current = applied.journal;
          toolTrace = [
            ...toolTrace,
            { name: call.name, arguments: call.arguments, result: applied.result },
          ];
        }
        for (const created of freshCharacters) {
          void ensurePortrait(created.name, created.detail);
        }
        // 工具结果的下一轮继续走服务端后备路径，保持现有 toolTrace 语义，
        // 避免把不完整的原生 tool message 协议伪装成普通历史。
        directMessages = null;
        setGenerationStage("write");
        void saveCardMemory({
          cardId,
          summary: summaryRef.current,
          facts: factsRef.current,
          journal: journalRef.current,
          turn: turnRef.current,
          updatedAt: Date.now(),
        });
        allowTools = false;
        if (rolled && replyText) {
          replyText = "";
          setTurns((prev) =>
            prev.map((turn) => (turn.id === assistantId ? { ...turn, content: "" } : turn)),
          );
        }
        if (replyText.trim()) break;
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        // 主动停止，不算错误，已经吐出来的内容保留
      } else {
        if (process.env.NODE_ENV === "development") {
          console.error("[ai-rp] chat request failed", caught);
        }
        const chatError = (caught as { chatError?: ChatError }).chatError;
        setError(
          chatError ?? {
            status: 0,
            code: local ? "browser_model" : "network",
            message: t(local ? "chat.browserFail" : "chat.network"),
          },
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;

      const finalTurns: Turn[] = [...baseTurns, userTurn];
      const carried = carrySwipesRef.current;
      carrySwipesRef.current = null;
      if (replyText) {
        const swipes = carried ? [...carried, replyText] : undefined;
        finalTurns.push({
          id: assistantId,
          role: "assistant",
          content: replyText,
          swipes,
          swipeIndex: swipes ? swipes.length - 1 : undefined,
        });
        carryTurnRef.current = null;
      } else if (carryTurnRef.current) {
        finalTurns.push(carryTurnRef.current);
        carryTurnRef.current = null;
      }

      setTurns(finalTurns);
      persist(finalTurns);

      turnRef.current += 1;
      if (replyText) void maybeAutoCg(finalTurns);
      void saveCardMemory({
        cardId,
        summary: summaryRef.current,
        facts: factsRef.current,
        journal: journalRef.current,
        turn: turnRef.current,
        updatedAt: Date.now(),
      });
      // 压一次历史。放在这里而不是流中途，免得拖慢首字时间
      if (needsSummarizeRef.current) void summarizeNow(finalTurns);
    }
  }

  function cgStats(list: Turn[]) {
    const cards = list.flatMap((turn) => (turn.cg ? [turn.cg] : []));
    const last = cards.reduce((max, card) => Math.max(max, card.turn), -1);
    return {
      count: cards.length,
      lastCgTurn: last < 0 ? null : last,
      seen: cards.map((card) => card.sceneKey),
    };
  }

  async function postImage(body: Record<string, unknown>) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const chatKey = cleanApiKey(config.apiKey).value;
    const imageKey = cleanApiKey(config.image.apiKey).value;
    if (chatKey) headers.Authorization = `Bearer ${chatKey}`;
    if (imageKey) headers["x-image-key"] = imageKey;
    const response = await fetch("/api/image", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: config.providerId,
        model: chatRoute.model,
        ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
        imageModel: config.image.model.trim(),
        imageProviderId: imageProviderId(config),
        ...(config.image.baseURL.trim() ? { imageBaseURL: config.image.baseURL.trim() } : {}),
        styleId: config.image.styleId,
        name: card.name,
        appearance: extractAppearance(card.description),
        ...body,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: ChatError;
      prompt?: string;
      src?: string;
      score?: number;
    } | null;
    if (!response.ok) {
      throw (
        payload?.error ?? {
          status: response.status,
          code: `http_${response.status}`,
          message: t("chat.imageHttp", { status: response.status }),
        }
      );
    }
    return payload ?? {};
  }

  function noteImageHalt(error: unknown) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 402 || status === 403 || status === 429) imageHaltRef.current = true;
  }

  /** 新角色的头像。没配生图模型就跳过，失败也不打断对话。 */
  async function ensurePortrait(name: string, detail: string) {
    if (imageHaltRef.current) return;
    if (!isImageConfigured(config) || name === card.name) return;
    if (journalRef.current.portraits?.[name] || portraitBusy.current.has(name)) return;
    portraitBusy.current.add(name);
    try {
      const payload = await postImage({
        action: "generate",
        name,
        appearance: detail,
        scene: "",
        portrait: true,
      });
      if (!payload.src) return;
      const src = await shrinkPortrait(payload.src);
      journalRef.current = putPortrait(journalRef.current, name, src);
      setPortraits({ ...(journalRef.current.portraits ?? {}) });
      void saveCardMemory({
        cardId,
        summary: summaryRef.current,
        facts: factsRef.current,
        journal: journalRef.current,
        turn: turnRef.current,
        updatedAt: Date.now(),
      });
    } catch (caught) {
      noteImageHalt(caught);
    } finally {
      portraitBusy.current.delete(name);
    }
  }

  /** 出图不占对话的 streaming 状态，所以打字和发送都不会被它卡住。 */
  async function generateFor(turn: Turn, source: "manual" | "auto") {
    if (source === "auto" && imageHaltRef.current) return;
    if (!isImageConfigured(config) || cgBusyRef.current) return;
    cgBusyRef.current = turn.id;
    setCgBusy(turn.id);
    try {
      const payload = await postImage({ action: "generate", scene: sceneText(turn.content) });
      if (!payload.src || !payload.prompt) {
        throw { status: 502, code: "empty_image", message: t("chat.imageEmpty") };
      }
      const storedSrc = await persistGeneratedImage(payload.src);
      const cg: StoredCg = {
        id: createId(),
        prompt: payload.prompt,
        src: storedSrc,
        sceneKey: sceneKey(turn.content),
        source,
        turn: turnRef.current,
        createdAt: Date.now(),
      };
      setTurns((prev) => {
        const next = prev.map((item) => (item.id === turn.id ? { ...item, cg } : item));
        persist(next);
        return next;
      });
    } catch (caught) {
      noteImageHalt(caught);
      if (source === "manual") {
        const info = caught as ChatError;
        setError(
          info?.message
            ? info
            : { status: 0, code: "image", message: t("chat.imageFail") },
        );
      }
    } finally {
      cgBusyRef.current = null;
      setCgBusy(null);
    }
  }

  /**
   * 自动生图。评分和出图都在回复落地之后另起请求，
   * 不进主提示词，也不把 streaming 再设回去。
   */
  async function maybeAutoCg(allTurns: Turn[]) {
    if (imageHaltRef.current) return;
    if (!config.image.auto || !isImageConfigured(config)) return;
    const last = allTurns[allTurns.length - 1];
    if (!last || last.role !== "assistant" || !last.content) return;
    const stats = cgStats(allTurns);
    const key = sceneKey(last.content);
    const gate = allowAutoCg({
      enabled: true,
      turn: turnRef.current,
      lastCgTurn: stats.lastCgTurn,
      count: stats.count,
      budget: config.image.budget,
      sceneKey: key,
      seen: stats.seen,
    });
    if (!gate.ok) return;
    try {
      const payload = await postImage({ action: "score", scene: sceneText(last.content) });
      if (!scoreAllows(payload.score ?? null, config.image.threshold)) return;
      await generateFor(last, "auto");
    } catch (caught) {
      noteImageHalt(caught);
    }
  }

  function downloadCg(cg: StoredCg) {
    const anchor = document.createElement("a");
    anchor.href = cg.src;
    anchor.download = `${card.name}-cg.png`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  /** 清空这场对话和滚动记忆，只留当前开场白。 */
  function resetSession() {
    if (streaming || !memoryReadyRef.current) return;
    const next: Turn[] = [
      { id: "opening", role: "assistant", content: greetings[greetingIndex] ?? card.first_mes },
    ];
    setSuggestions([]);
    suggestedForRef.current = next[0]?.id ?? null;
    summaryRef.current = null;
    factsRef.current = { characters: {}, places: {}, flags: {} };
    journalRef.current = emptyJournal();
    setPortraits({});
    turnRef.current = 0;
    setTurns(next);
    persist(next);
    void saveCardMemory(emptyCardMemory(cardId));
    setResetOpen(false);
  }

  function send(text: string): boolean {
    const userMessage = text.trim();
    if ((!userMessage && !attachment) || streaming || !memoryReadyRef.current) return false;
    const image = attachment?.kind === "image" ? attachment.src : undefined;
    const document =
      attachment?.kind === "document"
        ? { name: attachment.name, text: attachment.text }
        : undefined;
    carrySwipesRef.current = null;
    carryTurnRef.current = null;
    setComposerReset((key) => key + 1);
    setAttachment(null);
    setSuggestions([]);
    const visible = userMessage || (document ? t("chat.fileOnly") : t("chat.imageOnly"));
    void runTurn(visible, turns, image, document);
    return true;
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    const looksLikeImage =
      file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
    if (looksLikeImage) {
      try {
        setAttachment({ kind: "image", src: await readChatImage(file) });
      } catch {
        setError({ status: 0, code: "image", message: t("chat.imageBad") });
      }
      return;
    }
    try {
      const document = await readChatDocument(file);
      setAttachment({ kind: "document", name: document.name, text: document.text });
    } catch {
      setError({ status: 0, code: "file", message: t("chat.fileBad") });
    }
  }

  /** 开场白换一条：在 first_mes 与 alternate_greetings 之间轮换。 */
  function cycleGreeting() {
    if (greetings.length <= 1 || !memoryReadyRef.current) return;
    const next = (greetingIndex + 1) % greetings.length;
    setGreetingIndex(next);
    const nextTurns: Turn[] = [
      { id: "opening", role: "assistant", content: greetings[next] },
    ];
    setTurns(nextTurns);
    persist(nextTurns);
  }

  function regenerate() {
    if (streaming || !memoryReadyRef.current) return;
    if (turns.length <= 1) {
      cycleGreeting();
      return;
    }
    // 丢掉最后一条回复，用它前面那条玩家输入重跑
    const base = turns.slice(0, -1);
    const userIndex = base.map((t) => t.role).lastIndexOf("user");
    if (userIndex < 0) {
      cycleGreeting();
      return;
    }
    const userText = playerText(base[userIndex].content);
    const userImage = base[userIndex].image;
    const userDocument = base[userIndex].document;
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") {
      carrySwipesRef.current = last.swipes?.length ? [...last.swipes] : [last.content];
      carryTurnRef.current = last;
    }
    setTurns(base.slice(0, userIndex));
    void runTurn(userText, base.slice(0, userIndex), userImage, userDocument);
  }

  /** 复制一条消息的正文。剪贴板 API 在不安全来源下没有，退回到老办法。 */
  async function copyMessage(id: string, text: string) {
    const body = text.trim();
    if (!body) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(body);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      const area = document.createElement("textarea");
      area.value = body;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(area);
    }
    if (!ok) return;
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1400);
  }

  function startEdit(turn: Turn) {
    setEditingId(turn.id);
    setEditingText(playerText(turn.content));
  }

  /** 改完这条玩家消息就从这里重跑：后面的对话被丢掉，由模型重新接。 */
  function applyEdit(turn: Turn, index: number) {
    const text = editingText.trim();
    setEditingId(null);
    if (!text || streaming) return;
    const base = turns.slice(0, index);
    setTurns(base);
    void runTurn(text, base, turn.image, turn.document);
  }

  function switchSwipe(turn: Turn, delta: number) {
    if (!turn.swipes?.length) return;
    const count = turn.swipes.length;
    const index = ((turn.swipeIndex ?? count - 1) + delta + count) % count;
    const content = turn.swipes[index] ?? turn.content;
    setTurns((prev) => {
      const next = prev.map((item) =>
        item.id === turn.id ? { ...item, swipeIndex: index, content } : item,
      );
      persist(next);
      return next;
    });
  }

  function toggleChapter(turn: Turn) {
    setTurns((prev) => {
      const next = prev.map((item) =>
        item.id === turn.id ? { ...item, chapterBreak: !item.chapterBreak } : item,
      );
      persist(next);
      return next;
    });
  }

  async function exportEpub() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const { buildEpub, epubFileName } = await import("@/lib/export/epub");
      const blob = await buildEpub({
        title: card.name,
        author: card.creator?.trim() || userName,
        description: card.scenario.trim().slice(0, 180),
        scenario: card.scenario,
        options: {
          includeNarration,
          includeOoc,
          userName,
          charName: card.name,
        },
        messages: turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          swipes: turn.swipes,
          swipeIndex: turn.swipeIndex,
          chapterBreak: turn.chapterBreak,
          cgSrc: turn.cg?.src,
        })),
      });
      const anchor = document.createElement("a");
      const url = URL.createObjectURL(blob);
      anchor.href = url;
      anchor.download = epubFileName(card.name);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportOpen(false);
    } catch (caught) {
      setError({
        status: 0,
        code: "epub",
        message: caught instanceof Error ? caught.message : t("chat.exportFail"),
      });
    } finally {
      setExporting(false);
    }
  }

  const imageReady = isImageConfigured(config);
  const chapters = chapterList(turns, t("chat.openingChapter")).map((item) => ({
    id: item.id,
    n: item.n,
    text: item.text || t("chat.chapterN", { n: item.n }),
  }));

  function jumpChapter(id: string) {
    setTocOpen(false);
    document.getElementById(`chapter-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function onTouchStart(event: TouchEvent) {
    if (window.innerWidth >= 768) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, textarea")) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    swipeRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      left: touch.clientX < window.innerWidth / 2,
    };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || window.innerWidth >= 768) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (start.left && dx <= -48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      setTocOpen((open) => !open);
      return;
    }
    if (!start.left || Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const now = Date.now();
    const last = tapRef.current;
    if (last && now - last.t < 320 && Math.abs(touch.clientX - last.x) < 48) {
      tapRef.current = null;
      setTocOpen((open) => !open);
      return;
    }
    tapRef.current = { x: touch.clientX, t: now };
  }

  return (
    <div
      className="relative flex h-dvh"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <TocStrip
        items={chapters}
        onPick={jumpChapter}
        open={tocOpen}
        openLabel={t("chat.toc")}
        closeLabel={t("common.close")}
        onOpen={() => setTocOpen(true)}
        onClose={() => setTocOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
      <TopBar
        className="absolute inset-x-0 top-0 z-20"
        avatar={<Avatar name={card.name} src={portraitUrl} />}
        name={card.name}
        subtitle={card.tags?.join(" · ")}
        memoryUsed={memory}
        whoLabel={t("topbar.who")}
        memoryLabel={
          memory == null ? t("topbar.memoryUnknown") : t("topbar.memory", { percent: memory })
        }
        historyLabel={t("chat.reset")}
        exportLabel={t("topbar.export")}
        settingsLabel={t("topbar.settings")}
        onWho={onOpenShelf}
        onHistory={() => setResetOpen(true)}
        onExport={() => setExportOpen(true)}
        onSettings={onOpenSettings}
        extra={<AnnouncementBell onClick={() => setAnnounceOpen(true)} />}
      />

      <ChatScroll
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          pinnedRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <ChatColumn>
          {turns[0] ? (
            <ChapterMark
              id="chapter-start"
              index={t("chat.chapterN", { n: 1 })}
              title={chapterHeading(turns[0].content) || t("chat.openingChapter")}
            />
          ) : null}
          {turns.map((turn, index) => {
            const chapter = chapterAt(turns, index);
            const chapterMark = chapter ? (
              <ChapterMark
                id={`chapter-${turn.id}`}
                index={t("chat.chapterN", { n: chapter.n })}
                title={chapter.title || t("chat.chapterN", { n: chapter.n })}
              />
            ) : null;
            if (turn.role === "user") {
              const editing = editingId === turn.id;
              return (
                <Fragment key={turn.id}>
                  {editing ? (
                    <div className="flex justify-end">
                      <div className="flex w-full max-w-[82%] flex-col gap-2">
                        <textarea
                          autoFocus
                          rows={3}
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              applyEdit(turn, index);
                            }
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          className="max-h-[40dvh] w-full resize-y rounded-card border border-line-strong bg-surface-2 px-[18px] py-[11px] text-[15.5px] leading-[1.65] text-ink outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <ActPill onClick={() => setEditingId(null)}>{t("chat.cancel")}</ActPill>
                          <ActPill hot onClick={() => applyEdit(turn, index)}>
                            {t("chat.save")}
                          </ActPill>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 气泡和操作行包在一起：对话列的轮间距 26px 只落在轮与轮之间，
                       气泡和自己这行图标之间只留 4px */
                    <div className="flex flex-col gap-1">
                      <PlayerBubble>
                        {turn.image ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={turn.image} alt="" className="mb-2 max-h-60 w-full rounded-md object-cover" />
                        ) : null}
                        {turn.document ? (
                          <p className="mb-1 truncate text-[12px] text-ink-2">{turn.document.name}</p>
                        ) : null}
                        <MarkdownText tone="bubble" text={playerText(turn.content)} />
                      </PlayerBubble>
                      {/* 生成中不给改，改到一半重跑会把这一轮弄乱 */}
                      {!streaming ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            aria-label={t("chat.copy")}
                            title={copiedId === turn.id ? t("chat.copied") : t("chat.copy")}
                            onClick={() =>
                              void copyMessage(turn.id, [turn.document?.name, playerText(turn.content)].filter(Boolean).join("\n\n"))
                            }
                            className="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                          >
                            {copiedId === turn.id ? (
                              <IconCheck className="size-4" />
                            ) : (
                              <IconCopy className="size-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={t("chat.edit")}
                            title={t("chat.edit")}
                            onClick={() => startEdit(turn)}
                            className="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                          >
                            <IconEdit className="size-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                  {chapterMark}
                </Fragment>
              );
            }

            const isLastTurn = index === turns.length - 1;
            const actions = !streaming ? (
              <MessageActions>
                {isLastTurn && (turns.length > 1 || greetings.length > 1) ? (
                  <ActPill hot onClick={regenerate}>
                    {turns.length <= 1 ? t("chat.newOpening") : t("chat.regenerate")}
                  </ActPill>
                ) : null}
                {turn.swipes && turn.swipes.length > 1 ? (
                  <>
                    <ActPill onClick={() => switchSwipe(turn, -1)}>{t("chat.prev")}</ActPill>
                    <ActPill onClick={() => switchSwipe(turn, 1)}>
                      {(turn.swipeIndex ?? turn.swipes.length - 1) + 1}/{turn.swipes.length}
                    </ActPill>
                  </>
                ) : null}
                <ActPill hot={turn.chapterBreak} onClick={() => toggleChapter(turn)}>
                  {turn.chapterBreak ? t("chat.unchapter") : t("chat.chapter")}
                </ActPill>
                {/* 没配生图模型就整颗不出现，不给假入口 */}
                {isLastTurn && imageReady ? (
                  <ActPill
                    disabled={cgBusy === turn.id}
                    title={t("chat.cgTitle")}
                    onClick={() => void generateFor(turn, "manual")}
                  >
                    {t("chat.cg")}
                  </ActPill>
                ) : null}
              </MessageActions>
            ) : undefined;

            return (
              <Fragment key={turn.id}>
                <AssistantTurn
                  content={turn.content}
                  streaming={streaming && isLastTurn}
                  stage={streaming && isLastTurn ? generationStage ?? undefined : undefined}
                  cardName={card.name}
                  portraitUrl={portraitUrl}
                  portraits={portraits}
                  actions={actions}
                />
                {cgBusy === turn.id ? (
                  <CgLoading label={t("chat.generating")} />
                ) : turn.cg ? (
                  <div>
                    <CgCard
                      src={turn.cg.src}
                      alt={turn.cg.prompt}
                      caption={`${t(config.image.styleId === "watercolor" ? "image.style.watercolor" : "image.style.jp-flat")} · ${turn.cg.source === "auto" ? t("chat.cgAuto") : t("chat.cgManual")}`}
                      icon={<IconImage className="size-3.5" />}
                    />
                    <MessageActions>
                      <ActPill onClick={() => void generateFor(turn, "manual")}>{t("chat.regenerate")}</ActPill>
                      <ActPill onClick={() => downloadCg(turn.cg!)}>{t("chat.save")}</ActPill>
                    </MessageActions>
                  </div>
                ) : null}
                {chapterMark}
                {/*
                  建议输入挂在最后一条回复下面，跟着对话一起滚，
                  不占输入框上方那块空间。选一条就发，发完这批就消失。
                */}
                {isLastTurn && !streaming && suggestions.length > 0 ? (
                  <div className="ml-12 flex flex-col gap-2.5">
                    <SuggestDivider label={t("chat.suggestLabel")} />
                    <SuggestRow className="!w-auto !px-0 !py-0">
                      {suggestions.map((text) => (
                        <SuggestChip
                          key={text}
                          onClick={() => {
                            setSuggestions([]);
                            send(text);
                          }}
                        >
                          {text}
                        </SuggestChip>
                      ))}
                    </SuggestRow>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </ChatColumn>
      </ChatScroll>

      <div className="shrink-0 px-4 pt-1.5 pb-4">
        {error ? (
          <div className="mx-auto mb-2 flex max-w-[660px] flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
            <span className="font-bold">{error.message}</span>
            {error.status === 401 || error.status === 400 ? (
              <button type="button" onClick={onOpenSettings} className="underline">
                {t("chat.openSettings")}
              </button>
            ) : null}
          </div>
        ) : null}

        {attachment ? (
          <div className="mx-auto mb-2 flex max-w-[660px] items-center gap-2">
            {attachment.kind === "image" ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={attachment.src} alt="" className="h-14 w-14 rounded-md object-cover" />
            ) : (
              <span className="max-w-[420px] truncate text-[13px] text-ink">{attachment.name}</span>
            )}
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-[12.5px] text-ink-2 underline"
            >
              {attachment.kind === "image" ? t("chat.removeImage") : t("chat.removeFile")}
            </button>
          </div>
        ) : null}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*,.txt,.md,.markdown,.csv,.json,.log,.docx,text/plain,text/markdown,text/csv,application/json"
          className="hidden"
          onChange={(event) => {
            void pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <ChatComposer
          key={composerReset}
          hasExtra={!!attachment}
          onPlus={() => imageInputRef.current?.click()}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          placeholder={t("chat.sayTo", { name: card.name })}
          hintAlerts={!ready}
          hint={
            !ready ? (
              <button type="button" onClick={onOpenSettings} className="underline">
                {t("chat.needKey")}
              </button>
            ) : null
          }
          streaming={streaming}
          sendDisabled={!memoryReady}
        />
        {/* AI 生成的出处与责任，常驻在输入框下方，不关也不消失 */}
        <p className="mx-auto mt-2 max-w-[660px] text-center text-[11.5px] leading-relaxed text-ink-3">
          {t("chat.aiNotice")}
        </p>
      </div>
      </div>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        closeLabel={t("common.close")}
        title={t("chat.reset")}
      >
        <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">{t("chat.resetHint")}</p>
        <div className="mt-4 flex gap-2">
          <PillButton block onClick={() => setResetOpen(false)}>
            {t("chat.cancel")}
          </PillButton>
          <PillButton variant="danger" block onClick={resetSession}>
            {t("chat.reset")}
          </PillButton>
        </div>
      </Dialog>

      <Veil open={exportOpen} onClose={() => setExportOpen(false)} />
      <Sheet open={exportOpen} title={t("chat.exportEpub")}>
          <div className="mb-4 flex flex-wrap gap-2">
            <PillButton
              size="sm"
              variant={includeNarration ? "primary" : "ghost"}
              onClick={() => setIncludeNarration((value) => !value)}
            >
              {includeNarration ? t("chat.withNarration") : t("chat.withoutNarration")}
            </PillButton>
            <PillButton
              size="sm"
              variant={includeOoc ? "primary" : "ghost"}
              onClick={() => setIncludeOoc((value) => !value)}
            >
              {includeOoc ? t("chat.withOoc") : t("chat.withoutOoc")}
            </PillButton>
          </div>
          <PillButton variant="primary" block disabled={exporting} onClick={() => void exportEpub()}>
            {exporting ? t("chat.generating") : t("chat.buildDownload")}
          </PillButton>
      </Sheet>

      {/* 公告抽屉挂在屏幕根部，不套在「更多」里，否则会跟着抽屉一起定位 */}
      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
    </div>
  );
}

function TocPanel({ items, onPick }: { items: TocItem[]; onPick: (id: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((item) => (
        <li key={item.id} className="shrink-0">
          <button
            type="button"
            onClick={() => onPick(item.id)}
            aria-label={item.text}
            className="flex w-full items-baseline gap-2 border-0 bg-transparent px-3 py-1.5 text-left"
          >
            <span className="shrink-0 font-mono text-[11px] leading-5 text-ink-3">{item.n}</span>
            <span className="min-w-0 max-w-[160px] truncate font-serif text-[13px] leading-5 text-ink-2">
              {item.text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 目录贴在视口左缘，不占布局宽度，因此聊天始终居中。
 * 左缘常驻一根把手：桌面端指针靠近左缘就滑出来，移开收回；
 * 触屏没有指针，点把手（或左滑、双击左半屏）把它叫出来。
 */
function TocStrip({
  items,
  onPick,
  open,
  openLabel,
  closeLabel,
  onOpen,
  onClose,
}: {
  items: TocItem[];
  onPick: (id: string) => void;
  open: boolean;
  openLabel: string;
  closeLabel: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  /** 上一次按在把手上的是什么指针，用来区分鼠标点击和触摸点按 */
  const pointerKindRef = useRef("");
  const shown = hovered || open;

  /* 靠近左缘就展开。用 window 上的 mousemove 判断，而不是靠一小块热区的
     pointerenter：热区太窄，指针正好停在边上、或者只是轻微移动时不会触发。 */
  useEffect(() => {
    const wide = window.matchMedia("(hover: hover) and (min-width: 768px)");
    const apply = (next: boolean) => {
      if (hoveredRef.current === next) return;
      hoveredRef.current = next;
      setHovered(next);
    };
    const onMove = (event: MouseEvent) => {
      if (!wide.matches) {
        apply(false);
        return;
      }
      const right = panelRef.current?.getBoundingClientRect().right ?? 0;
      const staying = hoveredRef.current && event.clientX <= right + 16;
      apply(event.clientX <= 32 || staying);
    };
    const onLeave = () => apply(false);
    const onChange = () => {
      if (!wide.matches) apply(false);
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    wide.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      wide.removeEventListener("change", onChange);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    /* 整条容器不吃指针事件：它盖住左缘 260px，否则顶栏的头像按钮点不动。
       只有把手和展开后的面板各自打开自己的命中区。 */
    <div
      className="fixed inset-y-0 left-0 z-40 flex w-[260px] items-center"
      style={{ pointerEvents: "none" }}
    >
      {/* 把手：看得见才找得到。触屏上它就是开关，桌面端悬停已经展开，点了不额外做事 */}
      <button
        type="button"
        aria-label={openLabel}
        aria-expanded={shown}
        style={{ pointerEvents: "auto" }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          pointerKindRef.current = event.pointerType;
        }}
        onClick={(event) => {
          // 鼠标交给悬停；键盘激活的 click 不带指针（detail 为 0）。
          // 用 click 而不是 pointerdown：手指按在把手上滚动时不该把目录叫出来。
          if (event.detail !== 0 && pointerKindRef.current === "mouse") return;
          if (open) onClose();
          else onOpen();
        }}
        className="group/handle flex h-16 w-5 shrink-0 items-center justify-start border-0 bg-transparent p-0"
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-11 w-[3px] rounded-pill transition-colors",
            shown ? "bg-ink-2" : "bg-line-strong group-hover/handle:bg-ink-3",
          )}
        />
      </button>
      <nav
        ref={panelRef}
        className="max-h-[70dvh] overflow-y-auto overscroll-contain py-2 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? "translate3d(0,0,0)" : "translate3d(-12px,0,0)",
          pointerEvents: shown ? "auto" : "none",
        }}
        aria-hidden={!shown}
      >
        <TocPanel items={items} onPick={onPick} />
      </nav>
      {/* 窄屏没有指针悬停：面板之外点一下就收起，同时把页面压暗以保证可读 */}
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        aria-hidden={!open}
        className="fixed inset-0 -z-10 border-0 bg-veil p-0 transition-opacity duration-200 motion-reduce:transition-none md:hidden"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      />
    </div>
  );
}
