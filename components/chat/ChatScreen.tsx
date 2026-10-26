"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  Field,
  FieldInput,
  IconButton,
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
import { IconBookmark, IconBranch, IconCheck, IconCopy, IconEdit, IconImage, IconMap, IconRefresh } from "@/components/icons";
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";
import { AndroidStatus } from "./AndroidStatus";
import { hasNativeFilePicker, isAndroidApp, pickNativeFile } from "@/lib/storage/native";
import { cn } from "@/components/ui/cn";
import { hashSeed } from "@/lib/seed";
import {
  dialogueContinues,
  parseBlocks,
} from "@/lib/blocks";
import { commitTurn } from "@/lib/engine/history";
import {
  devFlagServerSnapshot,
  devReportEnabled,
  recordInspector,
  subscribeDevFlag,
} from "@/lib/engine/dev-log";
import { DevReportButton, DevReportPanel } from "./DevReportPanel";
import { buildSuggestionMessages, parseSuggestions } from "@/lib/suggest";
import { DICE_TOOL } from "@/lib/dice";
import { GLOBAL_LOREBOOK, estimateTokens, summarizeThresholdFor, type LorebookTimingState, type WorldBook } from "@/lib/prompt";
import {
  applyMemoryWrite,
  emptyJournal,
  MEMORY_TOOLS,
  normalizeJournal,
  putPortrait,
  type Journal,
  type MemoryConflict,
  type ToolTrace,
} from "@/lib/memory/journal";
import {
  applyScenePatch,
  emptySceneState,
  isEmptySceneState,
  normalizeSceneState,
  type ScenePatch,
  type SceneState,
} from "@/lib/scene";
import {
  applyThreadPatch,
  normalizeThreads,
  type StoryThread,
  type ThreadPatchEntry,
} from "@/lib/story";
import { adaptGreeting } from "@/lib/cards/builder-opening";
import { markMacroText, resolveBlockMacroSegments, type MacroMarkdownMarker } from "./message-macros";
import type { MacroVars } from "@/lib/prompt";
import { openingGreetings } from "@/lib/cards/greetings";
import type { CharacterCardData } from "@/lib/cards/types";
import type { ChatMessage } from "@/lib/prompt/types";
import type { KeyFacts, RollingSummary } from "@/lib/prompt/types";
import {
  appendToBranch,
  createBranch,
  describeBranch,
  mainBranch,
  normalizeTree,
  planRegenerate,
  regenerateNote,
  removeBranch,
  reportStale,
  resolveBranch,
  MAIN_BRANCH,
  encodeRandomUserWords,
  absorbToolCall,
  historyContent,
  markPlayer,
  playerText,
  userTurnsAsMessages,
  type BranchTree,
  type ChatBranch,
  type ChatError,
  type PendingTool,
  type StaleReport,
  type Turn,
} from "@/lib/chat";
import { presetChat } from "@/lib/providers/config";
import { resolveBaseURL } from "@/lib/providers/validate";
import {
  canSend,
  imageProviderId,
  isConfigured,
  isImageConfigured,
  usesBrowserModel,
  needsServerAdapter,
  type ProviderConfig,
  defaultStorySystemSettings,
  normalizeUserName,
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
import type { MessageKey } from "@/lib/i18n";
import { persistGeneratedImage, readChatImage, shrinkPortrait } from "@/lib/chat-image";
import { normalizeDocument, readChatDocument, type ChatDocument } from "@/lib/chat-document";
import { BROWSER_PROVIDER_ID, describeImage, probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { browserChatEndpoint, streamBrowserOpenAI } from "@/lib/browser-openai";
import {
  applyMacros,
  assemble,
  buildDirectorMessages,
  defaultCost,
  DIRECTOR_MAX_TOKENS,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_RESPONSE_TOKENS,
  formatTurnPlan,
  insertBeforeCurrentUser,
  parseTurnPlan,
  planBudget,
  shouldPlanTurn,
  withExtraMessage,
  type PromptInspector,
  type TurnPlan,
} from "@/lib/prompt";
import type { ResponseMode } from "@/lib/prompt";
import { cardPortraitUrl } from "@/lib/cards/online";
import { AnnouncementBell, AnnouncementDialog } from "./Announcements";
import { Avatar } from "./Avatar";
import { CodexAttachmentView, MapAttachmentView, useAttachmentWorkspaceMode } from "./attachments";
import {
  ATTACHMENT_TOOLS,
  ATTACHMENT_TOOL_NAMES,
  executeAttachmentTool,
  generateMap,
  isResolvedMapGeneration,
  normalizeAttachments,
  resolveMapGeneration,
  type CardAttachment,
  type CodexAttachment,
  type GeneratedMap,
  type MapAttachment,
  type ResolvedMapGeneration,
} from "@/lib/attachments";

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

interface AttachmentRuntime {
  attachments: CardAttachment[];
  state: Record<string, unknown>;
  maps: Record<string, GeneratedMap>;
}

function mapAttachmentsOf(attachments: CardAttachment[] | undefined): MapAttachment[] {
  return (attachments ?? []).filter(
    (attachment): attachment is MapAttachment => attachment.kind === "map" && attachment.enabled !== false,
  );
}

function codexAttachmentsOf(attachments: CardAttachment[] | undefined): CodexAttachment[] {
  return (attachments ?? []).filter(
    (attachment): attachment is CodexAttachment => attachment.kind === "codex" && attachment.enabled !== false,
  );
}

function isMapAttachment(value: CardAttachment | undefined): value is MapAttachment {
  return value?.kind === "map" && "generation" in value;
}

function isCodexAttachment(value: CardAttachment | undefined): value is CodexAttachment {
  return value?.kind === "codex" && "entries" in value;
}

function attachmentRuntime(
  attachments: CardAttachment[] | undefined,
  storedState: Record<string, unknown> | undefined,
  startSeed: string,
): AttachmentRuntime {
  const baseAttachments = normalizeAttachments(attachments);
  const storedOverride = Array.isArray(storedState?.attachmentOverrides)
    ? normalizeAttachments(storedState.attachmentOverrides)
    : undefined;
  const overrideById = new Map((storedOverride ?? []).map((attachment) => [attachment.id, attachment]));
  const runtimeAttachments = baseAttachments.map((attachment) => overrideById.get(attachment.id) ?? attachment);
  const storedGenerations = storedState?.mapGenerations;
  const generations: Record<string, ResolvedMapGeneration> = {};
  const maps: Record<string, GeneratedMap> = {};

  for (const attachment of mapAttachmentsOf(runtimeAttachments)) {
    const stored = storedGenerations && typeof storedGenerations === "object"
      ? (storedGenerations as Record<string, unknown>)[attachment.id]
      : undefined;
    let resolved: ResolvedMapGeneration;
    if (isResolvedMapGeneration(stored)) {
      const candidate = resolveMapGeneration(attachment.generation, stored.startSeed || startSeed);
      resolved = candidate.fingerprint === stored.fingerprint ? stored : candidate;
    } else {
      resolved = resolveMapGeneration(attachment.generation, startSeed);
    }
    generations[attachment.id] = resolved;
    maps[attachment.id] = generateMap(resolved);
  }

  return {
    attachments: runtimeAttachments,
    state: {
      ...(storedState ?? {}),
      ...(storedOverride ? { attachmentOverrides: runtimeAttachments } : {}),
      mapGenerations: generations,
    },
    maps,
  };
}

type ComposerAttachment =
  | { kind: "image"; src: string }
  | { kind: "document"; name: string; text: string };

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

const SUGGESTION_TEMPERATURE = 0.8;
const SUGGESTION_MAX_TOKENS = 160;

/**
 * 旧存档里的聊天世界书补全。
 *
 * 只留能用的条目：有内容、触发词或常驻二者之一。坏条目丢掉而不是让整本书失效，
 * 一本世界书里有一条坏数据不该拖垮其余设定。
 */
function normalizeChatBook(value: WorldBook | undefined): WorldBook | undefined {
  const entries = (value?.entries ?? []).filter(
    (entry) =>
      entry &&
      typeof entry.content === "string" &&
      entry.content.trim().length > 0 &&
      (entry.constant === true || (Array.isArray(entry.keys) && entry.keys.length > 0)),
  );
  if (entries.length === 0) return undefined;
  return {
    ...(value?.name ? { name: value.name } : {}),
    entries,
    ...(typeof value?.scanDepth === "number" ? { scanDepth: value.scanDepth } : {}),
    ...(typeof value?.budgetCap === "number" ? { budgetCap: value.budgetCap } : {}),
    ...(typeof value?.tokenCap === "number" ? { tokenCap: value.tokenCap } : {}),
    ...(value?.recursiveScan === true ? { recursiveScan: true } : {}),
  };
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
  macroVars,
  streaming,
  cardName,
  portraitUrl,
  portraits,
  actions,
  stage,
  receivedCount,
  onMacroClick,
}: {
  content: string;
  macroVars: MacroVars;
  streaming: boolean;
  cardName: string;
  /** 这张卡的立绘地址。没有就不画头像槽 */
  portraitUrl?: string | null;
  /** 生成出来的配角头像，按 who 的名字取 */
  portraits?: Record<string, string>;
  actions?: ReactNode;
  stage?: GenerationStage;
  /** 当前阶段实时已接收的 token 估算，缀在阶段提示右侧 */
  receivedCount?: number;
  onMacroClick?: (macro: MacroMarkdownMarker) => void;
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
  const parsedBlocks = useMemo(() => parseBlocks(content), [content]);
  const blocks = useMemo(() => resolveBlockMacroSegments(parsedBlocks, macroVars), [parsedBlocks, macroVars]);
  const lastIsDialogue = blocks.length > 0 && blocks[blocks.length - 1].kind === "dlg";
  const continuedFlags = useMemo(
    () => blocks.map((_, index) => dialogueContinues(blocks, index, cardName)),
    [blocks, cardName],
  );

  if (blocks.length === 0) {
    return (
      <NarratorBlock>
        {streaming && stageText ? (
          <TaskBrief key={stage} title={stageText.title} count={receivedCount} />
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
          <TaskBrief key={stage} title={stageText.title} count={receivedCount} />
        </div>
      ) : null}
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const cursor = streaming && isLast ? <TypingCursor /> : null;
        // 操作按钮只贴在最后一块上；对白块内联，其余块追加在末尾
        const slot = isLast && lastIsDialogue ? actions : undefined;
        const key = `${index}-${block.kind}`;
        const marked = markMacroText(block.macroSegments);

        if (block.kind === "narr") {
          return (
            <NarratorBlock key={key}>
              <MarkdownText
                text={marked.text}
                macroMarkers={marked.markers}
                onMacroClick={onMacroClick}
              />
              {cursor}
            </NarratorBlock>
          );
        }

        if (block.kind === "act") {
          return (
            <ActionBlock key={key}>
              <MarkdownText
                text={marked.text}
                macroMarkers={marked.markers}
                onMacroClick={onMacroClick}
              />
              {cursor}
            </ActionBlock>
          );
        }

        if (block.kind === "scene") {
          return (
            <SceneEvent key={key}>
              <MarkdownText
                text={marked.text}
                macroMarkers={marked.markers}
                onMacroClick={onMacroClick}
              />
              {cursor}
            </SceneEvent>
          );
        }

        if (block.kind === "player") {
          // 模型不该产出 player 块，真出现了也按玩家气泡渲染，别混进对白
          return (
            <PlayerBubble key={key}>
              <MarkdownText
                tone="bubble"
                text={marked.text}
                macroMarkers={marked.markers}
                onMacroClick={onMacroClick}
              />
              {cursor}
            </PlayerBubble>
          );
        }

        const who = (block.who ?? cardName).trim() || cardName;
        const src =
          who === cardName
            ? portraitUrl
            : Object.entries(portraits ?? {}).find(([name]) => name.toLocaleLowerCase() === who.toLocaleLowerCase())?.[1];
        return (
          <DialogueBlock
            key={key}
            who={who}
            avatar={<Avatar name={who} src={src} />}
            continued={continuedFlags[index]}
            actions={slot}
          >
            <MarkdownText
              text={marked.text}
              macroMarkers={marked.markers}
              onMacroClick={onMacroClick}
            />
            {cursor}
          </DialogueBlock>
        );
      })}
      {/* 末块不是对白时按钮追加在末尾，缩进 48 与旁白、对白正文对齐 */}
      {!lastIsDialogue ? <div className="ml-12">{actions}</div> : null}
    </div>
  );
}

