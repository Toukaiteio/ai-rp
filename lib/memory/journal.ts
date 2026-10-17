import { describeRoll } from "@/lib/dice";

/**
 * 本机剧情记忆：人物、地点、特殊事件。
 *
 * 存在这张卡的加密槽里（IndexedDB），服务端不留。
 * 模型通过函数调用读写，真正落盘的是浏览器。
 *
 * 两件事是这套记忆的骨架：
 * 1. 条目之间要能互相指。人物知道自己在哪个地点、参与过哪个事件，
 *    事件记得谁在场、在哪发生。只靠一条 detail 文本，
 *    长对话里模型没法把「谁在哪、谁跟谁有关」串起来。
 * 2. 总量必须封顶。目录是每轮都进提示词的，
 *    条目数或单条长度不设闸，几十轮之后会先撑爆上下文，再谈别的。
 */

/** 每类条目上限。三类加起来最多 45 条，够一场长对话用。 */
const MAX_ENTRIES = 15;
const MAX_NAME = 24;
const MAX_DETAIL = 180;
const MAX_LINK = 8;
/** 写进提示词的目录里，每类最多列这几条（最新的在前）。 */
const LIST_LIMIT = 8;
/** 目录正文的硬上限，超出就从最旧的条目开始砍。 */
const JOURNAL_TOKEN_CAP = 900;
/** 生成头像单独存放，不进提示词。张数和单张长度都要封住，否则存档会先爆。 */
const MAX_PORTRAITS = 8;
const MAX_PORTRAIT_CHARS = 60_000;

export interface JournalEntry {
  /** 一句话现状 */
  detail: string;
  /** 所在地点，对应 places 里的名字 */
  where?: string;
  /** 最近一次出场的轮次 */
  turn?: number;
  /** 关联条目名：人物写共事者，地点写常驻者，事件写参与者 */
  ref?: string[];
}

export interface Journal {
  characters: Record<string, JournalEntry>;
  places: Record<string, JournalEntry>;
  events: Record<string, JournalEntry>;
  /**
   * 生成的角色头像，data URL。只给界面和存档用。
   * formatJournal 不会读它，避免把图片塞进每一轮提示词。
   */
  portraits?: Record<string, string>;
}

export type JournalKind = "character" | "place" | "event";

export interface ToolTrace {
  name: string;
  arguments: string;
  result: string;
}

export function emptyJournal(): Journal {
  return { characters: {}, places: {}, events: {} };
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * 归一化一个条目。
 * 旧存档的 detail 是裸字符串，这里统一升成对象，读的时候两种都能吃。
 */
function entry(value: unknown): JournalEntry | null {
  if (typeof value === "string") {
    const detail = clip(value, MAX_DETAIL);
    return detail ? { detail } : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<JournalEntry>;
  const detail = typeof raw.detail === "string" ? clip(raw.detail, MAX_DETAIL) : "";
  if (!detail) return null;

  const out: JournalEntry = { detail };
  if (typeof raw.where === "string" && raw.where.trim()) {
    out.where = clip(raw.where, MAX_NAME);
  }
  if (typeof raw.turn === "number" && Number.isFinite(raw.turn) && raw.turn >= 0) {
    out.turn = Math.floor(raw.turn);
  }
  if (Array.isArray(raw.ref)) {
    const refs = raw.ref
      .filter((item): item is string => typeof item === "string" && !!item.trim())
      .map((item) => clip(item, MAX_NAME))
      .filter(Boolean);
    if (refs.length > 0) out.ref = refs.slice(0, MAX_LINK);
  }
  return out;
}

function entryMap(value: unknown): Record<string, JournalEntry> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, JournalEntry> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = clip(key, MAX_NAME);
    const parsed = entry(item);
    if (!name || !parsed) continue;
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    out[name] = parsed;
  }
  return out;
}

function portraitMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = clip(key, MAX_NAME);
    if (!name || typeof item !== "string") continue;
    if (!item.startsWith("data:image/")) continue;
    if (item.length > MAX_PORTRAIT_CHARS) continue;
    if (Object.keys(out).length >= MAX_PORTRAITS) break;
    out[name] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeJournal(value: unknown): Journal {
  if (typeof value !== "object" || value === null) return emptyJournal();
  const raw = value as Partial<Journal>;
  const portraits = portraitMap(raw.portraits);
  return {
    characters: entryMap(raw.characters),
    places: entryMap(raw.places),
    events: entryMap(raw.events),
    ...(portraits ? { portraits } : {}),
  };
}

