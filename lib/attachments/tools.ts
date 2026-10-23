import type { ChatTool } from "@/lib/providers/types";
import { generateMap, resolveMapGeneration } from "./generation";
import { normalizeAttachment, normalizeAttachments } from "./normalize";
import type {
  CardAttachment,
  CodexAttachment,
  CodexEntry,
  GeneratedMap,
  MapAttachment,
  ScriptAttachment,
} from "./types";

const MAX_RESULT_LENGTH = 3_000;
const MAX_QUERY_LENGTH = 160;

export const ATTACHMENT_QUERY_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "attachment_query",
    description:
      "查询角色卡附件。地图可查摘要或区域，Codex 可按条目或关键词查询，脚本只能查询安全状态；不会执行脚本 source。",
    parameters: {
      type: "object",
      properties: {
        attachmentId: { type: "string", description: "附件 ID" },
        query: { type: "string", description: "Codex 关键词或条目标题" },
        regionId: { type: "string", description: "地图区域 ID" },
      },
      required: ["attachmentId"],
      additionalProperties: false,
    },
  },
};

export const ATTACHMENT_UPDATE_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "attachment_update",
    description:
      "以声明式方式更新地图或 Codex 附件。只接受受限的地图生成配置和 Codex 条目增删改；脚本更新会明确拒绝，绝不执行任意 JavaScript。",
    parameters: {
      type: "object",
      properties: {
        attachmentId: { type: "string", description: "附件 ID" },
        operation: {
          type: "string",
          enum: ["set_map_generation", "upsert_codex_entry", "remove_codex_entry"],
        },
        generation: {
          type: "object",
          description: "set_map_generation 使用的受限地图声明",
        },
        entry: {
          type: "object",
          description: "upsert_codex_entry 使用的 Codex 条目",
        },
        entryId: { type: "string", description: "remove_codex_entry 使用的条目 ID" },
      },
      required: ["attachmentId", "operation"],
      additionalProperties: false,
    },
  },
};

export const ATTACHMENT_TOOLS: ChatTool[] = [ATTACHMENT_QUERY_TOOL, ATTACHMENT_UPDATE_TOOL];

export const ATTACHMENT_TOOL_NAMES = new Set(
  ATTACHMENT_TOOLS.map((tool) => tool.function.name),
);

export interface AttachmentToolContext {
  attachments: CardAttachment[];
  maps?: Record<string, GeneratedMap>;
  state?: Record<string, unknown>;
  startSeed: string;
}

