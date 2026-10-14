"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActPill,
  CgCard,
  CgLoading,
  ChatColumn,
  ChatScroll,
  Composer,
  DialogueBlock,
  MenuRow,
  MessageActions,
  NarratorBlock,
  PlayerBubble,
  SceneEvent,
  Sheet,
  SuggestChip,
  SuggestRow,
  TopBar,
  TypingCursor,
  Veil,
} from "@/components/ui";
import { IconDownload, IconImage } from "@/components/icons";
import { hashSeed } from "@/lib/seed";
import { parseBlocks, type MessageBlock } from "@/lib/blocks";
import { buildSuggestionMessages, parseSuggestions } from "@/lib/suggest";
import { openingGreetings } from "@/lib/cards/greetings";
import type { CharacterCardData } from "@/lib/cards/types";
import type { ChatMessage } from "@/lib/prompt/types";
import type { KeyFacts, RollingSummary } from "@/lib/prompt/types";
import { isConfigured, isImageConfigured, type ProviderConfig } from "@/lib/providers/settings";
import { createId, createSession, getSessionStore, loadCardMemory, saveCardMemory } from "@/lib/storage";
import type { ChatSession, StoredCg, StoredMessage } from "@/lib/storage";
import {
  allowAutoCg,
  extractAppearance,
  sceneKey,
  sceneText,
  scoreAllows,
  styleLabel,
} from "@/lib/image";
import { decodeSseBuffer, readSseText } from "@/lib/wire";
import { Avatar } from "./Avatar";

interface Turn {
  id: string;
  role: "user" | "assistant";
  /** 保留块标记的原始文本 */
  content: string;
  cg?: StoredCg;
  swipes?: string[];
  swipeIndex?: number;
  chapterBreak?: boolean;
}

