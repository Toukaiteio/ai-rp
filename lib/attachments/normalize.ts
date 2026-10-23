import { getMapPreset } from "./presets";
import {
  ATTACHMENTS_KEY,
  ATTACHMENTS_NAMESPACE,
  type AttachmentValidationResult,
  type CardAttachment,
  type CodexEntry,
  type CustomMapGeneration,
  type DefaultMapGeneration,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type MapGenerationConfig,
  type MapParameters,
  type MapRandomRule,
  type MapRandomRules,
  type ScriptAttachment,
  type UnknownAttachment,
} from "./types";

const MAX_ATTACHMENTS = 64;
const MAX_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 64;
const MAX_TITLE_LENGTH = 256;
const MAX_PARAMETER_COUNT = 64;
const MAX_RANDOM_COUNT = 32;
const MAX_SEED_LENGTH = 256;
const MAX_SCRIPT_SOURCE_LENGTH = 64 * 1024;
const MAX_CODEX_ENTRIES = 512;
const MAX_CODEX_TEXT_LENGTH = 16 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_ARRAY_LENGTH = 128;
const MAX_JSON_STRING_LENGTH = 4 * 1024;
const MAX_JSON_NUMBER_ABS = 1_000_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_JSON_STRING_LENGTH;
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_JSON_NUMBER_ABS;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (isJsonPrimitive(value)) return true;
  if (depth > MAX_JSON_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_JSON_ARRAY_LENGTH && value.every((item) => isJsonValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.keys(value).length <= MAX_PARAMETER_COUNT &&
      Object.keys(value).every((key) => key.length <= MAX_ID_LENGTH) &&
      Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

function jsonClone<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => jsonClone(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonClone(item)])) as T;
  }
  return value;
}

function parseId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH || !ID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function parseVersion(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_VERSION_LENGTH ? value : null;
}

function parseTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_TITLE_LENGTH ? value : undefined;
}

export function normalizeMapSeed(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SEED_LENGTH ? value : null;
}

function parseJsonObject(value: unknown): MapParameters | null {
  if (!isRecord(value) || Object.keys(value).length > MAX_PARAMETER_COUNT) return null;
  if (!Object.keys(value).every((key) => key.length > 0 && key.length <= MAX_ID_LENGTH)) return null;
  if (!Object.values(value).every((item) => isJsonValue(item))) return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonClone(item as JsonValue)]));
}

function parseNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function normalizeRandomRule(value: unknown): MapRandomRule | null {
  if (!isRecord(value)) return null;
  const type = value.type === "int" || value.type === "integer" ? "integer" : value.type;
  if (type === "integer") {
    const min = parseNumber(value.min, -1_000_000, 1_000_000);
    const max = parseNumber(value.max, -1_000_000, 1_000_000);
    const step = value.step === undefined ? 1 : parseNumber(value.step, 1, 100_000);
    if (min === null || max === null || step === null || !Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(step) || max < min || max - min > 1_000_000) return null;
    return { type: "integer", min, max, ...(step !== 1 ? { step } : {}) };
  }
  if (type === "float") {
    const min = parseNumber(value.min, -1_000_000, 1_000_000);
    const max = parseNumber(value.max, -1_000_000, 1_000_000);
    const precision = value.precision === undefined ? 3 : parseNumber(value.precision, 0, 6);
    if (min === null || max === null || precision === null || !Number.isInteger(precision) || max < min || max - min > 1_000_000) return null;
    return { type: "float", min, max, ...(precision !== 3 ? { precision } : {}) };
  }
  if (type === "choice") {
    if (!Array.isArray(value.values) || value.values.length === 0 || value.values.length > 32 || !value.values.every((item) => isJsonPrimitive(item))) return null;
    return { type: "choice", values: value.values.map((item) => item as JsonPrimitive) };
  }
  if (type === "boolean") {
    const probability = value.probability === undefined ? 0.5 : parseNumber(value.probability, 0, 1);
    if (probability === null) return null;
    return { type: "boolean", ...(probability !== 0.5 ? { probability } : {}) };
  }
  return null;
}

function parseRandom(value: unknown, parameters: MapParameters): MapRandomRules | null {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > MAX_RANDOM_COUNT) return null;
  const rules: Record<string, MapRandomRule> = {};
  for (const [key, rawRule] of Object.entries(value)) {
    if (!key || key.length > MAX_ID_LENGTH || Object.prototype.hasOwnProperty.call(parameters, key)) return null;
    const rule = normalizeRandomRule(rawRule);
    if (!rule) return null;
    rules[key] = rule;
  }
  return rules;
}

function parseGeneration(value: unknown): MapGenerationConfig | null {
  if (!isRecord(value)) return null;
  if (value.mode === "DEFAULT") {
    const rawPreset = isRecord(value.preset) ? value.preset : value;
    const id = parseId(rawPreset.id ?? rawPreset.presetId) as string | null;
    const version = parseVersion(rawPreset.version ?? rawPreset.presetVersion);
    if (!id || !version || !getMapPreset(id, version)) return null;
    return { mode: "DEFAULT", preset: { id: id as DefaultMapGeneration["preset"]["id"], version } };
  }
  if (value.mode === "CUSTOM") {
    const rawGenerator = isRecord(value.generator) ? value.generator : value;
    const id = parseId(rawGenerator.id ?? rawGenerator.generatorId);
    const version = parseVersion(rawGenerator.version ?? rawGenerator.generatorVersion);
    const seed = normalizeMapSeed(value.seed);
    if (!id || !version || seed === null) return null;
    const parameters = parseJsonObject(value.parameters ?? {});
    if (!parameters) return null;
    const random = parseRandom(value.random, parameters);
    if (!random) return null;
    const result: CustomMapGeneration = { mode: "CUSTOM", generator: { id, version }, seed, parameters };
    if (Object.keys(random).length > 0) result.random = random;
    return result;
  }
  return null;
}

