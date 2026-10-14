import { DEFAULT_CG_BUDGET, DEFAULT_CG_THRESHOLD, DEFAULT_IMAGE_STYLE, type ImageStyleId } from "@/lib/image";
import { getDefaultProvider, listProviders } from "./config";

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
  /** 生图。model 为空表示没配，界面上的 CG 按钮保持禁用。 */
  image: ImageSettings;
}

export interface ImageSettings {
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
  return config.image.model.trim().length > 0;
}

/** 旧存档没有 image 字段。补上默认值，避免按钮判断时读到空。 */
export function withImage(config: Partial<ProviderConfig> | null | undefined): ProviderConfig {
  const base = defaultProviderConfig();
  if (!config) return base;
  return {
    ...base,
    ...config,
    apiKey: config.apiKey ?? "",
    image: { ...defaultImageSettings(), ...(config.image ?? {}) },
  };
}

export function defaultProviderConfig(): ProviderConfig {
  const preset = getDefaultProvider();
  return {
    providerId: preset.id,
    model: preset.models[0] ?? "",
    apiKey: "",
    baseURL: "",
    temperature: 0.9,
    image: defaultImageSettings(),
  };
}

/** 界面上可以选的提供商，顺序即 providers.json 里的顺序。 */
export function selectableProviders() {
  return listProviders();
}

/** 已经配好 Key 和模型才能发请求。 */
export function isConfigured(config: ProviderConfig): boolean {
  return config.apiKey.trim().length > 0 && config.model.trim().length > 0;
}

/** 界面上显示用的 Key 摘要。只露前 4 位与长度，够认出来是哪一把，不够还原。 */
export function describeApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  const prefix = trimmed.slice(0, 4);
  return `${prefix}…（${trimmed.length} 位）`;
}
