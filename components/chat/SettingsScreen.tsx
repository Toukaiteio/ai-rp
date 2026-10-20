"use client";

import { ChevronDown, Image as ImageIcon, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BackPill,
  Field,
  FieldAction,
  FieldInput,
  FormGroup,
  MenuRow,
  OptChip,
  OptRow,
  PillButton,
  ScreenHead,
  SliderRow,
  VaultWarn,
} from "@/components/ui";
import { IconDownload, IconEye, IconLock, IconTrash, IconX } from "@/components/icons";
import { BROWSER_PROVIDER_ID, probeBrowserModel } from "@/lib/browser-model";
import {
  getProvidersConfig,
  findProvider,
  listProviders,
  modelName,
  modelSeesImages,
  type ProviderPreset,
} from "@/lib/providers/config";
import { IMAGE_STYLES } from "@/lib/image";
import { defaultImageSettings, defaultStorySystemSettings, type ImageSettings, type ProviderConfig } from "@/lib/providers/settings";
import { cleanApiKey } from "@/lib/providers/apikey";
import { hasMessage } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";
import { useTheme } from "@/lib/use-theme";
import type { MessageKey } from "@/lib/i18n";
import { BACKUP_INTERVAL_HOURS } from "@/lib/storage/backup";
import { getUnfiltered, getUnfilteredServerSnapshot, setUnfiltered, subscribeUnfiltered } from "@/lib/cards/unfiltered";
import { hasNativeFilePicker, isAndroidApp, pickNativeFile } from "@/lib/storage/native";

/* 只从 config / settings 导入，不要从 @/lib/providers 导入：
   那个入口会带出 openai SDK，整个打进浏览器包。 */

/** 能生图的预设才出现在生图这一栏。没有生图模型的不给入口。 */
function imageProviders(): ProviderPreset[] {
  return listProviders().filter((provider) => (provider.imageModels?.length ?? 0) > 0);
}

