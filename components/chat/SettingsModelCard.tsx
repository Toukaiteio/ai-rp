"use client";

import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Field,
  FieldAction,
  FieldInput,
  FormGroup,
  MenuRow,
  OptChip,
  OptRow,
  SettingsCard,
  SliderRow,
  VaultWarn,
} from "@/components/ui";
import { IconEye, IconPlus, IconTrash, IconX } from "@/components/icons";
import { BROWSER_PROVIDER_ID, probeBrowserModel } from "@/lib/browser-model";
import {
  defaultInterfaceType,
  findProvider,
  getDefaultProvider,
  getProvidersConfig,
  modelName,
  modelSeesImages,
  type ProviderPreset,
} from "@/lib/providers/config";
import {
  effectiveInterfaceType,
  nextCustomProviderId,
  REASONING_EFFORTS,
  type CustomProvider,
  type ProviderConfig,
} from "@/lib/providers/settings";
import { cleanApiKey } from "@/lib/providers/apikey";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";

/* 只从 config / settings 导入，不要从 @/lib/providers 导入：
   那个入口会带出 openai SDK，整个打进浏览器包。 */

/** 设置页「大语言模型」卡片：预设、自定义提供商、协议、地址、Key、模型与采样。 */
export function SettingsModelCard({
  config,
  onChange,
}: {
  config: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    void probeBrowserModel().then((ready) => {
      if (!cancelled) setBrowserReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const browserPreset: ProviderPreset = {
    id: BROWSER_PROVIDER_ID,
    name: t("settings.browser"),
    baseURL: "",
    models: [],
    keyUrl: "",
    docUrl: "",
  };
  const presets = getProvidersConfig().providers;
  const providers = browserReady ? [browserPreset, ...presets] : presets;
  const customProviders = config.customProviders ?? [];
  const selectedCustom = customProviders.find((item) => item.id === config.providerId);
  const browserSelected = browserReady && config.providerId === BROWSER_PROVIDER_ID;
  const reasoningEnabled = config.reasoningEnabled === true;
  const reasoningEffort = config.reasoningEffort ?? "high";
  const interfaceTypes = getProvidersConfig().interfaceTypes;
  const preset = findProvider(config.providerId);
  const activeInterfaceType = effectiveInterfaceType(config);
  // 预设已经定死协议；只有自定义提供商能选。
  const interfaceLocked = Boolean(preset?.interfaceType);

  function patch(next: Partial<ProviderConfig>) {
    onChange({ ...config, ...next });
  }

  /* 粘贴 Key 时常混进全角空格、零宽字符、BOM 或整段中文说明。
     这些字符进不了 HTTP 头，浏览器会在发请求前直接抛错，
     表现却只是「网络请求失败」，所以在这里就说清楚。 */
  const keyJunk = cleanApiKey(config.apiKey).removed;

  function selectPreset(provider: ProviderPreset) {
    const first = provider.models[0];
    patch({
      providerId: provider.id,
      interfaceType: provider.interfaceType ?? defaultInterfaceType(),
      model: modelName(first),
      vision: modelSeesImages(first),
      baseURL: "",
    });
  }

  /** 切回自定义提供商时按条目恢复，Key 和地址不用重填。 */
  function selectCustom(def: CustomProvider) {
    patch({
      providerId: def.id,
      interfaceType: def.interfaceType || defaultInterfaceType(),
      model: def.models[0] ?? "",
      vision: def.vision,
      baseURL: def.baseURL,
      apiKey: def.apiKey,
    });
  }

  function patchCustom(defId: string, update: (def: CustomProvider) => CustomProvider) {
    onChange({
      ...config,
      customProviders: customProviders.map((item) => (item.id === defId ? update(item) : item)),
    });
  }

  function addCustomProvider() {
    const def: CustomProvider = {
      id: nextCustomProviderId(customProviders),
      name: "",
      interfaceType: defaultInterfaceType(),
      baseURL: "",
      apiKey: "",
      models: [],
      vision: false,
    };
    onChange({
      ...config,
      providerId: def.id,
      interfaceType: def.interfaceType,
      model: "",
      vision: false,
      baseURL: "",
      apiKey: "",
      customProviders: [...customProviders, def],
    });
  }

  /** 删除条目；删的是当前选中的这家时回落到默认预设，Key 与普通切换一样保留。 */
  function deleteCustomProvider(def: CustomProvider) {
    const defs = customProviders.filter((item) => item.id !== def.id);
    if (config.providerId !== def.id) {
      onChange({ ...config, customProviders: defs });
      return;
    }
    const fallback = getDefaultProvider();
    const first = fallback.models[0];
    onChange({
      ...config,
      providerId: fallback.id,
      interfaceType: fallback.interfaceType ?? defaultInterfaceType(),
      model: modelName(first),
      vision: modelSeesImages(first),
      baseURL: "",
      customProviders: defs,
    });
  }

  /** 新模型进列表并立即选中；输入一个字符就落一条的事在 withImage 里被刻意避免。 */
  function addCustomModel(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !selectedCustom) return;
    onChange({
      ...config,
      model: trimmed,
      customProviders: customProviders.map((item) =>
        item.id === selectedCustom.id && !item.models.includes(trimmed)
          ? { ...item, models: [...item.models, trimmed] }
          : item,
      ),
    });
    setModelDraft("");
  }

  function removeCustomModel(name: string) {
    if (!selectedCustom) return;
    const models = selectedCustom.models.filter((item) => item !== name);
    onChange({
      ...config,
      ...(config.model === name ? { model: models[0] ?? "" } : {}),
      customProviders: customProviders.map((item) =>
        item.id === selectedCustom.id ? { ...item, models } : item,
      ),
    });
  }

  return (
    <SettingsCard title={t("settings.languageModel")}>
      <FormGroup title={t("settings.provider")}>
        <OptRow>
          {providers.map((provider) => (
            <OptChip
              key={provider.id}
              selected={config.providerId === provider.id}
              onClick={() => {
                if (provider.id === BROWSER_PROVIDER_ID) {
                  patch({ providerId: provider.id, vision: true });
                  return;
                }
                selectPreset(provider);
              }}
              badge={provider.badge === "free" ? t("settings.free") : undefined}
            >
              {provider.name}
            </OptChip>
          ))}
          {customProviders.map((def) => (
            <OptChip
              key={def.id}
              selected={config.providerId === def.id}
              onClick={() => selectCustom(def)}
            >
              {def.name || t("settings.custom")}
            </OptChip>
          ))}
          <OptChip onClick={addCustomProvider}>
            <IconPlus className="size-3.5" aria-hidden="true" />
            {t("settings.addProvider")}
          </OptChip>
        </OptRow>
        {browserSelected ? (
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">{t("settings.browserNote")}</p>
        ) : preset?.keyUrl ? (
          <a
            href={preset.keyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="self-start text-[12.5px] text-ink-2 underline"
          >
            {t("settings.getKey")}
          </a>
        ) : null}
      </FormGroup>

      {selectedCustom ? (
      <FormGroup title={t("settings.providerName")}>
        <Field>
          <FieldInput
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={t("settings.providerNamePlaceholder")}
            value={selectedCustom.name}
            onChange={(event) =>
              patchCustom(selectedCustom.id, (def) => ({ ...def, name: event.target.value }))
            }
          />
        </Field>
      </FormGroup>
      ) : null}

      {browserSelected || preset?.hideEndpoint ? null : (
      <FormGroup title={t("settings.interface")}>
        <OptRow>
          {interfaceTypes.map((type) => (
            <OptChip
              key={type.id}
              selected={type.id === activeInterfaceType}
              disabled={!type.enabled || (interfaceLocked && type.id !== activeInterfaceType)}
              onClick={() => {
                if (!interfaceLocked && type.enabled) patch({ interfaceType: type.id });
              }}
            >
              {type.enabled ? type.name : t("settings.later", { name: type.name })}
            </OptChip>
          ))}
        </OptRow>
      </FormGroup>
      )}

      {browserSelected || preset?.hideEndpoint ? null : (
      <FormGroup title={t("settings.baseUrl")}>
        <Field>
          <FieldInput
            type="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder={preset?.baseURL || "https://api.example.com/v1"}
            value={config.baseURL}
            onChange={(event) => patch({ baseURL: event.target.value })}
          />
          {config.baseURL ? (
            <FieldAction
              aria-label={t("settings.clearUrl")}
              onClick={() => patch({ baseURL: "" })}
            >
              <IconX className="size-[15px]" />
            </FieldAction>
          ) : null}
        </Field>
      </FormGroup>
      )}

      {browserSelected ? null : (
      <FormGroup title="API Key">
        <Field>
          <FieldInput
            type={showKey ? "text" : "password"}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            value={config.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
          <FieldAction
            aria-label={showKey ? t("settings.hideKey") : t("settings.showKey")}
            onClick={() => setShowKey((value) => !value)}
          >
            <IconEye className="size-[17px]" />
          </FieldAction>
        </Field>
        {keyJunk > 0 ? (
          <p className="m-0 text-[12.5px] leading-relaxed">
            <VaultWarn>{t("settings.keyJunk", { count: keyJunk })}</VaultWarn>
          </p>
        ) : null}
      </FormGroup>
      )}

      {browserSelected || preset?.hideModel ? null : (
      <FormGroup title={t("settings.model")}>
        {selectedCustom ? (
          <>
            {selectedCustom.models.length > 0 ? (
              <OptRow>
                {selectedCustom.models.map((name) => (
                  <span key={name} className="relative inline-flex">
                    <OptChip
                      selected={config.model === name}
                      onClick={() => patch({ model: name })}
                    >
                      {selectedCustom.vision ? (
                        <ImageIcon className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                      ) : null}
                      {name}
                    </OptChip>
                    <button
                      type="button"
                      aria-label={t("settings.removeModel", { name })}
                      onClick={() => removeCustomModel(name)}
                      className="absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-pill border border-line bg-surface-3 text-ink-2 transition-colors hover:text-ink"
                    >
                      <IconX className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </OptRow>
            ) : null}
            <Field>
              <FieldInput
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder={t("settings.addModelPlaceholder")}
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                onBlur={() => {
                  if (modelDraft.trim()) addCustomModel(modelDraft);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addCustomModel(modelDraft);
                }}
              />
              <FieldAction aria-label={t("settings.addModel")} onClick={() => addCustomModel(modelDraft)}>
                <IconPlus className="size-[15px]" />
              </FieldAction>            </Field>
          </>
        ) : (
          <>
            {(preset?.models.length ?? 0) > 0 ? (
              <OptRow>
                {preset?.models.map((model) => {
                  const name = modelName(model);
                  const sees = modelSeesImages(model);
                  return (
                    <OptChip
                      key={name}
                      selected={config.model === name}
                      onClick={() => patch({ model: name, vision: sees })}
                    >
                      {sees ? <ImageIcon className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> : null}
                      {name}
                    </OptChip>
                  );
                })}
              </OptRow>
            ) : null}
            <Field>
              <FieldInput
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder={t("settings.modelPlaceholder")}
                value={config.model}
                onChange={(event) => patch({ model: event.target.value })}
              />
            </Field>
          </>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={config.vision}
          onClick={() => patch({ vision: !config.vision })}
          className="flex w-full items-center justify-between rounded-pill border border-line bg-surface px-4 py-2.5 text-[13px] text-ink"
        >
          <span className="inline-flex items-center gap-2">
            {config.vision ? <ImageIcon className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> : null}
            {t("settings.vision")}
          </span>
          <span
            aria-hidden="true"
            className={`flex h-[22px] w-10 shrink-0 items-center justify-start rounded-pill p-0.5 transition-colors duration-200 ease-out motion-reduce:transition-none ${config.vision ? "bg-accent" : "bg-surface-3"}`}
          >
            <span
              className={`size-[18px] rounded-pill shadow-raised ${config.vision ? "bg-accent-ink" : "bg-ink"}`}
              style={{ transform: config.vision ? "translateX(20px)" : "translateX(0px)", transition: "transform 200ms ease" }}
            />
          </span>
        </button>
      </FormGroup>
      )}

      <FormGroup title={t("settings.sampling")}>
        <SliderRow
          label={t("settings.temperature")}
          min={0}
          max={20}
          value={Math.round(config.temperature * 10)}
          display={config.temperature.toFixed(1)}
          onChange={(value) => patch({ temperature: value / 10 })}
        />
      </FormGroup>

      <FormGroup title={t("settings.reasoning")}>
        <button
          type="button"
          role="switch"
          aria-checked={reasoningEnabled}
          onClick={() => patch({
            reasoningEnabled: !reasoningEnabled,
            ...(reasoningEnabled ? {} : { reasoningEffort: "high" }),
          })}
          className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3 text-left text-[13px] text-ink"
        >
          <span>
            <span className="block">{t("settings.reasoningEnabled")}</span>
            <span className="mt-1 block text-[12px] text-ink-2">{t("settings.reasoningHelp")}</span>
          </span>
          <span
            aria-hidden="true"
            className={`flex h-[22px] w-10 shrink-0 items-center rounded-pill p-0.5 ${reasoningEnabled ? "justify-end bg-accent" : "justify-start bg-surface-3"}`}
          >
            <span className={`size-[18px] rounded-pill shadow-raised ${reasoningEnabled ? "bg-accent-ink" : "bg-ink"}`} />
          </span>
        </button>
        {reasoningEnabled ? (
          <OptRow>
            {REASONING_EFFORTS.map((effort) => (
              <OptChip
                key={effort}
                selected={reasoningEffort === effort}
                onClick={() => patch({ reasoningEffort: effort })}
              >
                {t(`settings.reasoningEffort.${effort}` as MessageKey)}
              </OptChip>
            ))}
          </OptRow>
        ) : null}
      </FormGroup>

      {selectedCustom ? (
        <MenuRow
          icon={<IconTrash className="size-[17px]" />}
          tone="danger"
          onClick={() => deleteCustomProvider(selectedCustom)}
        >
          {t("settings.deleteProvider")}
        </MenuRow>
      ) : null}
    </SettingsCard>
  );
}