export interface AttachmentToolExecution {
  result: string;
  attachments?: CardAttachment[];
  maps?: Record<string, GeneratedMap>;
  state?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clip(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function jsonResult(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text) return "{}";
  return text.length <= MAX_RESULT_LENGTH ? text : `${text.slice(0, MAX_RESULT_LENGTH)}…`;
}

function attachmentById(attachments: CardAttachment[], value: unknown): CardAttachment | undefined {
  return typeof value === "string" ? attachments.find((attachment) => attachment.id === value) : undefined;
}

function isMapAttachment(value: CardAttachment): value is MapAttachment {
  return value.kind === "map" && isRecord(value.generation) && (value.generation.mode === "DEFAULT" || value.generation.mode === "CUSTOM");
}

function isCodexAttachment(value: CardAttachment): value is CodexAttachment {
  return value.kind === "codex" && Array.isArray(value.entries);
}

function isScriptAttachment(value: CardAttachment): value is ScriptAttachment {
  return value.kind === "script" && typeof value.source === "string";
}

function mapSummary(attachment: MapAttachment, map: GeneratedMap | undefined): Record<string, unknown> {
  return {
    id: attachment.id,
    kind: attachment.kind,
    title: attachment.title ?? "",
    enabled: attachment.enabled !== false,
    generation: attachment.generation,
    ...(map
      ? {
          seed: map.seed,
          fingerprint: map.fingerprint,
          width: map.width,
          height: map.height,
          stats: map.stats,
          regions: map.regions.map((region) => ({ id: region.id, bounds: region.bounds, center: region.center, cellCount: region.cellCount })),
        }
      : {}),
  };
}

function queryCodex(attachment: CodexAttachment, rawQuery: unknown): Record<string, unknown> {
  const query = typeof rawQuery === "string" ? clip(rawQuery, MAX_QUERY_LENGTH).toLocaleLowerCase() : "";
  const entries = attachment.entries.filter((entry) => {
    if (!query) return true;
    return `${entry.id} ${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLocaleLowerCase().includes(query);
  });
  return {
    id: attachment.id,
    kind: attachment.kind,
    title: attachment.title ?? "",
    enabled: attachment.enabled !== false,
    query,
    entries: entries.map((entry) => ({ ...entry, content: entry.content.slice(0, 1_200) })),
  };
}

function queryScript(attachment: ScriptAttachment): Record<string, unknown> {
  return {
    id: attachment.id,
    kind: attachment.kind,
    title: attachment.title ?? "",
    enabled: false,
    runtime: "sandbox",
    status: "unsupported",
    executable: false,
    requestedPermissions: attachment.requestedPermissions,
    permissions: { network: false, filesystem: false, cardScope: true },
    source: "脚本 source 不会提供给工具执行，也不会在应用内运行。",
  };
}

function withOverride(state: Record<string, unknown>, attachments: CardAttachment[]): Record<string, unknown> {
  return { ...state, attachmentOverrides: attachments };
}

function updateMap(
  attachment: MapAttachment,
  rawGeneration: unknown,
  context: AttachmentToolContext,
): AttachmentToolExecution {
  if (!isRecord(rawGeneration)) return { result: "地图更新被拒绝：缺少合法 generation 声明。" };
  const validated = normalizeAttachment({ ...attachment, generation: rawGeneration });
  if (!validated.ok || !isMapAttachment(validated.attachment)) {
    return { result: `地图更新被拒绝：${validated.ok ? "generation 无效" : validated.error}。` };
  }

  try {
    const resolved = resolveMapGeneration(validated.attachment.generation, context.startSeed);
    const map = generateMap(resolved);
    const attachments = context.attachments.map((item) => item.id === attachment.id ? validated.attachment : item);
    return {
      result: `已更新地图「${attachment.id}」，fingerprint=${map.fingerprint}。`,
      attachments,
      maps: { ...(context.maps ?? {}), [attachment.id]: map },
      state: {
        ...withOverride(context.state ?? {}, attachments),
        mapGenerations: { ...((context.state?.mapGenerations as Record<string, unknown> | undefined) ?? {}), [attachment.id]: resolved },
      },
    };
  } catch (error) {
    return { result: `地图更新被拒绝：${error instanceof Error ? error.message : "不支持的生成配置"}。` };
  }
}

function codexEntry(value: unknown): CodexEntry | null {
  if (!isRecord(value)) return null;
  const candidate = {
    id: value.id,
    title: value.title,
    content: value.content,
    tags: value.tags,
    enabled: value.enabled,
  };
  const result = normalizeAttachment({ id: "tool-codex", kind: "codex", entries: [candidate] });
  if (!result.ok || !isCodexAttachment(result.attachment)) return null;
  return result.attachment.entries[0] ?? null;
}

function updateCodex(
  attachment: CodexAttachment,
  args: Record<string, unknown>,
  context: AttachmentToolContext,
): AttachmentToolExecution {
  const operation = args.operation;
  let entries = [...attachment.entries];
  if (operation === "upsert_codex_entry") {
    const entry = codexEntry(args.entry);
    if (!entry) return { result: "Codex 更新被拒绝：entry 必须包含合法 id、title、content。" };
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  } else if (operation === "remove_codex_entry") {
    const entryId = typeof args.entryId === "string" ? clip(args.entryId, 128) : "";
    if (!entryId) return { result: "Codex 删除被拒绝：缺少 entryId。" };
    entries = entries.filter((entry) => entry.id !== entryId);
  } else {
    return { result: "Codex 更新被拒绝：只支持 upsert_codex_entry 或 remove_codex_entry。" };
  }

  const validated = normalizeAttachment({ ...attachment, entries });
  if (!validated.ok || !isCodexAttachment(validated.attachment)) {
    return { result: `Codex 更新被拒绝：${validated.ok ? "entries 无效" : validated.error}。` };
  }
  const attachments = context.attachments.map((item) => item.id === attachment.id ? validated.attachment : item);
  return {
    result: `已更新 Codex「${attachment.id}」，当前 ${validated.attachment.entries.length} 条。`,
    attachments,
    state: withOverride(context.state ?? {}, attachments),
  };
}

export function executeAttachmentTool(
  name: string,
  rawArguments: string,
  context: AttachmentToolContext,
): AttachmentToolExecution {
  const attachments = normalizeAttachments(context.attachments);
  const attachment = attachmentById(attachments, readArguments(rawArguments).attachmentId);
  const args = readArguments(rawArguments);

  if (name === "attachment_query") {
    if (!attachment) return { result: "附件查询失败：找不到 attachmentId。" };
    if (isMapAttachment(attachment)) {
      const map = context.maps?.[attachment.id];
      if (typeof args.regionId === "string" && map) {
        const region = map.regions.find((item) => item.id === args.regionId);
        return { result: region ? jsonResult({ id: attachment.id, kind: "map", region }) : "地图查询失败：找不到该区域。" };
      }
      return { result: jsonResult(mapSummary(attachment, map)) };
    }
    if (isCodexAttachment(attachment)) return { result: jsonResult(queryCodex(attachment, args.query)) };
    if (isScriptAttachment(attachment)) return { result: jsonResult(queryScript(attachment)) };
    return { result: "该附件类型只支持安全的只读查询。" };
  }

  if (name === "attachment_update") {
    if (!attachment) return { result: "附件更新失败：找不到 attachmentId。" };
    if (isScriptAttachment(attachment)) {
      return { result: "脚本附件更新被明确拒绝：不执行任意 JavaScript，也不授予网络或文件系统权限。" };
    }
    if (isMapAttachment(attachment)) return updateMap(attachment, args.generation, context);
    if (isCodexAttachment(attachment)) return updateCodex(attachment, args, context);
    return { result: "该附件类型不支持更新。" };
  }

  return { result: `未知附件工具：${name}。` };
}

export function formatAttachmentCatalog(attachments: CardAttachment[] | undefined): string {
  const normalized = normalizeAttachments(attachments);
  if (normalized.length === 0) return "";
  const lines = normalized.map((attachment) => {
    if (isMapAttachment(attachment)) {
      const mode = attachment.generation.mode === "DEFAULT" ? `preset=${attachment.generation.preset.id}` : "custom";
      return `- map ${attachment.id}${attachment.title ? `（${attachment.title}）` : ""}：${mode}`;
    }
    if (isCodexAttachment(attachment)) {
      const entries = attachment.entries.filter((entry) => entry.enabled).map((entry) => `${entry.id}:${entry.title}`).slice(0, 32);
      return `- codex ${attachment.id}${attachment.title ? `（${attachment.title}）` : ""}：${entries.join("；") || "无启用条目"}`;
    }
    if (isScriptAttachment(attachment)) return `- script ${attachment.id}${attachment.title ? `（${attachment.title}）` : ""}：unsupported，不可执行`;
    return `- ${attachment.kind} ${attachment.id}：只读`;
  });
  return [
    "角色卡附件目录：",
    ...lines,
    "附件查询和更新必须使用 attachment_query / attachment_update 工具。脚本 source 永不执行；脚本更新必须明确拒绝。",
  ].join("\n");
}