/** 写入一张头像。满了就丢掉最早的那张，不让存档跟着角色数一起涨。 */
export function putPortrait(journal: Journal, name: string, src: string): Journal {
  const next = normalizeJournal(journal);
  const key = clip(name, MAX_NAME);
  if (!key || !src.startsWith("data:image/") || src.length > MAX_PORTRAIT_CHARS) return next;
  const portraits = { ...(next.portraits ?? {}) };
  if (!(key in portraits) && Object.keys(portraits).length >= MAX_PORTRAITS) {
    const oldest = Object.keys(portraits)[0];
    if (oldest) delete portraits[oldest];
  }
  portraits[key] = src;
  next.portraits = portraits;
  return next;
}

function bucket(journal: Journal, kind: JournalKind): Record<string, JournalEntry> {
  if (kind === "character") return journal.characters;
  if (kind === "place") return journal.places;
  return journal.events;
}

const KIND_LABEL: Record<JournalKind, string> = {
  character: "人物",
  place: "地点",
  event: "事件",
};

/** 关联字段的显示名。人物记共事者，事件记参与者，地点记常驻者。 */
const REF_LABEL: Record<JournalKind, string> = {
  character: "共事",
  place: "常驻",
  event: "在场",
};

/**
 * 只留下两处有用的关联：本类的 ref，和别人条目里指过来的 where。
 * 不做全量反向索引——那是把同一份关系抄三遍，体积先炸。
 */
function backlinks(journal: Journal, name: string): { where: string[]; ref: string[] } {
  const where: string[] = [];
  const ref: string[] = [];
  for (const [who, item] of Object.entries(journal.characters)) {
    if (who !== name && item.where === name) where.push(who);
  }
  for (const [what, item] of Object.entries(journal.events)) {
    if (what !== name && item.where === name) where.push(what);
  }
  for (const list of [journal.characters, journal.places, journal.events]) {
    for (const [who, item] of Object.entries(list)) {
      if (who !== name && item.ref?.includes(name)) ref.push(who);
    }
  }
  return { where: [...new Set(where)], ref: [...new Set(ref)] };
}

function formatEntry(
  name: string,
  item: JournalEntry,
  kind: JournalKind,
  links?: { where: string[]; ref: string[] },
): string {
  const parts = [item.detail];
  if (item.where) parts.push(`在${item.where}`);
  if (item.ref?.length) parts.push(`${REF_LABEL[kind]}：${item.ref.join("、")}`);
  if (kind === "place" && links?.where.length) parts.push(`此处有：${links.where.join("、")}`);
  if (links?.ref.length) parts.push(`被提到：${links.ref.join("、")}`);
  if (item.turn !== undefined) parts.push(`第${item.turn}轮`);
  return `- ${name}：${parts.join("；")}`;
}

function formatBucket(
  title: string,
  entries: Record<string, JournalEntry>,
  journal: Journal,
  kind: JournalKind,
  limit = LIST_LIMIT,
): string {
  const rows = Object.entries(entries);
  if (rows.length === 0) return `${title}\n（无）`;
  // 记过的轮次越大越近，没记轮次的排最后
  const sorted = rows.sort((a, b) => (b[1].turn ?? -1) - (a[1].turn ?? -1));
  return `${title}\n${sorted
    .slice(0, limit)
    .map(([name, item]) =>
      formatEntry(name, item, kind, kind === "place" ? backlinks(journal, name) : undefined),
    )
    .join("\n")}`;
}

/** 极粗的 token 估法，只为封顶服务，不追求和分词器一致。 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g) ?? [])
    .length;
  return Math.ceil(cjk * 0.75 + (text.length - cjk) / 4);
}

/**
 * 放进提示词后部的目录。不进前缀，避免每次记下一条就拆掉缓存。
 * 超预算就从最旧的条目开始整类砍，绝不让它顶掉历史。
 */
export function formatJournal(journal: Journal | undefined): string {
  const current = journal ?? emptyJournal();
  const intro =
    "本机记忆目录（IndexedDB，只在这台设备）：";
  const outro = [
    "核对细节用 read_memory，名字不确定用 search_memory，要看全目录再用 list_memory。",
    "新出现的人物、地点，或值得长期记住的事，用 remember_character、remember_place、remember_event 这几个函数记下。它们是函数调用，不是回复里的标签，也不要在正文里写函数名或参数。只记已经发生的，不要把每一句都写进去。",
    "记下时用 where 写所在或发生的地点名，用 ref 写相关的人或事，条目靠这两个字段互相指到。同名再写就是更新。写错或不再有用的，调用 forget_memory 删掉。",
    "攻击、检定、伤害或任何随机点数，调用 roll_dice，并按它返回的点数写。不要自己编点数，也不要向玩家提起这些工具。",
  ].join("\n");

  const buckets: Array<[string, Record<string, JournalEntry>, JournalKind]> = [
    ["人物", current.characters, "character"],
    ["地点", current.places, "place"],
    ["事件", current.events, "event"],
  ];

  const build = (limits: number[]) =>
    [
      intro,
      ...buckets.map(([title, entries, kind], i) =>
        formatBucket(title, entries, current, kind, limits[i]),
      ),
      outro,
    ].join("\n");

  // 超预算就逐类收窄列出的条数。收到底还装不下的是单条文本太长，
  // 那种情况交给 normalizeJournal 的 MAX_DETAIL 兜住，这里不再截断正文。
  const limits = buckets.map(() => LIST_LIMIT);
  let text = build(limits);
  for (let round = LIST_LIMIT; estimateTokens(text) > JOURNAL_TOKEN_CAP && round > 0; round -= 1) {
    for (let i = 0; i < limits.length; i += 1) {
      if (limits[i] > round - 1) limits[i] = round - 1;
    }
    text = build(limits);
  }
  return text;
}