export function SettingsScreen({
  config,
  onChange,
  onLock,
  onWipe,
  onBack,
  onExport,
  onImport,
  archiveBusy,
  archiveMessage,
}: {
  config: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  onLock: () => void;
  onWipe: () => Promise<void>;
  onBack: () => void;
  onExport?: () => void;
  onImport?: (file: File | undefined) => void;
  archiveBusy?: boolean;
  archiveMessage?: string | null;
}) {
  const [showKey, setShowKey] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "model" | "image" | "story" | "data">("general");
  const fileRef = useRef<HTMLInputElement>(null);
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const unfiltered = useSyncExternalStore(subscribeUnfiltered, getUnfiltered, getUnfilteredServerSnapshot);

  useEffect(() => {
    let cancelled = false;
    void probeBrowserModel().then((ready) => {
      if (!cancelled) setBrowserReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseArchiveFile() {
    setFileError(null);
    if (!isAndroidApp()) {
      fileRef.current?.click();
      return;
    }
    if (!hasNativeFilePicker()) {
      setFileError(t("native.filePickerUnavailable"));
      return;
    }
    try {
      onImport?.(await pickNativeFile("application/json,.json") ?? undefined);
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : t("native.filePickerUnavailable"));
    }
  }

  const remoteProviders = getProvidersConfig().providers;
  const browserPreset: ProviderPreset = {
    id: BROWSER_PROVIDER_ID,
    name: t("settings.browser"),
    baseURL: "",
    models: [],
    keyUrl: "",
    docUrl: "",
  };
  const providers = browserReady ? [browserPreset, ...remoteProviders] : remoteProviders;
  const browserSelected = browserReady && config.providerId === BROWSER_PROVIDER_ID;
  const interfaceTypes = getProvidersConfig().interfaceTypes;
  const preset = findProvider(config.providerId);

  function patch(next: Partial<ProviderConfig>) {
    onChange({ ...config, ...next });
  }

  const image = config.image ?? defaultImageSettings();
  const storySystems = config.storySystems ?? defaultStorySystemSettings();

  /* 粘贴 Key 时常混进全角空格、零宽字符、BOM 或整段中文说明。
     这些字符进不了 HTTP 头，浏览器会在发请求前直接抛错，
     表现却只是「网络请求失败」，所以在这里就说清楚。 */
  const keyJunk = cleanApiKey(config.apiKey).removed;
  const imageKeyJunk = cleanApiKey(image.apiKey).removed;

  function patchImage(next: Partial<ImageSettings>) {
    patch({ image: { ...image, ...next } });
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background px-5">
      {/* 和对话页同一条 660 栏：外层同样的内边距，里层居中同宽 */}
      <div className="mx-auto w-full max-w-[660px] py-8">
        <ScreenHead
          title={t("settings.title")}
          action={<BackPill onClick={onBack}>{t("settings.back")}</BackPill>}
        />

        <div className="mb-6 flex gap-1 overflow-x-auto rounded-pill border border-line bg-surface-2 p-1">
          {(["general", "model", "image", "story", "data"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 whitespace-nowrap rounded-pill px-3 py-2 text-center text-[12px] transition-colors ${activeTab === tab ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-3"}`}
            >
              {t(`settings.tab.${tab}` as MessageKey)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-7">
          {activeTab === "general" ? <>
          <FormGroup title={t("settings.language")}>
            <OptRow>
              <OptChip selected={locale === "zh"} onClick={() => setLocale("zh")}>
                中文
              </OptChip>
              <OptChip selected={locale === "en"} onClick={() => setLocale("en")}>
                English
              </OptChip>
            </OptRow>
          </FormGroup>

          {/* 主题只换令牌取值，画面结构不变；和语言一样不进加密存储 */}
          <FormGroup title={t("settings.appearance")}>
            <OptRow>
              <OptChip selected={theme === "dark"} onClick={() => setTheme("dark")}>
                <Moon className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                {t("settings.themeDark")}
              </OptChip>
              <OptChip selected={theme === "light"} onClick={() => setTheme("light")}>
                <Sun className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                {t("settings.themeLight")}
              </OptChip>
            </OptRow>
          </FormGroup>

          <FormGroup title={t("settings.networkContent")}>
            <button
              type="button"
              role="switch"
              aria-checked={unfiltered}
              onClick={() => setUnfiltered(!unfiltered)}
              className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3 text-left text-[13px] text-ink"
            >
              <span>
                <span className="block">{t("settings.unfiltered")}</span>
                <span className="mt-1 block text-[12px] text-ink-2">{t("settings.unfilteredHelp")}</span>
              </span>
              <span aria-hidden="true" className={`flex h-[22px] w-10 shrink-0 items-center rounded-pill p-0.5 ${unfiltered ? "justify-end bg-accent" : "justify-start bg-surface-3"}`}>
                <span className={`size-[18px] rounded-pill shadow-raised ${unfiltered ? "bg-accent-ink" : "bg-ink"}`} />
              </span>
            </button>
          </FormGroup>

          </> : null}

          {activeTab === "model" ? <SettingsCard title={t("settings.languageModel")}>
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
                    const first = provider.models[0];
                    patch({
                      providerId: provider.id,
                      model: modelName(first),
                      vision: modelSeesImages(first),
                      baseURL: "",
                    });
                  }}
                  badge={provider.badge === "free" ? t("settings.free") : undefined}
                >
                  {provider.name}
                </OptChip>
              ))}
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

          {browserSelected || preset?.hideEndpoint ? null : (
          <FormGroup title={t("settings.interface")}>
            <OptRow>
              {interfaceTypes.map((type) => (
                <OptChip key={type.id} selected={type.enabled} disabled={!type.enabled}>
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
          </SettingsCard> : null}

          {activeTab === "image" ? <SettingsCard title={t("settings.image")}>
          <div className="flex flex-col gap-3">
            <OptRow>
              <OptChip
                selected={!image.providerId}
                onClick={() => patchImage({ providerId: "", model: "" })}
              >
                {t("settings.imageOff")}
              </OptChip>
              {imageProviders().map((provider) => (
                <OptChip
                  key={provider.id}
                  selected={image.providerId === provider.id}
                  badge={provider.badge === "free" ? t("settings.free") : undefined}
                  onClick={() =>
                    patchImage({
                      providerId: provider.id,
                      model: provider.imageModels?.[0] ?? "",
                      baseURL: "",
                    })
                  }
                >
                  {provider.name}
                </OptChip>
              ))}
              <OptChip
                selected={image.providerId === "custom"}
                onClick={() => patchImage({ providerId: "custom" })}
              >
                {t("settings.imageCustom")}
              </OptChip>
            </OptRow>
            {image.providerId === "custom" ? (
              <Field>
                <FieldInput
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("settings.imageModelPlaceholder")}
                  value={image.model}
                  onChange={(event) => patchImage({ model: event.target.value })}
                />
              </Field>
            ) : null}
            {image.providerId === "custom" ? (
              <Field>
                <FieldInput
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("settings.imageBasePlaceholder")}
                  value={image.baseURL}
                  onChange={(event) => patchImage({ baseURL: event.target.value })}
                />
              </Field>
            ) : null}
            {/* 生图密钥单列：同一家也可以填单独的 Key，跨提供商时必须填 */}
            {image.providerId ? (
              <Field>
                <FieldInput
                  type={showKey ? "text" : "password"}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("settings.imageKeyPlaceholder")}
                  value={image.apiKey}
                  onChange={(event) => patchImage({ apiKey: event.target.value })}
                />
              </Field>
            ) : null}
            {imageKeyJunk > 0 ? (
              <p className="m-0 text-[12.5px] leading-relaxed">
                <VaultWarn>{t("settings.keyJunk", { count: imageKeyJunk })}</VaultWarn>
              </p>
            ) : null}
            {/* 未启用时不摆风格和自动设置，省得看着像已经能用 */}
            {image.providerId ? (
              <>
                <OptRow>
                  {(Object.keys(IMAGE_STYLES) as Array<keyof typeof IMAGE_STYLES>).map((id) => (
                    <OptChip
                      key={id}
                      selected={image.styleId === id}
                      onClick={() => patchImage({ styleId: id })}
                    >
                      {styleName(id, t)}
                    </OptChip>
                  ))}
                </OptRow>
                <OptRow>
                  <OptChip selected={!image.auto} onClick={() => patchImage({ auto: false })}>
                    {t("settings.autoOff")}
                  </OptChip>
                  <OptChip selected={image.auto} onClick={() => patchImage({ auto: true })}>
                    {t("settings.autoOn")}
                  </OptChip>
                </OptRow>
                <SliderRow
                  label={t("settings.budget")}
                  min={1}
                  max={10}
                  value={image.budget}
                  display={t("settings.budgetValue", { count: image.budget })}
                  onChange={(value) => patchImage({ budget: value })}
                />
                <SliderRow
                  label={t("settings.threshold")}
                  min={0}
                  max={10}
                  value={image.threshold}
                  display={String(image.threshold)}
                  onChange={(value) => patchImage({ threshold: value })}
                />
              </>
            ) : null}
          </div>
          </SettingsCard> : null}

          {activeTab === "story" ? <FormGroup title={t("settings.storySystems")}>
            <StoryToggle label={t("settings.events")} help={t("settings.eventsHelp")} enabled={storySystems.events} onClick={() => patch({ storySystems: { ...storySystems, events: !storySystems.events } })} />
            <StoryToggle label={t("settings.goals")} help={t("settings.goalsHelp")} enabled={storySystems.goals} onClick={() => patch({ storySystems: { ...storySystems, goals: !storySystems.goals } })} />
            {storySystems.events ? <SliderRow label={t("settings.eventAfterTurns")} min={2} max={8} value={storySystems.eventAfterTurns} display={t("settings.eventAfterTurnsValue", { count: storySystems.eventAfterTurns })} onChange={(value) => patch({ storySystems: { ...storySystems, eventAfterTurns: value } })} /> : null}
          </FormGroup> : null}

          {activeTab === "data" ? <>
          <FormGroup title={t("settings.archive")}>
            <MenuRow
              icon={<IconDownload className="size-[17px]" />}
              note={archiveBusy ? t("settings.exporting") : t("settings.encrypted")}
              disabled={archiveBusy}
              onClick={() => onExport?.()}
            >
              {t("settings.exportArchive")}
            </MenuRow>
            <MenuRow
              icon={<IconDownload className="size-[17px] rotate-180" />}
              note={t("settings.sameKey")}
              disabled={archiveBusy}
               onClick={() => void chooseArchiveFile()}
            >
              {t("settings.importArchive")}
            </MenuRow>
            {archiveMessage || fileError ? (
              <div className="rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
                {archiveMessage ?? fileError}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={config.autoBackup.enabled}
                onClick={() => patch({ autoBackup: { ...config.autoBackup, enabled: !config.autoBackup.enabled } })}
                className="flex w-full items-center justify-between text-left text-[13px] text-ink"
              >
                <span>
                  <span className="block">{t("settings.autoBackup")}</span>
                  <span className="mt-1 block text-[12px] text-ink-2">{t("settings.autoBackupHelp")}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-[22px] w-10 shrink-0 items-center justify-start rounded-pill p-0.5 ${config.autoBackup.enabled ? "bg-accent" : "bg-surface-3"}`}
                >
                  <span className={`size-[18px] rounded-pill shadow-raised ${config.autoBackup.enabled ? "bg-accent-ink" : "bg-ink"}`} style={{ transform: config.autoBackup.enabled ? "translateX(20px)" : "translateX(0px)" }} />
                </span>
              </button>
              {config.autoBackup.enabled ? (
                <>
                  <OptRow>
                    {BACKUP_INTERVAL_HOURS.map((hours) => (
                      <OptChip
                        key={hours}
                        selected={config.autoBackup.intervalHours === hours}
                        onClick={() => patch({ autoBackup: { ...config.autoBackup, intervalHours: hours } })}
                      >
                        {t("settings.autoBackupInterval", { count: hours })}
                      </OptChip>
                    ))}
                  </OptRow>
                  <p className="m-0 text-[12px] text-ink-2">
                    {config.autoBackup.lastBackupAt
                      ? t("settings.autoBackupLast", { time: new Date(config.autoBackup.lastBackupAt).toLocaleString() })
                      : t("settings.autoBackupNever")}
                  </p>
                </>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                setFileError(null);
                onImport?.(event.target.files?.[0]);
                // 清空，同一个文件连选两次也要能触发
                event.target.value = "";
              }}
            />
          </FormGroup>

          <FormGroup title={t("settings.qualityGate")}>
            <button
              type="button"
              role="switch"
              aria-checked={config.qualityGate}
              onClick={() => patch({ qualityGate: !config.qualityGate })}
              className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3 text-left text-[13px] text-ink"
            >
              <span>
                <span className="block">{t("settings.qualityGateEnabled")}</span>
                <span className="mt-1 block text-[12px] text-ink-2">{t("settings.qualityGateHelp")}</span>
              </span>
              <span
                aria-hidden="true"
                className={`flex h-[22px] w-10 shrink-0 items-center rounded-pill p-0.5 ${config.qualityGate ? "justify-end bg-accent" : "justify-start bg-surface-3"}`}
              >
                <span className={`size-[18px] rounded-pill shadow-raised ${config.qualityGate ? "bg-accent-ink" : "bg-ink"}`} />
              </span>
            </button>
          </FormGroup>

          <FormGroup title={t("settings.vault")}>
            <MenuRow icon={<IconLock className="size-[17px]" />} onClick={onLock}>
              {t("settings.lock")}
            </MenuRow>
            {confirmWipe ? (
              <div className="rounded-lg border border-line bg-surface-2 px-4 py-[14px]">
                <p className="m-0 mb-3 text-[13px] leading-relaxed text-ink-2">
                  {t("settings.wipeWarn")}
                  <VaultWarn>{t("settings.wipeIrreversible")}</VaultWarn>
                </p>
                <div className="flex gap-2">
                  <PillButton
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setConfirmWipe(false);
                      void onWipe();
                    }}
                  >
                    {t("settings.confirmWipe")}
                  </PillButton>
                  <PillButton size="sm" onClick={() => setConfirmWipe(false)}>
                    {t("settings.cancel")}
                  </PillButton>
                </div>
              </div>
            ) : (
              <MenuRow
                icon={<IconTrash className="size-[17px]" />}
                tone="danger"
                note={t("settings.noRestore")}
                onClick={() => setConfirmWipe(true)}
              >
                {t("settings.wipe")}
              </MenuRow>
            )}
          </FormGroup>
          </> : null}

          <PillButton variant="primary" block onClick={onBack}>
            {t("settings.back")}
          </PillButton>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="overflow-hidden rounded-card border border-line-strong bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between bg-surface-2 px-4 py-3.5 text-left"
      >
        <span className="text-[16px] font-black text-ink">{title}</span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.8}
          className={`size-4 text-ink-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="flex flex-col gap-7 border-t border-line-strong px-4 py-4">{children}</div> : null}
    </section>
  );
}

function StoryToggle({ label, help, enabled, onClick }: { label: string; help: string; enabled: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} onClick={onClick} className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3 text-left text-[13px] text-ink">
      <span>
        <span className="block">{label}</span>
        <span className="mt-1 block text-[12px] text-ink-2">{help}</span>
      </span>
      <span aria-hidden="true" className={`flex h-[22px] w-10 shrink-0 items-center rounded-pill p-0.5 ${enabled ? "justify-end bg-accent" : "justify-start bg-surface-3"}`}>
        <span className={`size-[18px] rounded-pill shadow-raised ${enabled ? "bg-accent-ink" : "bg-ink"}`} />
      </span>
    </button>
  );
}

function styleName(id: string, t: (key: MessageKey) => string): string {
  const key = `image.style.${id}`;
  return hasMessage(key) ? t(key) : id;
}
