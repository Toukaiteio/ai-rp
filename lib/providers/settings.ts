import { DEFAULT_CG_BUDGET, DEFAULT_CG_THRESHOLD, DEFAULT_IMAGE_STYLE, type ImageStyleId } from "@/lib/image";
import { BROWSER_PROVIDER_ID } from "@/lib/browser-model";
import { cleanApiKey } from "./apikey";
import {
  findProvider,
  getDefaultProvider,
  imageProviderForModel,
  listProviders,
  modelName,
  modelSeesImages,
} from "./config";
import { defaultAutoBackupSettings, normalizeAutoBackupSettings, type AutoBackupSettings } from "@/lib/storage/backup";

export const DEFAULT_USER_NAME = "你";

export function normalizeUserName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_USER_NAME;
  const name = value.trim();
  return name || DEFAULT_USER_NAME;
}

export interface ProviderConfig {
  providerId: string;
  model: string;
  /**
   * 加密后存在本机（localStorage 槽位），密钥由用户设定、不落盘。
   * 未解锁时整份配置都读不出来，界面上也不会显示。
   */
  apiKey: string;
  /** 只在「自定义」时需要，预设提供商留空 */
  baseURL: string;
  /** 0 到 2 */
  temperature: number;
  /** 当前选中的模型能不能看图。预设模型会带上，自定义名字靠开关。 */
  vision: boolean;
  /** 生图。model 为空表示没配，界面上的 CG 按钮保持禁用。 */
  image: ImageSettings;
  /** Automatic encrypted archive downloads, persisted in the same encrypted slot. */
  autoBackup: AutoBackupSettings;
  /** Quality gate for generated message blocks and speaker names. */
  qualityGate: boolean;
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
  return {
    ...base,
    ...config,
    providerId,
    model,
    apiKey: config.apiKey ?? "",
    userName: normalizeUserName(config.userName),
    vision:
      migratedModel
        ? modelSeesImages(provider?.models[0])
        : typeof config.vision === "boolean"
        ? config.vision
        : modelSeesImages(provider?.models.find(
            (item) => modelName(item) === model,
          )),
    image: migrateImage(config.image),
    autoBackup: normalizeAutoBackupSettings(config.autoBackup),
    qualityGate: config.qualityGate !== false,
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
    model: modelName(preset.models[0]),
    apiKey: "",
    baseURL: "",
    temperature: 0.9,
    vision: modelSeesImages(preset.models[0]),
    image: defaultImageSettings(),
    autoBackup: defaultAutoBackupSettings(),
    qualityGate: true,
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
