import { DEFAULT_CG_BUDGET, DEFAULT_CG_THRESHOLD, DEFAULT_IMAGE_STYLE, type ImageStyleId } from "@/lib/image";
import { BROWSER_PROVIDER_ID } from "@/lib/browser-model";
import { cleanApiKey } from "./apikey";
import {
  defaultInterfaceType,
  findProvider,
  getDefaultProvider,
  imageProviderForModel,
  isInterfaceTypeEnabled,
  listProviders,
  modelName,
  modelSeesImages,
  resolveInterfaceType,
} from "./config";
import { defaultAutoBackupSettings, normalizeAutoBackupSettings, type AutoBackupSettings } from "@/lib/storage/backup";
import { isReasoningEffort, type ReasoningEffort } from "./types";

export { REASONING_EFFORTS, type ReasoningEffort } from "./types";

export const DEFAULT_USER_NAME = "你";

export function normalizeUserName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_USER_NAME;
  const name = value.trim();
  return name || DEFAULT_USER_NAME;
}

/**
 * 这次请求实际用哪个接口协议。
 *
 * 预设已经定死协议（Anthropic 只能走 Messages），自定义提供商才看用户选择；
 * 选了一个被 providers.json 关掉的协议时退回默认，避免请求发到不存在的实现。
 */
export function effectiveInterfaceType(config: {
  providerId: string;
  interfaceType?: string;
}): string {
  return resolveInterfaceType(config.providerId, config.interfaceType);
}

/**
 * 浏览器直连只实现了 Chat Completions 的 SSE。
 * Anthropic Messages、OpenAI Responses 都统一走服务端适配器，
 * 不在浏览器里对这两种协议发一次注定失败的请求。
 */
export function needsServerAdapter(config: {
  providerId: string;
  interfaceType?: string;
}): boolean {
  return effectiveInterfaceType(config) !== "chat-completions";
}

/** 用户自建的提供商，随这份加密配置一起存，在设置页与预设并列。 */
export interface CustomProvider {
  /** 旧「自定义」槽位迁移而来的一条固定叫 "custom"，新建的依次是 custom-2、custom-3… */
  id: string;
  /** 空名字在界面上回退显示本地化的「自定义」。 */
  name: string;
  interfaceType: string;
  baseURL: string;
  /** 每家自带 Key，切走再切回不用重填。 */
  apiKey: string;
  /** 模型名列表，由设置页显式增删。 */
  models: string[];
  /** 整家一个开关：这些模型能不能看图。 */
  vision: boolean;
}

/** 给新建的自定义提供商挑一个不与现有条目和预设冲突的 id。 */
export function nextCustomProviderId(existing: CustomProvider[]): string {
  const used = new Set([
    ...existing.map((item) => item.id),
    ...listProviders().map((item) => item.id),
  ]);
  for (let index = 1; ; index += 1) {
    const id = index === 1 ? "custom" : `custom-${index}`;
    if (!used.has(id)) return id;
  }
}

function normalizeCustomProviders(value: CustomProvider[] | undefined): CustomProvider[] {
  if (!value?.length) return [];
  return value
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id,
      name: typeof item.name === "string" ? item.name : "",
      interfaceType: isInterfaceTypeEnabled(item.interfaceType)
        ? item.interfaceType
        : defaultInterfaceType(),
      baseURL: typeof item.baseURL === "string" ? item.baseURL : "",
      apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
      models: Array.isArray(item.models)
        ? item.models.filter((name) => typeof name === "string" && name.trim().length > 0)
        : [],
      vision: item.vision === true,
    }));
}

/**
 * 自定义条目与顶层字段的同步。顶层字段是当前生效值，条目只负责保存与恢复：
 * 旧存档的 providerId 还是遗留的 "custom" 时，用顶层字段建出第一条；
 * 选中的是自定义条目时，把顶层协议 / 地址 / Key / 看图开关回写进条目。
 * 模型列表不在这里回写，避免逐字输入留下半截名字。
 */
