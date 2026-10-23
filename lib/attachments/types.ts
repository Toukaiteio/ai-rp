export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export const ATTACHMENTS_NAMESPACE = "ai-rp";
export const ATTACHMENTS_KEY = "attachments";
export const PROCEDURAL_WORLD_GENERATOR_ID = "procedural-world-v1";
export const PROCEDURAL_WORLD_GENERATOR_VERSION = "1";

export type MapPresetId =
  | "earth-simplified"
  | "earth-political"
  | "earth-physical"
  | "earth-oceanic";

export interface MapGeneratorRef {
  id: string;
  version: string;
}

export interface MapPresetRef {
  id: MapPresetId;
  version: string;
}

export interface MapRandomIntegerRule {
  type: "integer";
  min: number;
  max: number;
  step?: number;
}

export interface MapRandomFloatRule {
  type: "float";
  min: number;
  max: number;
  precision?: number;
}

export interface MapRandomChoiceRule {
  type: "choice";
  values: JsonPrimitive[];
}

export interface MapRandomBooleanRule {
  type: "boolean";
  probability?: number;
}

export type MapRandomRule =
  | MapRandomIntegerRule
  | MapRandomFloatRule
  | MapRandomChoiceRule
  | MapRandomBooleanRule;

export type MapParameters = Record<string, JsonValue>;
export type MapRandomRules = Record<string, MapRandomRule>;

export interface DefaultMapGeneration {
  mode: "DEFAULT";
  preset: MapPresetRef;
}

export interface CustomMapGeneration {
  mode: "CUSTOM";
  generator: MapGeneratorRef;
  seed: string;
  parameters?: MapParameters;
  random?: MapRandomRules;
}

export type MapGenerationConfig = DefaultMapGeneration | CustomMapGeneration;

export interface ResolvedMapGeneration {
  mode: MapGenerationConfig["mode"];
  generator: MapGeneratorRef;
  startSeed: string;
  seed: string;
  parameters: MapParameters;
  random: Record<string, JsonPrimitive>;
  fingerprint: string;
  preset?: MapPresetRef;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapCell {
  id: string;
  x: number;
  y: number;
  terrain: "land" | "water";
  regionId: string;
  continentId?: string;
  islandId?: string;
}

export interface MapArea {
  id: string;
  bounds: MapBounds;
  center: MapPoint;
  cellCount: number;
}

export interface GeneratedMapStats {
  width: number;
  height: number;
  totalCells: number;
  landCells: number;
  waterCells: number;
  landRatio: number;
  regionCount: number;
  islandCount: number;
  continentCount: number;
}

export interface GeneratedMap {
  generator: MapGeneratorRef;
  seed: string;
  fingerprint: string;
  width: number;
  height: number;
  grid?: MapCell[][];
  cells: MapCell[];
  regions: MapArea[];
  islands: MapArea[];
  continents: MapArea[];
  stats: GeneratedMapStats;
}

export interface CodexEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
}

export interface AttachmentBase {
  id: string;
  kind: string;
  version: string;
  title?: string;
  enabled?: boolean;
}

export interface MapAttachment extends AttachmentBase {
  kind: "map";
  generation: MapGenerationConfig;
}

export interface CodexAttachment extends AttachmentBase {
  kind: "codex";
  entries: CodexEntry[];
}

export interface ScriptPermissions {
  network: false;
  filesystem: false;
  cardScope: true;
}

export interface ScriptPermissionRequest {
  network: boolean;
  filesystem: boolean;
  cardScope: boolean;
}

export interface ScriptAttachment extends AttachmentBase {
  kind: "script";
  runtime: "sandbox";
  source: string;
  requestedPermissions: ScriptPermissionRequest;
  permissions: ScriptPermissions;
  status: "disabled" | "unsupported";
}

export interface UnknownAttachment extends AttachmentBase {
  kind: string;
  [key: string]: JsonValue | undefined;
}

export type CardAttachment = MapAttachment | CodexAttachment | ScriptAttachment | UnknownAttachment;

export interface CardAttachmentState {
  mapGenerations?: Record<string, ResolvedMapGeneration>;
  attachmentOverrides?: CardAttachment[];
  [key: string]: unknown;
}

export type AttachmentValidationResult =
  | { ok: true; attachment: CardAttachment }
  | { ok: false; error: string };