function parseBase(raw: Record<string, unknown>): { id: string; version: string; title?: string; enabled?: boolean } | null {
  const id = parseId(raw.id);
  const version = parseVersion(raw.version ?? "1");
  if (!id || !version) return null;
  const title = parseTitle(raw.title);
  return { id, version, ...(title === undefined ? {} : { title }), ...(raw.enabled === false ? { enabled: false } : {}) };
}

function normalizeMap(raw: Record<string, unknown>): AttachmentValidationResult {
  const base = parseBase(raw);
  const generation = parseGeneration(raw.generation);
  if (!base || !generation) return { ok: false, error: "map attachment 无效" };
  return { ok: true, attachment: { ...base, kind: "map", generation } };
}

function normalizeCodex(raw: Record<string, unknown>): AttachmentValidationResult {
  const base = parseBase(raw);
  if (!base || !Array.isArray(raw.entries) || raw.entries.length > MAX_CODEX_ENTRIES) return { ok: false, error: "codex attachment 无效" };
  const entries: CodexEntry[] = [];
  for (const item of raw.entries) {
    if (!isRecord(item)) return { ok: false, error: "codex entry 无效" };
    const id = parseId(item.id);
    const title = typeof item.title === "string" && item.title.length <= MAX_TITLE_LENGTH ? item.title : null;
    const content = typeof item.content === "string" && item.content.length <= MAX_CODEX_TEXT_LENGTH ? item.content : null;
    const tags = Array.isArray(item.tags) && item.tags.length <= 32 && item.tags.every((tag) => typeof tag === "string" && tag.length <= MAX_TITLE_LENGTH) ? item.tags : [];
    if (!id || title === null || content === null) return { ok: false, error: "codex entry 无效" };
    entries.push({ id, title, content, tags, enabled: item.enabled !== false });
  }
  return { ok: true, attachment: { ...base, kind: "codex", entries } };
}

function normalizeScript(raw: Record<string, unknown>): AttachmentValidationResult {
  const base = parseBase(raw);
  const source = typeof raw.source === "string" && raw.source.length <= MAX_SCRIPT_SOURCE_LENGTH ? raw.source : null;
  if (!base || source === null) return { ok: false, error: "script attachment 无效" };
  const rawRequests = isRecord(raw.requestedPermissions)
    ? raw.requestedPermissions
    : isRecord(raw.permissions)
      ? raw.permissions
      : {};
  const attachment: ScriptAttachment = {
    ...base,
    kind: "script",
    runtime: "sandbox",
    source,
    requestedPermissions: {
      network: rawRequests.network === true,
      filesystem: rawRequests.filesystem === true,
      cardScope: rawRequests.cardScope !== false,
    },
    permissions: { network: false, filesystem: false, cardScope: true },
    status: "unsupported",
    enabled: false,
  };
  return { ok: true, attachment };
}

function normalizeUnknown(raw: Record<string, unknown>): AttachmentValidationResult {
  const base = parseBase(raw);
  const kind = typeof raw.kind === "string" && raw.kind.length > 0 && raw.kind.length <= MAX_ID_LENGTH ? raw.kind : null;
  if (!base || !kind || !isJsonValue(raw)) return { ok: false, error: "unknown attachment 无效" };
  const attachment: UnknownAttachment = { ...(jsonClone(raw as JsonObject) as UnknownAttachment), ...base, kind };
  return { ok: true, attachment };
}

export function normalizeAttachment(raw: unknown): AttachmentValidationResult {
  if (!isRecord(raw) || typeof raw.kind !== "string") return { ok: false, error: "attachment 必须是对象" };
  if (raw.kind === "map") return normalizeMap(raw);
  if (raw.kind === "codex") return normalizeCodex(raw);
  if (raw.kind === "script") return normalizeScript(raw);
  return normalizeUnknown(raw);
}

export function validateAttachment(raw: unknown): AttachmentValidationResult {
  return normalizeAttachment(raw);
}

export function normalizeAttachments(raw: unknown): CardAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ATTACHMENTS).map(normalizeAttachment).filter((result): result is { ok: true; attachment: CardAttachment } => result.ok).map((result) => result.attachment);
}

export function normalizeMapGeneration(raw: unknown): MapGenerationConfig | null {
  return parseGeneration(raw);
}

export function normalizeMapRandomRules(raw: unknown, parameters: MapParameters = {}): MapRandomRules | null {
  return parseRandom(raw, parameters);
}

export function normalizeAttachmentNamespace(raw: unknown): Record<string, JsonValue> | null {
  if (!isRecord(raw)) return null;
  const namespace = isJsonValue(raw) ? (jsonClone(raw as JsonObject) as Record<string, JsonValue>) : {};
  if (Array.isArray(raw[ATTACHMENTS_KEY])) namespace[ATTACHMENTS_KEY] = normalizeAttachments(raw[ATTACHMENTS_KEY]) as unknown as JsonValue;
  return namespace;
}

export { ATTACHMENTS_KEY, ATTACHMENTS_NAMESPACE };