function syncCustomProviders(
  defs: CustomProvider[],
  live: {
    providerId: string;
    interfaceType: string;
    model: string;
    apiKey: string;
    baseURL: string;
    vision: boolean;
  },
): CustomProvider[] {
  let next = defs;
  if (live.providerId === "custom" && !defs.some((item) => item.id === "custom")) {
    next = [
      ...defs,
      {
        id: "custom",
        name: "",
        interfaceType: live.interfaceType,
        baseURL: live.baseURL,
        apiKey: live.apiKey,
        models: live.model.trim() ? [live.model.trim()] : [],
        vision: live.vision,
      },
    ];
  }
  const index = next.findIndex((item) => item.id === live.providerId);
  if (index < 0) return next;
  return next.map((item, position) =>
    position === index
      ? {
          ...item,
          interfaceType: live.interfaceType,
          baseURL: live.baseURL,
          apiKey: live.apiKey,
          vision: live.vision,
        }
      : item,
  );
}

export interface ProviderConfig {
  providerId: string;
  /**
   * 请求使用的接口协议。预设提供商固定，自定义提供商由用户选择。
   * 旧存档没有这个字段时按提供商预设或默认协议补齐。
   */
  interfaceType?: string;
  model: string;
  /**
   * 加密后存在本机（localStorage 槽位），密钥由用户设定、不落盘。
   * 未解锁时整份配置都读不出来，界面上也不会显示。
   */
  apiKey: string;
  /** 只在自定义提供商时需要，预设提供商留空 */
  baseURL: string;
  /** 用户自建的提供商。顶层字段是当前生效值，这里保存全部自定义条目。 */
  customProviders?: CustomProvider[];
  /** 0 到 2 */
  temperature: number;
  /** Whether to send a reasoning effort to the selected provider. */
  reasoningEnabled?: boolean;
  /** Selected reasoning effort when reasoning is enabled. */
  reasoningEffort?: ReasoningEffort;
  /** 当前选中的模型能不能看图。预设模型会带上，自定义名字靠开关。 */
  vision: boolean;
  /** 生图。model 为空表示没配，界面上的 CG 按钮保持禁用。 */
  image: ImageSettings;
  /** Automatic encrypted archive downloads, persisted in the same encrypted slot. */
  autoBackup: AutoBackupSettings;
  /** Randomly wraps words in new player messages as marked UTF-8 Base64. */
  encodeUserMessageWords: boolean;
  /** Name used for the player in prompts and character-card previews. */
  userName: string;
  /** Story pacing systems. Missing fields in old vaults default to enabled. */
  storySystems?: StorySystemSettings;
}

export interface StorySystemSettings {
  events: boolean;
  goals: boolean;
  /** Start suggesting a gentle event after this many quiet turns. */
  eventAfterTurns: number;
}

export function defaultStorySystemSettings(): StorySystemSettings {
  return { events: true, goals: true, eventAfterTurns: 4 };
}

export interface ImageSettings {
  /**
   * 选中的生图预设：提供商 id、"custom"（自己填）或空（关）。
   * 选了提供商预设，模型名也一起定死：model 存的就是它第一个生图模型。
   */
  providerId: string;
  model: string;
  /** 空则沿用对话的 Base URL */
  baseURL: string;
  /** 空则沿用对话的 Key */
  apiKey: string;
  styleId: ImageStyleId;
  /** 自动生图，默认关 */
  auto: boolean;
  /** 每场会话最多几张 */
  budget: number;
  /** 0 到 10，达到才自动生图 */
  threshold: number;
}

export function defaultImageSettings(): ImageSettings {
  return {
    providerId: "",
    model: "",
    baseURL: "",
    apiKey: "",
    styleId: DEFAULT_IMAGE_STYLE,
    auto: false,
    budget: DEFAULT_CG_BUDGET,
    threshold: DEFAULT_CG_THRESHOLD,
  };
}

export function isImageConfigured(config: ProviderConfig): boolean {
  if (!config.image.providerId) return false;
  return config.image.model.trim().length > 0;
}

/** 生图请求该按哪个提供商取地址。自定义或旧存档没有提供商时，按模型名回查。 */
export function imageProviderId(config: ProviderConfig): string {
  const selected = config.image.providerId;
  if (selected && selected !== "custom") return selected;
  return imageProviderForModel(config.image.model)?.id ?? config.providerId;
}

/** 旧存档只有 model，没有 providerId。按模型名认回提供商，认不出就是自定义。 */
function migrateImage(value: Partial<ImageSettings> | undefined): ImageSettings {
  const merged: ImageSettings = { ...defaultImageSettings(), ...(value ?? {}) };
  if (value && !("providerId" in value)) {
    merged.providerId = merged.model
      ? imageProviderForModel(merged.model)?.id ?? "custom"
      : "";
  }
  return merged;
}

