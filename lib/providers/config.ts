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
  /** 「获取 Key」跳转地址 */
  keyUrl: string;
  docUrl: string;
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