interface ChatError {
  status: number;
  code: string;
  message: string;
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
function userTurnsAsMessages(_turn: Turn, text: string): ChatMessage[] {
  return [{ role: "user", content: markPlayer(text) }];
}

/**
 * 一条回复可能由多个块组成，逐块渲染，块间距交给 ChatColumn 的 gap。
 *
 * 四类块的渲染差异就在这个函数里：
 * narr 无头像无名牌无背景，与对白共用同一文字栏和同一套文字样式；
 * dlg 带圆形头像与姓名；player 走右侧气泡；scene 是居中中性胶囊。
 */
function AssistantTurn({
  content,
  streaming,
  cardName,
  actions,
}: {
  content: string;
  streaming: boolean;
  cardName: string;
  actions?: ReactNode;
}) {
  const blocks: MessageBlock[] = parseBlocks(content);
  const lastIsDialogue =
    blocks.length > 0 && blocks[blocks.length - 1].kind === "dlg";

  if (blocks.length === 0) {
    return (
      <NarratorBlock>
        <p className="text-ink-3">
          {streaming ? "正在组织语言" : "（没有内容）"}
          {streaming ? <TypingCursor /> : null}
        </p>
      </NarratorBlock>
    );
  }

  return (
    <>
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const cursor = streaming && isLast ? <TypingCursor /> : null;
        // 操作按钮只贴在最后一块上；对白块内联，其余块追加在末尾
        const slot = isLast && lastIsDialogue ? actions : undefined;
        const key = `${index}-${block.kind}`;

        if (block.kind === "narr") {
          return (
            <NarratorBlock key={key}>
              <p>
                {block.text}
                {cursor}
              </p>
            </NarratorBlock>
          );
        }

        if (block.kind === "scene") {
          return (
            <SceneEvent key={key}>
              {block.text}
              {cursor}
            </SceneEvent>
          );
        }

        if (block.kind === "player") {
          // 模型不该产出 player 块，真出现了也按玩家气泡渲染，别混进对白
          return (
            <PlayerBubble key={key}>
              {block.text}
              {cursor}
            </PlayerBubble>
          );
        }

        const who = block.who ?? cardName;
        return (
          <DialogueBlock
            key={key}
            who={who}
            avatar={<Avatar name={who} />}
            actions={slot}
          >
            <p>
              {block.text}
              {cursor}
            </p>
          </DialogueBlock>
        );
      })}
      {/* 末块不是对白时按钮追加在末尾，缩进 48 与旁白、对白正文对齐 */}
      {!lastIsDialogue ? <div className="ml-12">{actions}</div> : null}
    </>
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
  const greetings = useMemo(() => openingGreetings(card), [card]);
  const [greetingIndex, setGreetingIndex] = useState(0);
  /** 建议输入由模型看着当前对话现生成，不写死在卡里 */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: "opening", role: "assistant", content: greetings[0] ?? card.first_mes },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [memory, setMemory] = useState<string | null>(null);
  const [cgBusy, setCgBusy] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const cgBusyRef = useRef<string | null>(null);
  /** 重新生成时留下的旧回复。新回复落地后成为最后一条 swipe，失败则原样放回去。 */
  const carrySwipesRef = useRef<string[] | null>(null);
  const carryTurnRef = useRef<Turn | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
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
  /** 长期记忆是否已经灌进来。没灌完就发请求会丢掉前面的剧情。 */
  const memoryReadyRef = useRef(false);

  const ready = isConfigured(config);

  /** 还没说过话时，操作按钮的文案是「换一条开场」而不是「重新生成」 */
  /**
   * 压一次历史。独立端点，不占对话流的首字时间。
   * 只总结 coveredIndex 之后的新增部分，再把结果挂到旧摘要后面，
   * 整段重写会让旧细节一层层丢掉，那就是漂移。
   */
  async function summarizeNow(allTurns: Turn[]) {
    if (!ready || summarizingRef.current) return;
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
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          providerId: config.providerId,
          model: config.model,
          ...(config.baseURL.trim() ? { baseURL: config.baseURL.trim() } : {}),
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
      if (!ready || suggestingRef.current) return;
      const messages = buildSuggestionMessages(
        history.map((turn) => ({ role: turn.role, content: turn.content })),
      );

      suggestingRef.current = true;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            mode: "complete",
            providerId: config.providerId,
            model: config.model,
            messages,
            temperature: SUGGESTION_TEMPERATURE,
            maxTokens: SUGGESTION_MAX_TOKENS,
            ...(config.baseURL.trim() ? { baseURL: config.baseURL.trim() } : {}),
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
    [ready, config],
  );

  // 恢复这张卡上次的会话与长期记忆；没有就从开场白建一个。
  // ChatScreen 以卡 id 为 key 挂载，换角色即重跑这一段。
  // 只在异步回调里 setState，不在 effect 体内同步 setState。
  useEffect(() => {
    let cancelled = false;
    const store = getSessionStore();

    void (async () => {
      // 长期记忆必须先到位，否则第一轮的提示词里没有上次的剧情
      const memory = await loadCardMemory(cardId);
      if (cancelled) return;
      summaryRef.current = memory.summary;
      factsRef.current = memory.facts;
      turnRef.current = memory.turn;
      memoryReadyRef.current = true;

      const sessions = await store.list();
      if (cancelled) return;

      const existing = sessions.find((s) => s.cardId === cardId);
      if (existing) {
        sessionRef.current = existing;
        setTurns(
          existing.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            cg: m.cg,
            swipes: m.swipes,
            swipeIndex: m.swipeIndex,
            chapterBreak: m.chapterBreak,
          })),
        );
        return;
      }

      const created = createSession({
        cardId,
        cardName: card.name,
        opening: greetings[0] ?? card.first_mes,
      });
      sessionRef.current = created;
      await store.save(created);
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId, card.name, card.first_mes, greetings]);

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
    }));

    const updated: ChatSession = { ...session, messages, updatedAt: Date.now() };
    sessionRef.current = updated;
    void getSessionStore().save(updated);
  }

  /**
   * 跑一轮：baseTurns 是「不含本轮玩家输入」的历史，
   * 函数自己把玩家这一轮和 assistant 占位追加进去。
   *
   * 组装在服务端做，这里只发原料（角色卡、世界书、历史、摘要、事实），
   * 浏览器不碰提示词结构。
   */
  async function runTurn(userMessage: string, baseTurns: Turn[]) {
    setError(null);
    needsSummarizeRef.current = false;

    const userTurn: Turn = {
      id: createId(),
      role: "user",
      content: markPlayer(userMessage),
    };
    const assistantId = createId();

    // 历史 = 之前所有轮 + 本轮玩家输入，服务端据此组装
    const history: ChatMessage[] = [
      ...baseTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      ...userTurnsAsMessages(userTurn, userMessage),
    ];

    setTurns((prev) => [
      ...prev,
      userTurn,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setStreaming(true);
    setSuggestions([]);

    const controller = new AbortController();
    abortRef.current = controller;

    let replyText = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key 走请求头，绝不进 URL
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          providerId: config.providerId,
          model: config.model,
          temperature: config.temperature,
          ...(config.baseURL.trim() ? { baseURL: config.baseURL.trim() } : {}),
          sessionId,
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
            message: `请求失败（HTTP ${response.status}）`,
          },
        });
      }

      if (!response.body) {
        throw Object.assign(new Error("no body"), {
          chatError: { status: 502, code: "no_body", message: "没有收到响应流" },
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

        for (const frame of frames) {
          if (frame === "[DONE]") continue;

          if (frame.type === "delta") {
            replyText += frame.text;
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId
                  ? { ...turn, content: turn.content + frame.text }
                  : turn,
              ),
            );
          } else if (frame.type === "meta") {
            setMemory(`${Math.round((frame.used / Math.max(frame.max, 1)) * 100)}%`);
            needsSummarizeRef.current = frame.needsSummarize;
          } else if (frame.type === "error") {
            setError({ status: 502, code: "stream", message: frame.message });
          }
        }
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        // 主动停止，不算错误，已经吐出来的内容保留
      } else {
        const chatError = (caught as { chatError?: ChatError }).chatError;
        setError(
          chatError ?? {
            status: 0,
            code: "network",
            message: "网络请求失败，检查连接后重试",
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
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    if (config.image.apiKey.trim()) headers["x-image-key"] = config.image.apiKey.trim();
    const response = await fetch("/api/image", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: config.providerId,
        model: config.model,
        ...(config.baseURL.trim() ? { baseURL: config.baseURL.trim() } : {}),
        imageModel: config.image.model.trim(),
        imageProviderId: config.providerId,
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
          message: `生图失败（HTTP ${response.status}）`,
        }
      );
    }
    return payload ?? {};
  }

  /** 出图不占对话的 streaming 状态，所以打字和发送都不会被它卡住。 */
  async function generateFor(turn: Turn, source: "manual" | "auto") {
    if (!isImageConfigured(config) || cgBusyRef.current) return;
    cgBusyRef.current = turn.id;
    setCgBusy(turn.id);
    try {
      const payload = await postImage({ action: "generate", scene: sceneText(turn.content) });
      if (!payload.src || !payload.prompt) {
        throw { status: 502, code: "empty_image", message: "没有收到图片" };
      }
      const cg: StoredCg = {
        id: createId(),
        prompt: payload.prompt,
        src: payload.src,
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
      if (source === "manual") {
        const info = caught as ChatError;
        setError(
          info?.message
            ? info
            : { status: 0, code: "image", message: "生图失败" },
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
    } catch {
      // 自动失败不影响对话，也不弹错误
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

  function send(text: string) {
    const userMessage = text.trim();
    if (!userMessage || streaming) return;
    carrySwipesRef.current = null;
    carryTurnRef.current = null;
    setInput("");
    setSuggestions([]);
    void runTurn(userMessage, turns);
  }

  /** 开场白换一条：在 first_mes 与 alternate_greetings 之间轮换。 */
  function cycleGreeting() {
    if (greetings.length <= 1) return;
    const next = (greetingIndex + 1) % greetings.length;
    setGreetingIndex(next);
    const nextTurns: Turn[] = [
      { id: "opening", role: "assistant", content: greetings[next] },
    ];
    setTurns(nextTurns);
    persist(nextTurns);
  }

  function regenerate() {
    if (streaming) return;
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
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") {
      carrySwipesRef.current = last.swipes?.length ? [...last.swipes] : [last.content];
      carryTurnRef.current = last;
    }
    setTurns(base);
    void runTurn(userText, base.slice(0, userIndex));
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
        message: caught instanceof Error ? caught.message : "导出失败",
      });
    } finally {
      setExporting(false);
    }
  }

  const imageReady = isImageConfigured(config);
  const lastAssistant = [...turns].reverse().find((turn) => turn.role === "assistant");

  return (
    <div className="relative flex h-dvh flex-col bg-background">
      <TopBar
        avatar={<Avatar name={card.name} />}
        name={card.name}
        subtitle={card.tags?.join(" · ")}
        memoryPercent={memory ?? "…"}
        onWho={onOpenShelf}
        onSettings={onOpenSettings}
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
          {turns.map((turn, index) => {
            if (turn.role === "user") {
              return (
                <PlayerBubble key={turn.id}>{playerText(turn.content)}</PlayerBubble>
              );
            }

            const isLastTurn = index === turns.length - 1;
            const actions = !streaming ? (
              <MessageActions>
                {isLastTurn ? (
                  <ActPill hot onClick={regenerate}>
                    {turns.length <= 1 ? "换一条开场" : "重新生成"}
                  </ActPill>
                ) : null}
                {turn.swipes && turn.swipes.length > 1 ? (
                  <>
                    <ActPill onClick={() => switchSwipe(turn, -1)}>上一条</ActPill>
                    <ActPill onClick={() => switchSwipe(turn, 1)}>
                      {(turn.swipeIndex ?? turn.swipes.length - 1) + 1}/{turn.swipes.length}
                    </ActPill>
                  </>
                ) : null}
                <ActPill onClick={() => toggleChapter(turn)}>
                  {turn.chapterBreak ? "取消分章" : "在这里分章"}
                </ActPill>
                {isLastTurn ? (
                  <ActPill
                    disabled={!imageReady || cgBusy === turn.id}
                    title={imageReady ? "用当前场景出一张 CG" : "未配置生图模型"}
                    onClick={() => void generateFor(turn, "manual")}
                  >
                    {imageReady ? "生成当前场景 CG" : "生成 CG · 未配置生图模型"}
                  </ActPill>
                ) : null}
              </MessageActions>
            ) : undefined;

            return (
              <Fragment key={turn.id}>
                <AssistantTurn
                  content={turn.content}
                  streaming={streaming && isLastTurn}
                  cardName={card.name}
                  actions={actions}
                />
                {cgBusy === turn.id ? (
                  <CgLoading />
                ) : turn.cg ? (
                  <div>
                    <CgCard
                      src={turn.cg.src}
                      alt={turn.cg.prompt}
                      caption={`${styleLabel(config.image.styleId)} · ${turn.cg.source === "auto" ? "自动" : "手动"}`}
                      icon={<IconImage className="size-3.5" />}
                    />
                    <MessageActions>
                      <ActPill onClick={() => void generateFor(turn, "manual")}>重新生成</ActPill>
                      <ActPill onClick={() => downloadCg(turn.cg!)}>保存</ActPill>
                    </MessageActions>
                  </div>
                ) : null}
                {/*
                  建议输入挂在最后一条回复下面，跟着对话一起滚，
                  不占输入框上方那块空间。选一条就发，发完这批就消失。
                */}
                {isLastTurn && !streaming && suggestions.length > 0 ? (
                  <SuggestRow className="!px-0">
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
                打开连接设置
              </button>
            ) : null}
          </div>
        ) : null}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => send(input)}
          onPlus={() => setPlusOpen(true)}
          placeholder={`对${card.name}说……`}
          hint={
            streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="underline"
              >
                正在生成，点击停止
              </button>
            ) : !ready ? (
              <button type="button" onClick={onOpenSettings} className="underline">
                还没填 Key，点这里去连接设置
              </button>
            ) : (
              "Enter 发送，Shift + Enter 换行"
            )
          }
        />
      </div>

      <Veil open={plusOpen} onClose={() => setPlusOpen(false)} />
      <Sheet open={plusOpen} title="更多">
        <MenuRow
          icon={<IconImage className="size-[17px]" />}
          disabled={!imageReady || !lastAssistant || cgBusy !== null}
          note={imageReady ? "当前场景" : "未配置生图模型"}
          onClick={() => {
            if (!lastAssistant) return;
            setPlusOpen(false);
            void generateFor(lastAssistant, "manual");
          }}
        >
          生成当前场景 CG
        </MenuRow>
        <MenuRow
          icon={<IconDownload className="size-[17px]" />}
          note="只导出"
          onClick={() => {
            setPlusOpen(false);
            setExportOpen(true);
          }}
        >
          导出 EPUB
        </MenuRow>
      </Sheet>

      <Veil open={exportOpen} onClose={() => setExportOpen(false)} />
      <Sheet open={exportOpen} title="导出 EPUB">
        <div className="mb-4 flex flex-wrap gap-2">
          <ActPill hot={includeNarration} onClick={() => setIncludeNarration((value) => !value)}>
            {includeNarration ? "包含旁白" : "不含旁白"}
          </ActPill>
          <ActPill hot={includeOoc} onClick={() => setIncludeOoc((value) => !value)}>
            {includeOoc ? "包含 OOC" : "不含 OOC"}
          </ActPill>
        </div>
        <MenuRow
          icon={<IconDownload className="size-[17px]" />}
          disabled={exporting}
          note={exporting ? "正在生成" : "下载"}
          onClick={() => void exportEpub()}
        >
          生成并下载
        </MenuRow>
      </Sheet>
    </div>
  );
}
