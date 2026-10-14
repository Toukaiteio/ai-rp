import {
  CARD_SPEC,
  CARD_SPEC_VERSION,
  type CharacterCard,
  type CharacterCardData,
  type WorldBookEntry,
} from "./types";

export type ParseResult =
  | { ok: true; card: CharacterCard }
  | { ok: false; error: string };

/** V2 定义里我们认的字段。其余的一律塞进 extensions._unmapped，导出时不丢。 */
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "character_book",
  "tags",
  "creator",
  "character_version",
  "extensions",
]);

const UNMAPPED_KEY = "_unmapped";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string");
  return items.length > 0 ? items : undefined;
}

const ENTRY_POSITIONS = new Set([
  "before_char",
  "after_char",
  "before_scene",
  "after_scene",
  "in_chat",
]);

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parsePosition(value: unknown): WorldBookEntry["position"] | undefined {
  if (typeof value === "string" && ENTRY_POSITIONS.has(value)) {
    return value as WorldBookEntry["position"];
  }
  // SillyTavern 用数字位置。只映射对得上的三个，其余不猜。
  if (value === 0) return "before_char";
  if (value === 1) return "after_char";
  if (value === 4) return "in_chat";
  return undefined;
}

function parseEntry(raw: unknown): WorldBookEntry | null {
  if (!isRecord(raw)) return null;
  const content = asString(raw.content);
  if (!content) return null;

  const keys = Array.isArray(raw.keys)
    ? raw.keys.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];

  const entry: WorldBookEntry = { keys, content };
  if (raw.constant === true) entry.constant = true;
  if (raw.logic === "and" || raw.logic === "or") entry.logic = raw.logic;
  const order = asNumber(raw.order) ?? asNumber(raw.insertion_order);
  if (order !== undefined) entry.order = order;
  const position = parsePosition(raw.position);
  if (position) entry.position = position;
  const probability = asNumber(raw.probability);
  if (probability !== undefined) {
    entry.probability = Math.max(0, Math.min(100, probability));
  }
  const scanDepth = asNumber(raw.scanDepth);
  if (scanDepth !== undefined) entry.scanDepth = scanDepth;
  if (raw.cascade === true) entry.cascade = true;
  if (raw.enabled === false) entry.enabled = false;
  return entry;
}

function parseBook(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return undefined;
  const entries = raw.entries
    .map(parseEntry)
    .filter((e): e is WorldBookEntry => e !== null);
  if (entries.length === 0) return undefined;
  const book: NonNullable<CharacterCardData["character_book"]> = { entries };
  const name = asOptionalString(raw.name);
  if (name) book.name = name;
  const scanDepth = asNumber(raw.scanDepth);
  if (scanDepth !== undefined) book.scanDepth = scanDepth;
  const budgetCap = asNumber(raw.budgetCap);
  if (budgetCap !== undefined) book.budgetCap = budgetCap;
  const tokenCap = asNumber(raw.tokenCap);
  if (tokenCap !== undefined) book.tokenCap = tokenCap;
  if (raw.recursiveScan === true) book.recursiveScan = true;
  return book;
}

/**
 * 把任意外来 JSON 收敛成一张 V2 卡。
 * 接受两种形状：完整的 V2 外壳，或者只有 data 字段的裸对象（旧卡与手写卡常见）。
 * 宽松解析，只有 name 是硬要求。
 */
export function parseCharacterCard(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: "不是合法的 JSON 对象" };

  let body: Record<string, unknown>;
  if (isRecord(raw.data)) {
    body = raw.data;
  } else if (typeof raw.name === "string") {
    body = raw;
  } else {
    return { ok: false, error: "既不是 V2 卡（缺 data），也没有 name 字段" };
  }

  const name = asString(body.name).trim();
  if (!name) return { ok: false, error: "缺 name" };

  const unmapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!KNOWN_FIELDS.has(key)) unmapped[key] = value;
  }

  const extensions = isRecord(body.extensions) ? { ...body.extensions } : {};
  if (Object.keys(unmapped).length > 0) {
    extensions[UNMAPPED_KEY] = unmapped;
  }

  const data: CharacterCardData = {
    name,
    description: asString(body.description),
    personality: asString(body.personality),
    scenario: asString(body.scenario),
    first_mes: asString(body.first_mes),
    // 这几个即使为空也照写，导出的字段形状才稳定，来回一次不会少字段
    mes_example: asString(body.mes_example),
    system_prompt: asString(body.system_prompt),
    post_history_instructions: asString(body.post_history_instructions),
    alternate_greetings: asStringArray(body.alternate_greetings) ?? [],
    tags: asStringArray(body.tags) ?? [],
    creator: asString(body.creator),
    character_version: asString(body.character_version),
    extensions,
  };

  // 空世界书没有意义，只有真有条目时才写
  const book = parseBook(body.character_book);
  if (book) data.character_book = book;

  return {
    ok: true,
    card: { spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data },
  };
}

/** 导出用的文件名：角色名做一次文件名安全化。 */
export function cardFileName(card: CharacterCard): string {
  const safe =
    card.data.name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .trim() || "character";
  return `${safe}.json`;
}

export function serializeCard(card: CharacterCard): string {
  return `${JSON.stringify(card, null, 2)}\n`;
}

/** 新建一张空卡，用于「导入」失败时的兜底展示。 */
export function createEmptyCard(name = "新角色"): CharacterCard {
  return {
    spec: CARD_SPEC,
    spec_version: CARD_SPEC_VERSION,
    data: {
      name,
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
    },
  };
}