export function formatToolTrace(trace: ToolTrace[]): string {
  if (trace.length === 0) return "";
  const lines = trace.map((item) => `- ${item.name}：${item.result}`);
  return `你刚才调用了本机工具，结果如下：\n${lines.join("\n")}\n请据此继续讲。掷骰的点数以结果为准，不要改。不要提及工具。`;
}

function readArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 参数坏了就当空对象，下面会报缺字段
  }
  return {};
}

function asKind(value: unknown): JournalKind | null {
  if (value === "character" || value === "place" || value === "event") return value;
  return null;
}

interface WriteArgs {
  name?: unknown;
  detail?: unknown;
  where?: unknown;
  ref?: unknown;
  turn?: unknown;
}

const WRITERS: Record<string, JournalKind> = {
  remember_character: "character",
  remember_place: "place",
  remember_event: "event",
};

/** 本机工具的入口。掷骰不改记忆，其余交给记忆目录。 */
export function applyChatTool(
  journal: Journal,
  name: string,
  rawArguments: string,
  turn?: number,
): { journal: Journal; result: string } {
  if (name === "roll_dice") return { journal, result: describeRoll(rawArguments) };
  return applyMemoryTool(journal, name, rawArguments, turn);
}

/** 执行一次函数调用。返回新目录和给模型看的一句结果。 */
export function applyMemoryTool(
  journal: Journal,
  name: string,
  rawArguments: string,
  turn?: number,
): { journal: Journal; result: string } {
  const args = readArgs(rawArguments);

  if (name === "list_memory") return { journal, result: formatJournal(journal) };

  if (name === "read_memory") {
    const kind = asKind(args.kind);
    const entryName = typeof args.name === "string" ? clip(args.name, MAX_NAME) : "";
    if (!kind || !entryName) {
      return { journal, result: "缺少 kind 或 name。kind 只能是 character、place、event。" };
    }
    const item = bucket(journal, kind)[entryName];
    if (!item) return { journal, result: `没有${KIND_LABEL[kind]}「${entryName}」。` };
    const links = backlinks(journal, entryName);
    const parts = [item.detail];
    if (item.where) parts.push(`在${item.where}`);
    if (item.ref?.length) parts.push(`${REF_LABEL[kind]}：${item.ref.join("、")}`);
    if (kind === "place" && links.where.length) parts.push(`此处有：${links.where.join("、")}`);
    if (links.ref.length) parts.push(`被提到：${links.ref.join("、")}`);
    if (item.turn !== undefined) parts.push(`第${item.turn}轮`);
    return { journal, result: `${KIND_LABEL[kind]}「${entryName}」：${parts.join("；")}` };
  }

  if (name === "search_memory") {
    const query = typeof args.query === "string" ? clip(args.query, MAX_NAME) : "";
    if (!query) return { journal, result: "缺少 query。" };
    const hits: string[] = [];
    for (const kind of ["character", "place", "event"] as JournalKind[]) {
      for (const [entryName, item] of Object.entries(bucket(journal, kind))) {
        const haystack = `${entryName} ${item.detail} ${item.where ?? ""} ${item.ref?.join(" ") ?? ""}`;
        if (haystack.includes(query)) hits.push(`${KIND_LABEL[kind]}「${entryName}」：${item.detail}`);
      }
    }
    return {
      journal,
      result: hits.length ? `找到 ${hits.length} 条：\n${hits.slice(0, 10).join("\n")}` : `没有和「${query}」相关的记忆。`,
    };
  }

  if (name === "forget_memory") {
    const kind = asKind(args.kind);
    const entryName = typeof args.name === "string" ? clip(args.name, MAX_NAME) : "";
    if (!kind || !entryName) {
      return { journal, result: "缺少 kind 或 name。kind 只能是 character、place、event。" };
    }
    const next = normalizeJournal(journal);
    const target = bucket(next, kind);
    if (!(entryName in target)) {
      return { journal, result: `没有${KIND_LABEL[kind]}「${entryName}」，不用删。` };
    }
    delete target[entryName];
    if (kind === "character" && next.portraits?.[entryName]) {
      delete next.portraits[entryName];
      if (Object.keys(next.portraits).length === 0) delete next.portraits;
    }
    // 删掉之后，别人指向它的 where / ref 就成了死链，一并清掉。
    // 注意必须改 next 里的对象：normalizeJournal 造的是新对象，
    // 改原 journal 上的引用不会反映到返回值里。
    for (const list of [next.characters, next.places, next.events]) {
      for (const item of Object.values(list)) {
        if (item.where === entryName) delete item.where;
        if (item.ref?.includes(entryName)) {
          const rest = item.ref.filter((name) => name !== entryName);
          if (rest.length > 0) item.ref = rest;
          else delete item.ref;
        }
      }
    }
    return { journal: next, result: `已忘掉${KIND_LABEL[kind]}「${entryName}」。` };
  }

  const kind = WRITERS[name];
  if (!kind) return { journal, result: "没有这个工具。" };

  const write = args as WriteArgs;
  const entryName = typeof write.name === "string" ? clip(write.name, MAX_NAME) : "";
  const detail = typeof write.detail === "string" ? clip(write.detail, MAX_DETAIL) : "";
  if (!entryName || !detail) return { journal, result: "缺少 name 或 detail。" };

  const next = normalizeJournal(journal);
  const target = bucket(next, kind);
  const existing = target[entryName];
  if (!existing && Object.keys(target).length >= MAX_ENTRIES) {
    return { journal, result: `${KIND_LABEL[kind]}已经记满 ${MAX_ENTRIES} 条，这条没有写入。` };
  }

  const merged: JournalEntry = { ...(existing ?? {}), detail };
  if (typeof write.where === "string" && write.where.trim()) {
    merged.where = clip(write.where, MAX_NAME);
  }
  if (Array.isArray(write.ref)) {
    const refs = write.ref
      .filter((item): item is string => typeof item === "string" && !!item.trim())
      .map((item) => clip(item, MAX_NAME))
      .filter(Boolean);
    if (refs.length > 0) merged.ref = refs.slice(0, MAX_LINK);
  }
  // 没传 turn 就补上当前轮次：目录要能看出哪条最新，也要能认出哪条已经过期
  if (typeof write.turn === "number" && Number.isFinite(write.turn) && write.turn >= 0) {
    merged.turn = Math.floor(write.turn);
  } else if (turn !== undefined && turn >= 0) {
    merged.turn = Math.floor(turn);
  }
  target[entryName] = merged;

  const action = existing ? "已更新" : "已记下";
  return { journal: next, result: `${action}${KIND_LABEL[kind]}「${entryName}」。` };
}

