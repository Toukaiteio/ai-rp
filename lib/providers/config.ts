import rawConfig from "@/data/providers.json";

/** 预设里的一个模型。旧数据可能只是名字字符串。 */
export type ProviderModel = string | { id: string; vision?: boolean };

export function modelName(model: ProviderModel | undefined): string {
  if (!model) return "";
  return typeof model === "string" ? model : model.id;
}

export function modelSeesImages(model: ProviderModel | undefined): boolean {
  return typeof model === "object" && !!model && model.vision === true;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  models: ProviderModel[];
  /** 这个预设固定的接口协议。自定义提供商留空，由用户选择。 */
  interfaceType?: string;
  /** 这个提供商自己的生图模型。选中后沿用它的 Base URL，不再另配一套。 */
  imageModels?: string[];
  /** 地址和接口类型已经定死，设置页不再展示这两项。 */
  hideEndpoint?: boolean;
  /** 模型已经定死，设置页不再展示模型选择。 */
  hideModel?: boolean;
  /** 已下线的模型名。旧配置命中后迁移到 models[0]。 */
  deprecatedModels?: string[];
  /** 预设角标。free 表示免费额度，界面上画红底白字。 */
  badge?: "free";
  /** 「获取 Key」跳转地址 */
  keyUrl: string;
  docUrl: string;
}

/**
 * 预设已经定死的项，请求里不要再用用户以前填过的覆盖值。
 * 地址留空就会走 providers.json。模型用预设的第一个。
 */
export function presetChat(config: {
  providerId: string;
  model: string;
  baseURL: string;
}): { model: string; baseURL: string; vision: boolean | undefined } {
  const preset = findProvider(config.providerId);
  const locked = preset?.hideModel ? preset.models[0] : undefined;
  return {
    model: locked ? modelName(locked) || config.model : config.model,
    baseURL: preset?.hideEndpoint ? "" : config.baseURL.trim(),
    vision: locked ? modelSeesImages(locked) : undefined,
  };
}

/** 生图模型属于哪个预设。没有就不是预设自带的，继续用当前对话提供商。 */
export function imageProviderForModel(model: string): ProviderPreset | undefined {
  const name = model.trim();
  if (!name) return undefined;
  return config.providers.find((provider) => provider.imageModels?.includes(name));
}

export interface InterfaceType {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ProvidersConfig {
  version: number;
  defaultProviderId: string;
  defaultInterfaceType: string;
  providers: ProviderPreset[];
  interfaceTypes: InterfaceType[];
}

const config = rawConfig as ProvidersConfig;

export function getProvidersConfig(): ProvidersConfig {
  return config;
}

export function listProviders(): ProviderPreset[] {
  return config.providers;
}

export function findProvider(id: string): ProviderPreset | undefined {
  return config.providers.find((p) => p.id === id);
}

export function getDefaultProvider(): ProviderPreset {
  const found = findProvider(config.defaultProviderId);
  if (!found) {
    throw new Error(
      `providers.json 里的 defaultProviderId "${config.defaultProviderId}" 不存在`,
    );
  }
  return found;
}

export function defaultInterfaceType(): string {
  return config.defaultInterfaceType;
}

export function findInterfaceType(id: string | undefined): InterfaceType | undefined {
  return id ? config.interfaceTypes.find((type) => type.id === id) : undefined;
}

/** 只有显式标为 enabled 的协议才允许被请求使用。 */
export function isInterfaceTypeEnabled(id: string | undefined): boolean {
  return findInterfaceType(id)?.enabled === true;
}

/**
 * 这次请求实际用哪个协议。
 *
 * 预设已经定死协议（Anthropic 只能走 Messages），自定义提供商看用户选择；
 * 选了被关掉的协议时退回默认。旧客户端只传 providerId 时仍按预设推断。
 */
export function resolveInterfaceType(providerId: string, requested?: string): string {
  const preset = findProvider(providerId);
  if (preset?.interfaceType && isInterfaceTypeEnabled(preset.interfaceType)) {
    return preset.interfaceType;
  }
  if (typeof requested === "string" && isInterfaceTypeEnabled(requested)) {
    return requested;
  }
  if (
    (providerId === "anthropic" || providerId === "anthropic-messages") &&
    isInterfaceTypeEnabled("anthropic-messages")
  ) {
    return "anthropic-messages";
  }
  return defaultInterfaceType();
}