/** 旧存档没有 image 字段。补上默认值，避免按钮判断时读到空。 */
export function withImage(config: Partial<ProviderConfig> | null | undefined): ProviderConfig {
  const base = defaultProviderConfig();
  if (!config) return base;
  const providerId = config.providerId ?? base.providerId;
  const provider = findProvider(providerId);
  const storedModel = config.model ?? base.model;
  const model = provider?.deprecatedModels?.includes(storedModel)
    ? modelName(provider.models[0]) || storedModel
    : storedModel;
  const migratedModel = model !== storedModel;
  const interfaceType = effectiveInterfaceType({
    providerId,
    interfaceType: config.interfaceType,
  });
  const vision = migratedModel
    ? modelSeesImages(provider?.models[0])
    : typeof config.vision === "boolean"
      ? config.vision
      : modelSeesImages(provider?.models.find(
          (item) => modelName(item) === model,
        ));
  const apiKey = config.apiKey ?? "";
  return {
    ...base,
    ...config,
    providerId,
    interfaceType,
    model,
    apiKey,
    reasoningEnabled: config.reasoningEnabled === true,
    reasoningEffort: isReasoningEffort(config.reasoningEffort) ? config.reasoningEffort : "high",
    userName: normalizeUserName(config.userName),
    vision,
    customProviders: syncCustomProviders(
      normalizeCustomProviders(config.customProviders),
      {
        providerId,
        interfaceType,
        model,
        apiKey,
        baseURL: config.baseURL ?? "",
        vision,
      },
    ),
    image: migrateImage(config.image),
    autoBackup: normalizeAutoBackupSettings(config.autoBackup),
    encodeUserMessageWords: config.encodeUserMessageWords === true,
    storySystems: {
      ...defaultStorySystemSettings(),
      ...(config.storySystems ?? {}),
      eventAfterTurns:
        typeof config.storySystems?.eventAfterTurns === "number"
          ? Math.max(2, Math.min(8, Math.round(config.storySystems.eventAfterTurns)))
          : defaultStorySystemSettings().eventAfterTurns,
    },
  };
}

export function defaultProviderConfig(): ProviderConfig {
  const preset = getDefaultProvider();
  return {
    providerId: preset.id,
    interfaceType: preset.interfaceType ?? defaultInterfaceType(),
    model: modelName(preset.models[0]),
    apiKey: "",
    baseURL: "",
    customProviders: [],
    temperature: 0.9,
    reasoningEnabled: false,
    reasoningEffort: "high",
    vision: modelSeesImages(preset.models[0]),
    image: defaultImageSettings(),
    autoBackup: defaultAutoBackupSettings(),
    encodeUserMessageWords: false,
    userName: DEFAULT_USER_NAME,
    storySystems: defaultStorySystemSettings(),
  };
}

/** 界面上可以选的提供商，顺序即 providers.json 里的顺序。 */
export function selectableProviders() {
  return listProviders();
}

/** 已经配好 Key 和模型才能走远程接口。判断用的是清洗后的 Key。 */
export function isConfigured(config: ProviderConfig): boolean {
  return cleanApiKey(config.apiKey).value.length > 0 && config.model.trim().length > 0;
}

/**
 * 浏览器里的 LanguageModel 已经能响应时：
 * 选了「浏览器原生」，或者还没填 Key，就用它，不再催着去配提供商。
 *
 * 只看清洗后的 Key：整段粘错（比如粘进来一句中文）等于没填 Key，
 * 这时应该照旧回退到本机模型，而不是卡在「已配置」却发不出去。
 */
export function usesBrowserModel(config: ProviderConfig, browserReady: boolean): boolean {
  if (!browserReady) return false;
  if (config.providerId === BROWSER_PROVIDER_ID) return true;
  return cleanApiKey(config.apiKey).value.length === 0;
}

export function canSend(config: ProviderConfig, browserReady: boolean): boolean {
  return usesBrowserModel(config, browserReady) || isConfigured(config);
}

/** 界面上显示用的 Key 摘要。只露前 4 位与长度，够认出来是哪一把，不够还原。 */
export function describeApiKey(key: string): string {
  const trimmed = cleanApiKey(key).value;
  if (!trimmed) return "";
  const prefix = trimmed.slice(0, 4);
  return `${prefix}…（${trimmed.length} 位）`;
}