function macroPropertyKey(name: string): MessageKey {
  switch (name) {
    case "user": return "chat.macroProperty.user";
    case "char": return "chat.macroProperty.char";
    case "group":
    case "groupnotmuted":
    case "charifnotgroup":
    case "notchar": return "chat.macroProperty.group";
    case "description": return "chat.macroProperty.description";
    case "personality": return "chat.macroProperty.personality";
    case "scenario": return "chat.macroProperty.scenario";
    case "persona": return "chat.macroProperty.persona";
    case "charprompt": return "chat.macroProperty.charprompt";
    case "charinstruction": return "chat.macroProperty.charinstruction";
    case "chardepthprompt": return "chat.macroProperty.chardepthprompt";
    case "charcreatornotes": return "chat.macroProperty.charcreatornotes";
    case "charversion": return "chat.macroProperty.charversion";
    case "mesexamplesraw":
    case "mesexamples": return "chat.macroProperty.mesexamples";
    case "charfirstmessage": return "chat.macroProperty.charfirstmessage";
    case "authorsnote":
    case "charauthorsnote": return "chat.macroProperty.authorsnote";
    case "original": return "chat.macroProperty.original";
    case "summary": return "chat.macroProperty.summary";
    case "input": return "chat.macroProperty.input";
    case "lastmessageid": return "chat.macroProperty.lastmessageid";
    case "lastmessage": return "chat.macroProperty.lastmessage";
    case "lastusermessage": return "chat.macroProperty.lastusermessage";
    case "lastcharmessage": return "chat.macroProperty.lastcharmessage";
    default: return "chat.macroProperty.unknown";
  }
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

function MessageIconButton({
  label,
  onClick,
  children,
  hot = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  hot?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink disabled:cursor-default disabled:opacity-45 ${hot ? "text-act" : ""}`}
    >
      {children}
    </button>
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
  onUserNameChange,
}: {
  cardId: string;
  card: CharacterCardData;
  config: ProviderConfig;
  userName?: string;
  style?: "haruhi" | "mushoku";
  onOpenSettings: () => void;
  onOpenShelf: () => void;
  onUserNameChange?: (next: string) => void;
}) {
  const { t, locale } = useI18n();
  const androidApp = useSyncExternalStore(() => () => {}, isAndroidApp, () => false);
  const storySystems = config.storySystems ?? defaultStorySystemSettings();
  // Anthropic Messages / OpenAI Responses 没有浏览器直连实现，统一走服务端适配器。
  const serverOnlyInterface = needsServerAdapter(config);
  const [macroInfo, setMacroInfo] = useState<MacroMarkdownMarker | null>(null);
  const [userNameEditOpen, setUserNameEditOpen] = useState(false);
  const [userNameDraft, setUserNameDraft] = useState(userName);

  function openUserNameEditor(): void {
    setMacroInfo(null);
    setUserNameDraft(userName);
    setUserNameEditOpen(true);
  }

  function saveUserName(): void {
    onUserNameChange?.(normalizeUserName(userNameDraft));
    setUserNameEditOpen(false);
  }

  const greetings = useMemo(
    () =>
      openingGreetings(card).map((text) => adaptGreeting(text, locale)),
    [card, locale],
  );
  const [greetingIndex, setGreetingIndex] = useState(0);
  /** 建议输入由模型看着当前对话现生成，不写死在卡里 */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: "opening", role: "assistant", content: greetings[0] ?? card.first_mes },
  ]);
  const macroVars = useMemo(() => ({
    char: card.name,
    user: userName,
    card,
    history: turns,
  }), [card, userName, turns]);
  const [composerReset, setComposerReset] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage | null>(null);
  /** 当前阶段实时已接收的 token 估算值，随每个流式增量更新，进阶段即清零。 */
  const [receivedTokens, setReceivedTokens] = useState(0);
  /**
   * Phase 0 的观测开关。开发模式默认开，也可以在 URL 上加 ?dev=1 打开，
   * 这样对着预览部署也能看真实模型的表现。生产环境不带这个参数时全程不计算、不记录。
   *
   * 用 useSyncExternalStore 而不是 state + effect：它只由 NODE_ENV 和 URL 决定，
   * 本来就不该进 React 状态，服务端快照固定 false 也不会和水合结果打架。
   */
  const devEnabled = useSyncExternalStore(subscribeDevFlag, devReportEnabled, devFlagServerSnapshot);
  const [devOpen, setDevOpen] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [cgBusy, setCgBusy] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const cardAttachments = useMemo(() => card.attachments ?? [], [card.attachments]);
  const [runtimeAttachments, setRuntimeAttachments] = useState<CardAttachment[]>(cardAttachments);
  const runtimeAttachmentsRef = useRef<CardAttachment[]>(cardAttachments);
  const generatedMapsRef = useRef<Record<string, GeneratedMap>>({});
  const mapAttachments = useMemo(() => mapAttachmentsOf(runtimeAttachments), [runtimeAttachments]);
  const codexAttachments = useMemo(() => codexAttachmentsOf(runtimeAttachments), [runtimeAttachments]);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [generatedMaps, setGeneratedMaps] = useState<Record<string, GeneratedMap>>({});
  const attachmentStateRef = useRef<Record<string, unknown>>({});
  const attachmentMode = useAttachmentWorkspaceMode(attachmentOpen);
  const visibleAttachments = useMemo<CardAttachment[]>(
    () => [...mapAttachments, ...codexAttachments],
    [codexAttachments, mapAttachments],
  );
  const activeAttachment = visibleAttachments.find((item) => item.id === activeAttachmentId) ?? visibleAttachments[0];
  const activeMapAttachment = isMapAttachment(activeAttachment) ? activeAttachment : undefined;
  const activeCodexAttachment = isCodexAttachment(activeAttachment) ? activeAttachment : undefined;
  const activeMap = activeMapAttachment ? generatedMaps[activeMapAttachment.id] : undefined;
  const attachmentTabs = useMemo(
    () => visibleAttachments.map((item) => ({ id: item.id, label: item.title ?? item.kind })),
    [visibleAttachments],
  );

  function adoptAttachmentRuntime(runtime: AttachmentRuntime): void {
    runtimeAttachmentsRef.current = runtime.attachments;
    generatedMapsRef.current = runtime.maps;
    attachmentStateRef.current = runtime.state;
    setRuntimeAttachments(runtime.attachments);
    setGeneratedMaps(runtime.maps);
  }

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
  /**
   * 编辑之后的「状态可能过时」提示（Phase 11.2）。
   * 只提示，不自动重算：重算要么再叫一次模型，要么本地推——两样都比留着旧值更糟。
   */
  const [staleState, setStaleState] = useState<{ report: StaleReport; editedId: string } | null>(
    null,
  );
  /** 分支（Phase 11.3）。不同选择形成不同剧情线，而不是覆盖原来的故事。 */
  const [branches, setBranches] = useState<ChatBranch[]>([mainBranch()]);
  const [activeBranch, setActiveBranch] = useState<string>(MAIN_BRANCH);
  const [branchOpen, setBranchOpen] = useState(false);
  const branchTreeRef = useRef<BranchTree>({
    branches: [mainBranch()],
    messages: { [MAIN_BRANCH]: [] },
  });
  /**
   * 当前分支的 ref 版。runTurn 是异步的，落地时要读「当时在哪条分支」，
   * 读 state 会拿到闭包里的旧值。
   */
  const activeBranchRef = useRef<string>(MAIN_BRANCH);
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
  /**
   * 场景状态：此刻在哪儿、什么时候、谁在场、正在发生什么。
   *
   * 用 ref 而不是 state：它不直接参与渲染，只在组装提示词和落盘时读，
   * 每轮更新一次。放 state 会让每一轮都多一次全树重渲染。
   */
  const sceneRef = useRef<SceneState>(emptySceneState());
  /**
   * 未完成的剧情线。比场景状态长命：一条线可以跨几十轮才交代完。
   * 和场景状态一样用 ref：只在组装和落盘时读，不直接参与渲染。
   */
  const threadsRef = useRef<StoryThread[]>([]);
  const stagnantTurnsRef = useRef(0);
  /** 这一轮导演给出的状态变化，等这一轮落地之后再应用 */
  const pendingPatchRef = useRef<ScenePatch | null>(null);
  /**
   * 这一轮实际发出去的提示词结构（Phase 10）。
   * 由组装器产出，导演计划拼上之后再补一条；面板读它。
   */
  const inspectorRef = useRef<PromptInspector | null>(null);
  /** 这一轮导演给出的剧情线变化 */
  const pendingThreadsRef = useRef<ThreadPatchEntry[] | null>(null);
  /**
   * 被挡下的记忆冲突（7.3）：模型想改一条已经记下的事，保留旧的、记在这里。
   * 目前只做记录和开发模式日志，界面上的「等玩家确认」是下一步。
   */
  const memoryConflictsRef = useRef<MemoryConflict[]>([]);
  /**
   * 当前聊天专属的世界书（Phase 8）。只影响这一场，重置会话就清空。
   * 和场景状态一样用 ref：只在组装时读。
   */
  const chatBookRef = useRef<WorldBook | undefined>(undefined);
  /** 世界书时效状态（sticky / cooldown / delay）：每轮由组装结果刷新，随会话落盘 */
  const lorebookTimingRef = useRef<LorebookTimingState>({});
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
      .map((turn) => ({ role: turn.role, content: historyContent(turn) }));
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
          interfaceType: config.interfaceType,
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
        history.map((turn) => ({ role: turn.role, content: applyMacros(historyContent(turn), { ...macroVars, history }) })),
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
            interfaceType: config.interfaceType,
            model: chatRoute.model,
            messages,
            temperature: SUGGESTION_TEMPERATURE,
            maxTokens: SUGGESTION_MAX_TOKENS,
            ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
          }),
        });
        if (!response.ok || !response.body) return;

        const list = parseSuggestions(await readSseText(response.body)).map((text) => applyMacros(text, { ...macroVars, history }));
        if (list.length > 0) setSuggestions(list);
      } catch {
        // 建议生成失败不影响对话
      } finally {
        suggestingRef.current = false;
      }
    },
    [config, macroVars, chatRoute.baseURL, chatRoute.model],
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
        const runtime = attachmentRuntime(cardAttachments, existing.attachmentState, existing.id);
        adoptAttachmentRuntime(runtime);
        const restoredSession = { ...existing, attachmentState: runtime.state };
        sessionRef.current = restoredSession;
        if (JSON.stringify(existing.attachmentState ?? {}) !== JSON.stringify(runtime.state)) {
          void store.save(restoredSession);
        }
        sceneRef.current = normalizeSceneState(existing.sceneState);
        threadsRef.current = normalizeThreads(existing.storyThreads);
        chatBookRef.current = normalizeChatBook(existing.chatLorebook);
        lorebookTimingRef.current = existing.lorebookTiming ?? {};
        branchTreeRef.current = normalizeTree(existing.branchTree);
        setBranches(branchTreeRef.current.branches);
        setActiveBranch(existing.activeBranch ?? MAIN_BRANCH);
        activeBranchRef.current = existing.activeBranch ?? MAIN_BRANCH;
        const restored = existing.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          outboundContent: m.outboundContent,
          cg: m.cg,
          image: m.image,
          imageNote: m.imageNote,
          document: normalizeDocument(m.document),
          swipes: m.swipes,
          swipeIndex: m.swipeIndex,
          chapterBreak: m.chapterBreak,
        }));
        setTurns(restored);
        memoryReadyRef.current = true;
        setMemoryReady(true);
        return;
      }

      const created = createSession({
        cardId,
        cardName: card.name,
        opening: greetings[0] ?? card.first_mes,
      });
      const runtime = attachmentRuntime(cardAttachments, undefined, created.id);
      adoptAttachmentRuntime(runtime);
      const createdSession = { ...created, attachmentState: runtime.state };
      sessionRef.current = createdSession;
      await store.save(createdSession);
      memoryReadyRef.current = true;
      setMemoryReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId, card, cardAttachments, greetings]);

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
  function persist(
    nextTurns: Turn[],
    nextScene: SceneState = sceneRef.current,
    nextThreads: StoryThread[] = threadsRef.current,
  ) {
    const session = sessionRef.current;
    if (!session) return;

    const previous = new Map(session.messages.map((m) => [m.id, m]));
    const messages: StoredMessage[] = nextTurns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      ...(turn.outboundContent ? { outboundContent: turn.outboundContent } : {}),
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

    const updated: ChatSession = {
      ...session,
      messages,
      authorNote: undefined,
      ...(isEmptySceneState(nextScene) ? { sceneState: undefined } : { sceneState: nextScene }),
      ...(nextThreads.length ? { storyThreads: nextThreads } : { storyThreads: undefined }),
      ...(chatBookRef.current?.entries.length
        ? { chatLorebook: chatBookRef.current }
        : { chatLorebook: undefined }),
      ...(Object.keys(lorebookTimingRef.current).length > 0
        ? { lorebookTiming: lorebookTimingRef.current }
        : { lorebookTiming: undefined }),
      ...(Object.keys(attachmentStateRef.current).length > 0
        ? { attachmentState: attachmentStateRef.current }
        : { attachmentState: undefined }),
      // 分支（Phase 11.3）：只有真的分过支才落盘，主干不占字段
      ...(branchTreeRef.current.branches.length > 1
        ? { branchTree: branchTreeRef.current, activeBranch }
        : { branchTree: undefined, activeBranch: undefined }),
      updatedAt: Date.now(),
    };
    sessionRef.current = updated;
    void getSessionStore().save(updated);
  }

  /** 进入生成阶段：阶段切换意味着上一段流已经结束，接收计数从零重新算。 */
  function enterStage(stage: GenerationStage) {
    setGenerationStage(stage);
    setReceivedTokens(0);
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
    /** 本轮临时作者注：重新生成纠偏用，只影响这一轮，不落盘 */
    temporaryNote?: string,
  ) {
    setError(null);
    needsSummarizeRef.current = false;
    setGenerationStage(null);
    setReceivedTokens(0);
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
      ...(config.encodeUserMessageWords
        ? { outboundContent: markPlayer(encodeRandomUserWords(userMessage).text) }
        : {}),
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
      enterStage("attachment");
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
      ...baseTurns.map((turn, index) => ({ role: turn.role, content: index === 0 ? adaptGreeting(historyContent(turn), locale) : historyContent(turn) })),
      ...userTurnsAsMessages(userTurn),
    ];

    /** 这一轮实际用的回合模式，报告里带上 */
    let turnMode: ResponseMode | undefined;

    /*
     * 三来源世界书（Phase 8）：全局 + 角色卡 + 当前聊天。
     *
     * 分开送而不是先合并成一堆条目：匹配时要按来源排优先级——
     * 同一档里聊天书压过角色书，角色书压过全局书。
     * 合并了就没法区分，一场对话里的临时设定会被通用背景顶掉。
     * 直连路径和服务端路径共用这一份原料，两条路结果一致。
     */
    const lorebooks = {
      ...(GLOBAL_LOREBOOK ? { global: GLOBAL_LOREBOOK } : {}),
      ...(card.character_book ? { card: { entries: card.character_book.entries } } : {}),
      ...(chatBookRef.current?.entries.length ? { chat: chatBookRef.current } : {}),
    };

    /**
     * 组装这一轮的提示词。
     *
     * 抽成函数是因为回合模式可能被导演覆盖：先按玩家输入推断组一次给导演看，
     * 导演给了更准的 mode 之后再组一次。组装是纯函数，重复调用没有副作用。
     */
    const assembleFor = (mode?: ResponseMode) => {
      const promptCard = { ...card, attachments: runtimeAttachmentsRef.current };
      const assembled = assemble({
        card: promptCard,
        ...(Object.keys(lorebooks).length > 0 ? { lorebooks } : {}),
        // 世界书时效：sticky / cooldown / delay 的轮次记录，上一轮的结果原样带回来
        ...(Object.keys(lorebookTimingRef.current).length > 0
          ? { lorebookTiming: lorebookTimingRef.current }
          : {}),
        history,
        seed,
        maxContext: DEFAULT_MAX_CONTEXT,
        turn: turnRef.current,
        summary: summaryRef.current ?? undefined,
        facts: factsRef.current,
        journal: journalRef.current,
        style,
        userName,
        ...(temporaryNote ? { temporaryNote } : {}),
        // 场景状态：有就带上，每个字段会标出可信度
        ...(storySystems.events && !isEmptySceneState(sceneRef.current) ? { sceneState: sceneRef.current } : {}),
        // 剧情线：给完整列表，由组装器按策略挑几条注入，不是全部塞进去
        ...(storySystems.goals && threadsRef.current.length ? { storyThreads: threadsRef.current } : {}),
        ...(mode ? { mode } : {}),
        budget: planBudget(DEFAULT_MAX_CONTEXT, DEFAULT_RESPONSE_TOKENS),
      });
      // 记下这一轮实际用的回合模式
      turnMode = assembled.mode;
      // 时效状态每轮都由组装结果刷新，冷却按轮数倒数
      lorebookTimingRef.current = assembled.lorebookTiming;
      return assembled;
    };

    // 远程模型优先从浏览器直连。只有 CORS、网络或上游协议失败时，才回退到 /api/chat。
    // 组装器是纯函数，因此可以安全地在浏览器运行；服务端路径仍保留作后备。
    let directMessages: ChatMessage[] | null = null;
    let directEndpoint = "";
    /** 浏览器直连已经跑过的导演计划，回退到服务端时原样带上，避免再跑一次。 */
    let directorPlanText = "";
    let planningAttempted = false;
    if (!local && !serverOnlyInterface) {
      const resolvedEndpoint = resolveBaseURL(config.providerId, config.baseURL);
      const baseURL = "baseURL" in resolvedEndpoint ? resolvedEndpoint.baseURL : "";
      try {
        directEndpoint = browserChatEndpoint(baseURL);
        const assembled = assembleFor();
        directMessages = assembled.messages;
        // 先按当前组装结果记一份：导演失败时这就是最终发给模型的东西
        inspectorRef.current = assembled.inspector;
        // 两个剧情系统都关掉时没有导演，但仍然走浏览器直连，不为此退回服务端。
        if (shouldPlanTurn(storySystems)) {
          enterStage("plan");
          let planText = "";
          planningAttempted = true;
          await streamBrowserOpenAI({
            endpoint: directEndpoint,
            apiKey: cleanApiKey(config.apiKey).value,
            model: chatRoute.model,
            messages: buildDirectorMessages(assembled.messages, {
              eventsEnabled: storySystems.events,
              goalsEnabled: storySystems.goals,
              stagnantTurns: stagnantTurnsRef.current,
              eventAfterTurns: storySystems.eventAfterTurns,
            }),
            temperature: 0.2,
            maxTokens: DIRECTOR_MAX_TOKENS,
            reasoningEffort: "low",
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === "delta") {
                planText += event.text;
                setReceivedTokens(estimateTokens(planText));
              }
            },
          });
          const plan: TurnPlan | null = parseTurnPlan(planText);
          if (plan) {
            directorPlanText = planText;
            // 状态变化等这一轮落地之后再应用：导演给的是「这一轮会变成什么」，
            // 提前写进状态会让模型把还没发生的事当成已确认的事实。
            if (storySystems.events && plan.statePatch) pendingPatchRef.current = plan.statePatch;
            if (storySystems.goals && plan.threadPatch) pendingThreadsRef.current = plan.threadPatch;
            // 导演看过完整聊天记录，它给的 mode 比只看玩家这一句的推断准。
            // 回合层是按 mode 拼的，所以覆盖之后要重新组装一次（纯函数，很便宜）。
            const base = plan.mode ? assembleFor(plan.mode) : assembled;
            directMessages = insertBeforeCurrentUser(base.messages, {
              role: "system",
              content: formatTurnPlan(plan),
            });
            /*
             * 导演计划是组装之后才拼上的（它由模型现场生成，组装时还不存在），
             * 所以面板要单独补这一条——否则 Inspector 显示的就不是最终发出去的那份。
             */
            inspectorRef.current = withExtraMessage(
              base.inspector,
              { role: "system", content: formatTurnPlan(plan) },
              { section: "director", layer: "post", detail: "导演计划（beats / mode / statePatch）" },
              defaultCost,
            );
          }
        }
      } catch {
        directMessages = null;
      }
    }

    let replyText = "";
    let toolTrace: ToolTrace[] = [];
    let allowTools = true;
    let storyChanged = false;
    // 每一轮都从干净的 pending 开始，避免上一轮没应用的变化漏到这一轮
    if (!directMessages) {
      pendingPatchRef.current = null;
      pendingThreadsRef.current = null;
    }

    const appendReply = (text: string) => {
      replyText += text;
      setReceivedTokens(estimateTokens(replyText));
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === assistantId ? { ...turn, content: turn.content + text } : turn,
        ),
      );
    };

    try {
      if (local) {
        enterStage("write");
        const assembled = assembleFor();
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
            setReceivedTokens(estimateTokens(replyText));
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId ? { ...turn, content: turn.content + frame.text } : turn,
              ),
            );
          } else if (frame.type === "tool") {
            absorbToolCall(calls, frame);
          } else if (frame.type === "done") {
            /*
             * 上游在收尾帧带 usage：这是唯一的真实记账。
             * prompt tokens 已越过压缩阈值就直接压，不等 meta 里那份估算兜底。
             */
            if (frame.usage && frame.usage.promptTokens >= summarizeThresholdFor(DEFAULT_MAX_CONTEXT)) {
              needsSummarizeRef.current = true;
            }
          } else if (frame.type === "meta") {
            needsSummarizeRef.current = frame.needsSummarize;
            // 服务端路径下导演计划在前端看不到，状态变化只能随 meta 回传
            if (storySystems.events && frame.statePatch) pendingPatchRef.current = frame.statePatch;
            if (storySystems.goals && frame.threadPatch) pendingThreadsRef.current = frame.threadPatch;
          } else if (frame.type === "error") {
            setError({ status: 502, code: "stream", message: frame.message });
          }
        };

        if (directMessages && directEndpoint) {
          enterStage("write");
          try {
            await streamBrowserOpenAI({
              endpoint: directEndpoint,
              apiKey: cleanApiKey(config.apiKey).value,
              model: chatRoute.model,
              messages: directMessages,
              temperature: config.temperature,
              maxTokens: DEFAULT_RESPONSE_TOKENS,
              ...(config.reasoningEnabled
                ? { reasoningEffort: config.reasoningEffort ?? "high" }
                : {}),
              tools: allowTools ? [...MEMORY_TOOLS, DICE_TOOL, ...ATTACHMENT_TOOLS] : undefined,
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
        enterStage("write");
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
            interfaceType: config.interfaceType,
            model: chatRoute.model,
            temperature: config.temperature,
            ...(config.reasoningEnabled
              ? { reasoningEffort: config.reasoningEffort ?? "high" }
              : {}),
            ...(chatRoute.baseURL ? { baseURL: chatRoute.baseURL } : {}),
            sessionId,
             tools: allowTools,
            ...(planningAttempted ? { planning: false } : {}),
            ...(directorPlanText ? { directorPlanText } : {}),
            ...(outboundImage ? { image: outboundImage } : {}),
            context: {
              card: { ...card, attachments: runtimeAttachmentsRef.current },
              // 三来源世界书：和服务端直连路径用同一份原料，两条路结果一致
              ...(Object.keys(lorebooks).length > 0 ? { lorebooks } : {}),
              ...(Object.keys(lorebookTimingRef.current).length > 0
                ? { lorebookTiming: lorebookTimingRef.current }
                : {}),
              history,
              seed,
              maxContext: DEFAULT_MAX_CONTEXT,
              turn: turnRef.current,
              summary: summaryRef.current ?? undefined,
              facts: factsRef.current,
              journal: journalRef.current,
              ...(toolTrace.length > 0 ? { toolTrace } : {}),
              // 场景状态和剧情线在服务端路径下也要带上，
              // 否则回退到服务端时状态更新会消失
              ...(temporaryNote ? { temporaryNote } : {}),
               ...(storySystems.events && !isEmptySceneState(sceneRef.current) ? { sceneState: sceneRef.current } : {}),
               ...(storySystems.goals && threadsRef.current.length ? { storyThreads: threadsRef.current } : {}),
               storySystems: {
                 events: storySystems.events,
                 goals: storySystems.goals,
                 eventAfterTurns: storySystems.eventAfterTurns,
                 stagnantTurns: stagnantTurnsRef.current,
               },
              ...(turnMode ? { mode: turnMode } : {}),
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
          if (ATTACHMENT_TOOL_NAMES.has(call.name)) {
            const execution = executeAttachmentTool(call.name, call.arguments, {
              attachments: runtimeAttachmentsRef.current,
              maps: generatedMapsRef.current,
              state: attachmentStateRef.current,
              startSeed: sessionRef.current?.id ?? sessionId,
            });
            if (execution.attachments) {
              runtimeAttachmentsRef.current = execution.attachments;
              setRuntimeAttachments(execution.attachments);
            }
            if (execution.maps) {
              generatedMapsRef.current = execution.maps;
              setGeneratedMaps(execution.maps);
            }
            if (execution.state) attachmentStateRef.current = execution.state;
            toolTrace = [
              ...toolTrace,
              { name: call.name, arguments: call.arguments, result: execution.result },
            ];
            continue;
          }
          if (call.name === "remember_character") {
            const created = newCharacter(journalRef.current, call.arguments);
            if (created) freshCharacters.push(created);
          }
          /*
           * 带上当前轮次：模型不传 turn 时，目录也能知道哪条是新的。
           *
           * 走 applyMemoryWrite 而不是 applyChatTool：长期记忆的写入要过 7.2 / 7.3
           * 那套规则——同一个名字已有记录、内容却不一样时保留旧的，
           * 返回一条冲突提示，而不是让最新一次输出把旧记录顶掉。
           */
          const applied = applyMemoryWrite(
            journalRef.current,
            call.name,
            call.arguments,
            turnRef.current,
          );
          journalRef.current = applied.journal;
          if (applied.conflict) {
            memoryConflictsRef.current = [...memoryConflictsRef.current, applied.conflict];
          }
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
        enterStage("write");
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
      /*
       * 酒馆式直出：模型回什么就落什么，不再跑质量门，也不再有修复调用。
       * 输出质量交给提示词负责；空回复（玩家中断、上游没吐字）不算一轮，
       * 走下面 wrote=false 的分支把被替换的旧回复放回去。
       */
      if (devEnabled && inspectorRef.current) {
        // 提示词结构单独记（Phase 10）：它带着正文，只在内存里
        recordInspector(inspectorRef.current);
      }

      /*
       * 落地。写入规则本身在 lib/engine/history.ts 里，纯函数、有测试：
       * 空内容它不会写成一轮，调用方想污染历史也污染不了。
       */
      const carried = carrySwipesRef.current;
      carrySwipesRef.current = null;
      const committed = commitTurn(
        baseTurns,
        { user: userTurn, assistant: { id: assistantId, role: "assistant", content: "" } },
        { status: "accepted", content: replyText },
      );
      // 空回复（被玩家中断、上游没吐字）不算一轮，恢复被替换掉的那条旧回复
      const wrote = committed.written && committed.content.length > 0;

      const finalTurns: Turn[] = wrote
        ? committed.turns.map((turn) => {
            if (turn.id !== assistantId) return turn;
            const swipes = carried ? [...carried, committed.content] : undefined;
            return {
              ...turn,
              swipes,
              swipeIndex: swipes ? swipes.length - 1 : undefined,
            };
          })
        : // 没有正文：玩家的这一句照旧留在画面上，被替换掉的旧回复放回去
          [...baseTurns, userTurn, ...(carryTurnRef.current ? [carryTurnRef.current] : [])];
      if (wrote || carryTurnRef.current) carryTurnRef.current = null;

      /*
       * 分支记账（Phase 11.3）：这一轮落在哪条分支上，就把这两个消息 id
       * 记到那条分支名下。主干不在这里管——主干的顺序就是 turns 本身。
       */
      if (wrote && activeBranchRef.current !== MAIN_BRANCH) {
        branchTreeRef.current = appendToBranch(branchTreeRef.current, activeBranchRef.current, [
          userTurn.id,
          assistantId,
        ]);
      }

      setTurns(finalTurns);
      persist(finalTurns);
      setStreaming(false);
      abortRef.current = null;

      /*
       * 场景状态更新（Phase 5）：正文生成完了才应用导演给出的变化。
       *
       * 顺序就是 5.2 那条链路：正文生成 → 状态提取（导演顺带做的）→ 比较旧状态 →
       * 只保存变化项。被拒收的一轮不更新状态——那一轮根本没发生。
       * 已确认的事实挡得住推断值的覆盖，被挡下的记进 pending。
       */
      if (storySystems.events && wrote && pendingPatchRef.current) {
        const update = applyScenePatch(sceneRef.current, pendingPatchRef.current, turnRef.current + 1, {
          now: Date.now(),
        });
        sceneRef.current = update.state;
        storyChanged = storyChanged || update.changes.length > 0;
        if (update.changes.length > 0 || update.conflicts.length > 0) {
          persist(finalTurns, update.state);
          if (process.env.NODE_ENV === "development") {
            console.debug("[ai-rp] scene state", {
              changes: update.changes,
              conflicts: update.conflicts,
            });
          }
        }
      }
      pendingPatchRef.current = null;

      /*
       * 剧情线更新（Phase 6）：和状态一样，正文生成完之后才应用。
       * 已解决的线不会被重新打开；被挡下来的记进 blocked 只做日志。
       */
      if (storySystems.goals && wrote && pendingThreadsRef.current) {
        const update = applyThreadPatch(
          threadsRef.current,
          pendingThreadsRef.current,
          turnRef.current + 1,
        );
        threadsRef.current = update.threads;
        storyChanged = storyChanged || update.created.length > 0 || update.updated.length > 0 || update.resolved.length > 0;
        if (update.created.length || update.updated.length || update.blocked.length) {
          persist(finalTurns, sceneRef.current, update.threads);
          if (process.env.NODE_ENV === "development") {
            console.debug("[ai-rp] story threads", {
              created: update.created.map((item) => item.title),
              updated: update.updated.map((item) => item.title),
              resolved: update.resolved.map((item) => item.title),
              blocked: update.blocked.map((item) => item.title),
            });
          }
        }
      }
      pendingThreadsRef.current = null;

      /*
       * 记忆冲突（Phase 7）：模型想改一条已经记下的事，旧记录留住了。
       * 现在只做开发模式日志——界面上的「等玩家确认」是下一步。
       */
      if (memoryConflictsRef.current.length > 0) {
        if (process.env.NODE_ENV === "development") {
          console.debug("[ai-rp] memory conflicts", memoryConflictsRef.current);
        }
        memoryConflictsRef.current = [];
      }

      turnRef.current += 1;
      if (wrote) {
        stagnantTurnsRef.current = storyChanged ? 0 : stagnantTurnsRef.current + 1;
      }
      if (wrote) void maybeAutoCg(finalTurns);
      void saveCardMemory({
        cardId,
        summary: summaryRef.current,
        facts: factsRef.current,
        journal: journalRef.current,
        turn: turnRef.current,
        updatedAt: Date.now(),
      });
      /*
       * 压一次历史。放在这里而不是流中途，免得拖慢首字时间。
       * 触发判据有二：组装时按估算算出的 needsSummarize（拿不到 usage 的路径），
       * 以及上面收尾帧里用真实 usage 做出的判断。
       */
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
    // 重置会话等于回到开场，场景状态、剧情线和聊天世界书也要跟着回到起点
    sceneRef.current = emptySceneState();
    threadsRef.current = [];
    chatBookRef.current = undefined;
    lorebookTimingRef.current = {};
    // 重置会话回到主线，分支也一起清掉
    branchTreeRef.current = { branches: [mainBranch()], messages: { [MAIN_BRANCH]: [] } };
    setBranches([mainBranch()]);
    setActiveBranch(MAIN_BRANCH);
    activeBranchRef.current = MAIN_BRANCH;
    const runtime = attachmentRuntime(cardAttachments, undefined, createId());
    adoptAttachmentRuntime(runtime);
    setStaleState(null);
    pendingPatchRef.current = null;
    pendingThreadsRef.current = null;
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

  async function chooseAttachment() {
    if (!isAndroidApp()) {
      imageInputRef.current?.click();
      return;
    }
    if (!hasNativeFilePicker()) {
      setError({ status: 0, code: "file", message: t("native.filePickerUnavailable") });
      return;
    }
    try {
      await pickFile((await pickNativeFile("image/*,.txt,.md,.markdown,.csv,.json,.log,.docx")) ?? undefined);
    } catch (caught) {
      setError({ status: 0, code: "file", message: caught instanceof Error ? caught.message : t("native.filePickerUnavailable") });
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
    /*
     * Phase 11.1：用 planRegenerate 算「重跑要用什么」。
     *
     * 它保证三件事：错误回复不进新请求、玩家输入原样保留、
     * 从末尾往前找到真正要重跑的那一轮（回复后面可能还跟着别的消息）。
     * 以前这里是手写的 slice(0, -1)，两者在正常情况一样，
     * 但玩家改过历史之后就不一样了。
     */
    const plan = planRegenerate(
      turns.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content })),
    );
    if (plan.blocked || !plan.discardedId) {
      cycleGreeting();
      return;
    }

    const base = turns.slice(0, plan.history.length);
    const last = turns.find((turn) => turn.id === plan.discardedId);
    if (last?.role === "assistant") {
      carrySwipesRef.current = last.swipes?.length ? [...last.swipes] : [last.content];
      carryTurnRef.current = last;
    }
    setTurns(base);
    // 临时纠偏：说清「别复用上一版什么」，只影响这一轮，不落盘
    void runTurn(
      playerText(plan.playerInput),
      base,
      lastUserImage(turns, plan.discardedId),
      lastUserDocument(turns, plan.discardedId),
      regenerateNote(plan.discarded),
    );
  }

  /** 被重跑那一轮的玩家附件。它挂在玩家那条消息上，不在回复上。 */
  function lastUserImage(list: Turn[], replyId: string) {
    const index = list.findIndex((turn) => turn.id === replyId);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (list[i].role === "user") return list[i].image;
    }
    return undefined;
  }

  function lastUserDocument(list: Turn[], replyId: string) {
    const index = list.findIndex((turn) => turn.id === replyId);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (list[i].role === "user") return list[i].document;
    }
    return undefined;
  }

  /** 复制一条消息的正文。剪贴板 API 在不安全来源下没有，退回到老办法。 */
  async function copyMessage(id: string, text: string) {
    const body = applyMacros(text, macroVars).trim();
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

  /**
   * 改完这条玩家消息就从这里重跑：后面的对话被丢掉，由模型重新接。
   *
   * Phase 11.2：丢掉后面内容的同时，把「哪些状态可能过时了」记下来。
   * 场景状态、剧情线、摘要、事实都是从已落地的正文里推出来的，
   * 那段正文既然不作数了，它们也就只能算「可能过时」。
   * 不自动重算：重算要么再叫一次模型（花钱、还会漂），要么本地推（推不出来）。
   * 留着旧值但明确标注，比猜一个更安全。
   */
  function commitEdit(turn: Turn, index: number) {
    const text = editingText.trim();
    setEditingId(null);
    if (!text || streaming) return;
    const base = turns.slice(0, index);
    const stale = reportStale({ index, role: turn.role }, base.length, turns.length);
    if (stale.action !== "none") setStaleState({ report: stale, editedId: turn.id });
    setTurns(base);
    void runTurn(text, base, turn.image, turn.document);
  }

  /**
   * 建一条分支（Phase 11.3）。
   *
   * 分出去的那一刻把当前历史复制一份给分支，之后两条各走各的。
   * 主干一个字节都不动——这正是「不同选择形成不同剧情线，
   * 而不是覆盖原来的故事」。
   */
  function branchFrom(turn: Turn, index: number) {
    if (streaming) return;
    const id = `b${Date.now().toString(36)}`;
    const created = createBranch({
      id,
      parentMessageId: turn.id,
      title: `从第 ${index + 1} 条分出去`,
      createdAt: Date.now(),
      inheritedMessageIds: turns.slice(0, index + 1).map((item) => item.id),
      existing: branchTreeRef.current.branches,
    });
    if (!created) return;
    const tree: BranchTree = {
      ...created.tree,
      messages: {
        ...created.tree.messages,
        // 分支从分叉点开始，先把已经发生的这一段带过去
        [id]: turns.slice(0, index + 1).map((item) => item.id),
      },
    };
    branchTreeRef.current = tree;
    setBranches(tree.branches);
    setActiveBranch(id);
    activeBranchRef.current = id;
    persist(turns);
    setBranchOpen(false);
  }

  /** 切到某条分支。主干只留到分叉点，接上分支自己的消息。 */
  function switchBranch(branch: ChatBranch) {
    if (streaming) return;
    setActiveBranch(branch.id);
    activeBranchRef.current = branch.id;
    setBranchOpen(false);
    const view = resolveBranch(branch, branchTreeRef.current, turns.map((turn) => turn.id));
    if (branch.id === MAIN_BRANCH) {
      persist(turns);
      return;
    }
    /*
     * 分支视图 = 主干到分叉点 + 分支自己的消息。
     * 分支的消息内容目前和主干共享（分出去时是复制的），所以这里只切显示范围；
     * 等分支上真的生成了新回复，它会有自己的消息 id。
     */
    const allowed = new Set([...view.baseIds, ...view.branchIds]);
    const visible = turns.filter((turn) => allowed.has(turn.id));
    if (visible.length > 0) setTurns(visible);
    persist(visible);
  }

  function dropBranch(branch: ChatBranch) {
    const tree = removeBranch(branchTreeRef.current, branch.id);
    branchTreeRef.current = tree;
    setBranches(tree.branches);
    if (activeBranch === branch.id) switchBranch(mainBranch());
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
          card,
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

  function openAttachment(id?: string) {
    const target = id ?? activeAttachment?.id ?? visibleAttachments[0]?.id;
    if (!target) return;
    setActiveAttachmentId(target);
    setAttachmentOpen(true);
  }

  function askAboutAttachment(regionId?: string) {
    if (!activeAttachment || streaming || !memoryReadyRef.current) return;
    const subject = regionId ? `地图区域「${regionId}」` : activeAttachment.title ?? activeAttachment.id;
    setAttachmentOpen(false);
    void runTurn(`请说明${subject}。`, turns);
  }

  return (
    <div
      className="relative flex h-dvh overflow-hidden"
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

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <TopBar
        floating={!androidApp}
        avatar={<Avatar name={card.name} src={portraitUrl} />}
        name={card.name}
        subtitle={card.tags?.join(" · ")}
        whoLabel={t("topbar.who")}
        historyLabel={t("chat.reset")}
        exportLabel={t("topbar.export")}
        settingsLabel={t("topbar.settings")}
        onWho={onOpenShelf}
        onHistory={() => setResetOpen(true)}
        onExport={() => setExportOpen(true)}
        onSettings={onOpenSettings}
        androidStatus={androidApp ? <AndroidStatus enabled={androidApp} /> : null}
        extra={
          <>
            {visibleAttachments.length > 0 ? (
              <IconButton aria-label="附件" title="附件" onClick={() => openAttachment()}>
                <IconMap />
              </IconButton>
            ) : null}
            <PwaInstallButton />
            <AnnouncementBell onClick={() => setAnnounceOpen(true)} />
          </>
        }
      />

      {/*
        状态过时提示（Phase 11.2）：编辑过历史消息之后出现。
        只提示，不自动重算——重算要么再叫一次模型，要么本地推，两样都更糟。
      */}
      {staleState ? (
        <div className="mx-auto mb-2 flex w-full max-w-[720px] items-start gap-2 rounded-card border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          <span className="min-w-0 flex-1">{staleState.report.note}</span>
          <button
            type="button"
            onClick={() => setStaleState(null)}
            className="shrink-0 text-[12px] text-ink-3 underline"
          >
            {t("common.close")}
          </button>
        </div>
      ) : null}

      <ChatScroll
        ref={scrollRef}
        /* 顶栏浮在上面，正文要让开它的高度，否则第一条内容会被压在栏下。
           栏本身不占流内高度，所以这份留白是唯一的高度来源。 */
        className={androidApp ? undefined : "pt-[calc(env(safe-area-inset-top)+96px)]"}
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
                              commitEdit(turn, index);
                            }
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          className="max-h-[40dvh] w-full resize-y rounded-card border border-line-strong bg-surface-2 px-[18px] py-[11px] text-[15.5px] leading-[1.65] text-ink outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <ActPill onClick={() => setEditingId(null)}>{t("chat.cancel")}</ActPill>
                          <ActPill hot onClick={() => commitEdit(turn, index)}>
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
                        <MarkdownText tone="bubble" text={applyMacros(playerText(turn.content), macroVars)} />
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
                  <MessageIconButton
                    hot
                    label={turns.length <= 1 ? t("chat.newOpening") : t("chat.regenerate")}
                    onClick={regenerate}
                  >
                    <IconRefresh className="size-4" />
                  </MessageIconButton>
                ) : null}
                {turn.swipes && turn.swipes.length > 1 ? (
                  <>
                    <MessageIconButton label={t("chat.prev")} onClick={() => switchSwipe(turn, -1)}>
                      ‹
                    </MessageIconButton>
                    <MessageIconButton
                      label={t("chat.next")}
                      onClick={() => switchSwipe(turn, 1)}
                    >
                      ›
                    </MessageIconButton>
                  </>
                ) : null}
                {/* 从这一条分出去（Phase 11.3）：换一条路走，不动原来的故事 */}
                <MessageIconButton label={t("branch.fromHere")} onClick={() => branchFrom(turn, index)}>
                  <IconBranch className="size-4" />
                </MessageIconButton>
                <MessageIconButton
                  hot={turn.chapterBreak}
                  label={turn.chapterBreak ? t("chat.unchapter") : t("chat.chapter")}
                  onClick={() => toggleChapter(turn)}
                >
                   <IconBookmark className="size-4" filled={turn.chapterBreak} />
                </MessageIconButton>
                {/* 没配生图模型就整颗不出现，不给假入口 */}
                {isLastTurn && imageReady ? (
                  <MessageIconButton
                    disabled={cgBusy === turn.id}
                    label={t("chat.cgTitle")}
                    onClick={() => void generateFor(turn, "manual")}
                  >
                    <IconImage className="size-4" />
                  </MessageIconButton>
                ) : null}
              </MessageActions>
            ) : undefined;

            return (
              <Fragment key={turn.id}>
                <AssistantTurn
                  content={index === 0 ? adaptGreeting(turn.content, locale) : turn.content}
                  macroVars={macroVars}
                  streaming={streaming && isLastTurn}
                  stage={streaming && isLastTurn ? generationStage ?? undefined : undefined}
                  receivedCount={streaming && isLastTurn ? receivedTokens : undefined}
                  cardName={card.name}
                  portraitUrl={portraitUrl}
                  portraits={portraits}
                  actions={actions}
                  onMacroClick={(macro) => {
                    // 二段点击的第二下：玩家名直接进编辑，其余宏打开说明
                    if (macro.name === "user") openUserNameEditor();
                    else setMacroInfo(macro);
                  }}
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
        {devEnabled ? (
          <div className="mx-auto mb-1 flex max-w-[660px] justify-end gap-1.5">
            {branches.length > 1 ? (
                <MessageIconButton label={t("branch.title")} onClick={() => setBranchOpen(true)}>
                <span className="relative">
                  <IconBranch className="size-4" />
                  <span className="absolute -top-2 -right-2 grid size-4 place-items-center rounded-pill bg-accent text-[9px] leading-none text-accent-ink">
                    {branches.length}
                  </span>
                </span>
              </MessageIconButton>
            ) : null}
            <DevReportButton open={devOpen} onToggle={() => setDevOpen((open) => !open)} />
          </div>
        ) : branches.length > 1 ? (
          <div className="mx-auto mb-1 flex max-w-[660px] justify-end">
            <MessageIconButton label={t("branch.title")} onClick={() => setBranchOpen(true)}>
                <span className="relative">
                  <IconBranch className="size-4" />
                  <span className="absolute -top-2 -right-2 grid size-4 place-items-center rounded-pill bg-accent text-[9px] leading-none text-accent-ink">
                    {branches.length}
                  </span>
                </span>
            </MessageIconButton>
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
           onPlus={() => void chooseAttachment()}
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

      {attachmentOpen && activeMapAttachment && activeMap ? (
        <MapAttachmentView
          map={activeMap}
          mode={attachmentMode}
          title={activeMapAttachment.title ?? "地图"}
          onClose={() => setAttachmentOpen(false)}
          onBackToChat={() => setAttachmentOpen(false)}
          onAskCharacter={(region) => askAboutAttachment(region?.id)}
          tabs={attachmentTabs}
          activeTabId={activeAttachment?.id}
          onTabChange={setActiveAttachmentId}
        />
      ) : null}
      {attachmentOpen && activeCodexAttachment ? (
        <CodexAttachmentView
          attachment={activeCodexAttachment}
          mode={attachmentMode}
          onClose={() => setAttachmentOpen(false)}
          onBackToChat={() => setAttachmentOpen(false)}
          onAskCharacter={() => askAboutAttachment()}
          tabs={attachmentTabs}
          activeTabId={activeAttachment?.id}
          onTabChange={setActiveAttachmentId}
        />
      ) : null}

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

      <Dialog
        open={macroInfo !== null}
        onClose={() => setMacroInfo(null)}
        closeLabel={t("common.close")}
        title={t("chat.macroTitle")}
      >
        {macroInfo ? (
          <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-2">
            <p className="m-0">{t("chat.macroSource", { source: macroInfo.source })}</p>
            <p className="m-0">{t("chat.macroProperty", { property: t(macroPropertyKey(macroInfo.name)) })}</p>
            <p className="m-0 break-words">{t("chat.macroValue", { value: macroInfo.text })}</p>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={userNameEditOpen}
        onClose={() => setUserNameEditOpen(false)}
        closeLabel={t("common.close")}
        title={t("chat.editUserName")}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveUserName();
          }}
        >
          <Field>
            <FieldInput
              autoFocus
              type="text"
              autoComplete="name"
              spellCheck={false}
              value={userNameDraft}
              placeholder={t("settings.userNamePlaceholder")}
              onChange={(event) => setUserNameDraft(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <PillButton block onClick={() => setUserNameEditOpen(false)}>
              {t("chat.cancel")}
            </PillButton>
            <PillButton block variant="primary" type="submit">
              {t("common.confirm")}
            </PillButton>
          </div>
        </form>
      </Dialog>

      <Veil open={exportOpen} onClose={() => setExportOpen(false)} />
      <Sheet
        open={exportOpen}
        title={t("chat.exportEpub")}
        onClose={() => setExportOpen(false)}
        closeLabel={t("common.close")}
      >
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

      {/* 分支切换（Phase 11.3）：不同选择各走各的，不覆盖原来的故事 */}
      <Veil open={branchOpen} onClose={() => setBranchOpen(false)} />
      <Sheet open={branchOpen} title={t("branch.title")} description={t("branch.hint")} onClose={() => setBranchOpen(false)} closeLabel={t("common.close")}>
        <ul className="m-0 mb-4 list-none space-y-1.5 p-0">
          {branches.map((branch, index) => (
            <li key={branch.id} className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={activeBranch === branch.id}
                onClick={() => switchBranch(branch)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                  activeBranch === branch.id
                    ? "border-line-strong bg-surface-3 text-ink"
                    : "border-line bg-surface-2 text-ink-2 hover:border-line-strong",
                )}
              >
                {describeBranch(branch, index)}
                <span className="ml-2 text-[11px] text-ink-3">
                  {branchTreeRef.current.messages[branch.id]?.length ?? 0} 条
                </span>
              </button>
              {branch.id !== MAIN_BRANCH ? (
                <button
                  type="button"
                  aria-label={t("branch.remove")}
                  onClick={() => dropBranch(branch)}
                  className="shrink-0 rounded-sm px-2 py-1 text-[12px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-danger"
                >
                  {t("branch.remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Sheet>

      {/* 文本引擎观测只在开发模式（或 ?dev=1）出现，数据只在内存里 */}
      {devEnabled ? (
        <DevReportPanel open={devOpen} onClose={() => setDevOpen(false)} />
      ) : null}
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