/** 发给 Chat Completions 的工具定义。各家中继按 OpenAI 的 tools 字段接收。 */
export const MEMORY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_memory",
      description: "列出本机 IndexedDB 里这张卡已记下的人物、地点和事件目录。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_memory",
      description: "按类别和名字读取一条本机记忆，包含它的关联项。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["character", "place", "event"] },
          name: { type: "string" },
        },
        required: ["kind", "name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_memory",
      description: "按关键词跨人物、地点、事件搜索本机记忆。不确定名字时用这个。",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember_character",
      description:
        "记下新出现的角色，或更新已有角色的一句话现状。同名再写是更新，不会重复。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
          where: { type: "string", description: "当前所在的地点名，要和已记下的地点同名" },
          ref: {
            type: "array",
            items: { type: "string" },
            description: "相关人物或事件的名字，最多几个",
          },
        },
        required: ["name", "detail"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember_place",
      description: "记下新地点，或更新已有地点的一句话现状。同名再写是更新，不会重复。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
          ref: {
            type: "array",
            items: { type: "string" },
            description: "常驻此地的人物名",
          },
        },
        required: ["name", "detail"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember_event",
      description: "记下值得长期记住的特殊事件。同名再写是更新，不会重复。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
          where: { type: "string", description: "发生的地点名，要和已记下的地点同名" },
          ref: {
            type: "array",
            items: { type: "string" },
            description: "在场的人物名",
          },
        },
        required: ["name", "detail"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "forget_memory",
      description:
        "删掉一条记错或已经没用的记忆，同时清掉别人指向它的关联。记满了要先删再记。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["character", "place", "event"] },
          name: { type: "string" },
        },
        required: ["kind", "name"],
      },
    },
  },
];
