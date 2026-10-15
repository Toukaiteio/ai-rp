import { describeRoll } from "@/lib/dice";

/**
 * 本机剧情记忆：人物、地点、特殊事件。
 *
 * 存在这张卡的加密槽里（IndexedDB），服务端不留。
 * 模型通过函数调用读写，真正落盘的是浏览器。
 */

const MAX_ENTRIES = 40;
const MAX_NAME = 40;
const MAX_DETAIL = 400;

export interface Journal {
  characters: Record<string, string>;
  places: Record<string, string>;
  events: Record<string, string>;
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

export function normalizeJournal(value: unknown): Journal {
  if (typeof value !== "object" || value === null) return emptyJournal();
  const raw = value as Partial<Journal>;
  return {
    characters: stringMap(raw.characters),
    places: stringMap(raw.places),
    events: stringMap(raw.events),
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = clip(key, MAX_NAME);
    const detail = typeof item === "string" ? clip(item, MAX_DETAIL) : "";
    if (!name || !detail) continue;
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    out[name] = detail;
  }
  return out;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function bucket(journal: Journal, kind: JournalKind): Record<string, string> {
  if (kind === "character") return journal.characters;
  if (kind === "place") return journal.places;
  return journal.events;
}

const KIND_LABEL: Record<JournalKind, string> = {
  character: "人物",
  place: "地点",
  event: "事件",
};

function formatBucket(title: string, entries: Record<string, string>): string {
  const rows = Object.entries(entries);
  if (rows.length === 0) return `${title}\n（无）`;
  return `${title}\n${rows.map(([name, detail]) => `- ${name}：${detail}`).join("\n")}`;
}

/** 放进提示词后部的目录。不进前缀，避免每次记下一条就拆掉缓存。 */
export function formatJournal(journal: Journal | undefined): string {
  const current = journal ?? emptyJournal();
  return [
    "本机记忆目录（IndexedDB，只在这台设备）：",
    formatBucket("人物", current.characters),
    formatBucket("地点", current.places),
    formatBucket("事件", current.events),
    "需要核对细节时调用 list_memory 或 read_memory。出现新人物、新地点或值得记住的事件时，调用 remember_character、remember_place、remember_event。不要把每一句都写进去。",
    "攻击、检定、伤害或任何随机点数，调用 roll_dice，并按它返回的点数写。不要自己编点数，也不要向玩家提起这些工具。",
  ].join("\n");
}

export function formatToolTrace(trace: ToolTrace[]): string {
  if (trace.length === 0) return "";
  const lines = trace.map((item) => `- ${item.name}：${item.result}`);
  return `你刚才调用了本机工具，结果如下：\n${lines.join("\n")}\n请据此继续扮演。掷骰的点数以结果为准，不要改。不要提及工具。`;
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

/** 本机工具的入口。掷骰不改记忆，其余交给记忆目录。 */
export function applyChatTool(
  journal: Journal,
  name: string,
  rawArguments: string,
): { journal: Journal; result: string } {
  if (name === "roll_dice") return { journal, result: describeRoll(rawArguments) };
  return applyMemoryTool(journal, name, rawArguments);
}

/** 执行一次函数调用。返回新目录和给模型看的一句结果。 */
export function applyMemoryTool(
  journal: Journal,
  name: string,
  rawArguments: string,
): { journal: Journal; result: string } {
  const args = readArgs(rawArguments);

  if (name === "list_memory") {
    return { journal, result: formatJournal(journal) };
  }

  if (name === "read_memory") {
    const kind = asKind(args.kind);
    const entryName = typeof args.name === "string" ? clip(args.name, MAX_NAME) : "";
    if (!kind || !entryName) {
      return { journal, result: "缺少 kind 或 name。kind 只能是 character、place、event。" };
    }
    const detail = bucket(journal, kind)[entryName];
    return {
      journal,
      result: detail ? `${KIND_LABEL[kind]}「${entryName}」：${detail}` : `没有${KIND_LABEL[kind]}「${entryName}」。`,
    };
  }

  const writers: Record<string, JournalKind> = {
    remember_character: "character",
    remember_place: "place",
    remember_event: "event",
  };
  const kind = writers[name];
  if (!kind) return { journal, result: "没有这个工具。" };

  const entryName = typeof args.name === "string" ? clip(args.name, MAX_NAME) : "";
  const detail = typeof args.detail === "string" ? clip(args.detail, MAX_DETAIL) : "";
  if (!entryName || !detail) {
    return { journal, result: "缺少 name 或 detail。" };
  }

  const next = normalizeJournal(journal);
  const target = bucket(next, kind);
  if (!(entryName in target) && Object.keys(target).length >= MAX_ENTRIES) {
    return { journal, result: `${KIND_LABEL[kind]}已经记满 ${MAX_ENTRIES} 条，这条没有写入。` };
  }
  target[entryName] = detail;
  return { journal: next, result: `已记下${KIND_LABEL[kind]}「${entryName}」。` };
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
      description: "按类别和名字读取一条本机记忆。",
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
      name: "remember_character",
      description: "记下新出现的角色，或更新已有角色的一句话现状。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
        },
        required: ["name", "detail"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember_place",
      description: "记下新地点，或更新已有地点的一句话现状。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
        },
        required: ["name", "detail"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember_event",
      description: "记下值得长期记住的特殊事件。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
        },
        required: ["name", "detail"],
      },
    },
  },
];
