"use client";

import { useRef, useState } from "react";
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
  VaultStatus,
  VaultWarn,
} from "@/components/ui";
import { IconDownload, IconEye, IconLock, IconTrash, IconX } from "@/components/icons";
import { getProvidersConfig, findProvider } from "@/lib/providers/config";
import { IMAGE_MODEL_PRESETS, IMAGE_STYLES } from "@/lib/image";
import { defaultImageSettings, type ImageSettings, type ProviderConfig } from "@/lib/providers/settings";

/* 只从 config / settings 导入，不要从 @/lib/providers 导入：
   那个入口会带出 openai SDK，整个打进浏览器包。 */

export function SettingsScreen({
  config,
  onChange,
  onLock,
  onWipe,
  onBack,
  backend,
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
  backend?: string | null;
  onExport?: () => void;
  onImport?: (file: File | undefined) => void;
  archiveBusy?: boolean;
  archiveMessage?: string | null;
}) {
  const [showKey, setShowKey] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const providers = getProvidersConfig().providers;
  const interfaceTypes = getProvidersConfig().interfaceTypes;
  const preset = findProvider(config.providerId);

  function patch(next: Partial<ProviderConfig>) {
    onChange({ ...config, ...next });
  }

  const image = config.image ?? defaultImageSettings();

  function patchImage(next: Partial<ImageSettings>) {
    patch({ image: { ...image, ...next } });
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-[560px] px-6 py-8">
        <ScreenHead
          title="连接设置"
          action={<BackPill onClick={onBack}>回到对话</BackPill>}
        />

        <div className="flex flex-col gap-7">
          <FormGroup title="提供商">
            <OptRow>
              {providers.map((provider) => (
                <OptChip
                  key={provider.id}
                  selected={config.providerId === provider.id}
                  onClick={() =>
                    patch({
                      providerId: provider.id,
                      // 换提供商时把模型带到新预设的第一个，避免留下不存在的模型名
                      model: provider.models[0] ?? "",
                      baseURL: "",
                    })
                  }
                >
                  {provider.name}
                </OptChip>
              ))}
            </OptRow>
            {preset?.keyUrl ? (
              <a
                href={preset.keyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="self-start text-[12.5px] text-ink-2 underline"
              >
                获取 Key →
              </a>
            ) : null}
          </FormGroup>

          <FormGroup title="接口类型">
            <OptRow>
              {interfaceTypes.map((type) => (
                <OptChip key={type.id} selected={type.enabled} disabled={!type.enabled}>
                  {type.enabled ? type.name : `${type.name} · 后续`}
                </OptChip>
              ))}
            </OptRow>
          </FormGroup>

          <FormGroup title="Base URL">
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
                  aria-label="清空，改用预设地址"
                  onClick={() => patch({ baseURL: "" })}
                >
                  <IconX className="size-[15px]" />
                </FieldAction>
              ) : null}
            </Field>
          </FormGroup>

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
                aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                onClick={() => setShowKey((value) => !value)}
              >
                <IconEye className="size-[17px]" />
              </FieldAction>
            </Field>
          </FormGroup>

          <FormGroup title="模型">
            {(preset?.models?.length ?? 0) > 0 ? (
              <OptRow>
                {preset?.models.map((model) => (
                  <OptChip
                    key={model}
                    selected={config.model === model}
                    onClick={() => patch({ model })}
                  >
                    {model}
                  </OptChip>
                ))}
              </OptRow>
            ) : null}
            <Field>
              <FieldInput
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="模型名"
                value={config.model}
                onChange={(event) => patch({ model: event.target.value })}
              />
            </Field>
          </FormGroup>

          <FormGroup title="生成">
            <SliderRow
              label="随机度"
              min={0}
              max={20}
              value={Math.round(config.temperature * 10)}
              display={config.temperature.toFixed(1)}
              onChange={(value) => patch({ temperature: value / 10 })}
            />
          </FormGroup>

          <FormGroup title="生图">
            <OptRow>
              <OptChip selected={!image.model} onClick={() => patchImage({ model: "" })}>
                不使用
              </OptChip>
              {IMAGE_MODEL_PRESETS.map((model) => (
                <OptChip
                  key={model}
                  selected={image.model === model}
                  onClick={() => patchImage({ model })}
                >
                  {model}
                </OptChip>
              ))}
            </OptRow>
            <Field>
              <FieldInput
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="生图模型名，留空则禁用 CG"
                value={image.model}
                onChange={(event) => patchImage({ model: event.target.value })}
              />
            </Field>
            <Field>
              <FieldInput
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                placeholder="生图 Base URL，空则沿用上面的"
                value={image.baseURL}
                onChange={(event) => patchImage({ baseURL: event.target.value })}
              />
            </Field>
            <Field>
              <FieldInput
                type={showKey ? "text" : "password"}
                spellCheck={false}
                autoComplete="off"
                placeholder="生图 Key，空则沿用对话 Key"
                value={image.apiKey}
                onChange={(event) => patchImage({ apiKey: event.target.value })}
              />
            </Field>
            <OptRow>
              {(Object.keys(IMAGE_STYLES) as Array<keyof typeof IMAGE_STYLES>).map((id) => (
                <OptChip
                  key={id}
                  selected={image.styleId === id}
                  onClick={() => patchImage({ styleId: id })}
                >
                  {IMAGE_STYLES[id].label}
                </OptChip>
              ))}
            </OptRow>
            <OptRow>
              <OptChip selected={!image.auto} onClick={() => patchImage({ auto: false })}>
                自动生成关
              </OptChip>
              <OptChip selected={image.auto} onClick={() => patchImage({ auto: true })}>
                自动生成开
              </OptChip>
            </OptRow>
            <SliderRow
              label="每场上限"
              min={1}
              max={10}
              value={image.budget}
              display={`${image.budget} 张`}
              onChange={(value) => patchImage({ budget: value })}
            />
            <SliderRow
              label="自动阈值"
              min={0}
              max={10}
              value={image.threshold}
              display={String(image.threshold)}
              onChange={(value) => patchImage({ threshold: value })}
            />
            <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">
              没填模型时，对话里的「生成 CG」是灰的。自动生成默认关；打开后最多每 10 轮 1 张，且不超过上面的上限，相似场景不重复，不挡住聊天。
            </p>
          </FormGroup>

          <FormGroup title="存档">
            <VaultStatus>
              导出的是<b>加密存档</b>，用你设定的密钥加密。
              <br />
              导入时会校验，密钥不对会明确报错，不会静默失败。
              {backend ? (
                <>
                  <br />
                  聊天与角色卡当前存在 <b>{backend}</b>。
                </>
              ) : null}
            </VaultStatus>
            <MenuRow
              icon={<IconDownload className="size-[17px]" />}
              note={archiveBusy ? "正在导出" : "加密"}
              disabled={archiveBusy}
              onClick={() => onExport?.()}
            >
              导出存档
            </MenuRow>
            <MenuRow
              icon={<IconDownload className="size-[17px] rotate-180" />}
              note="需要同一个密钥"
              disabled={archiveBusy}
              onClick={() => fileRef.current?.click()}
            >
              导入存档
            </MenuRow>
            {archiveMessage ? (
              <div className="rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
                {archiveMessage}
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                onImport?.(event.target.files?.[0]);
                // 清空，同一个文件连选两次也要能触发
                event.target.value = "";
              }}
            />
          </FormGroup>

          <FormGroup title="保险库">
            <MenuRow icon={<IconLock className="size-[17px]" />} onClick={onLock}>
              锁定
            </MenuRow>
            {confirmWipe ? (
              <div className="rounded-lg border border-line bg-surface-2 px-4 py-[14px]">
                <p className="m-0 mb-3 text-[13px] leading-relaxed text-ink-2">
                  会清掉本机全部加密数据：聊天记录、角色卡、连接设置、摘要。
                  <VaultWarn>密钥不存在本机，清除后无法找回。</VaultWarn>
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
                    确认清除
                  </PillButton>
                  <PillButton size="sm" onClick={() => setConfirmWipe(false)}>
                    取消
                  </PillButton>
                </div>
              </div>
            ) : (
              <MenuRow
                icon={<IconTrash className="size-[17px]" />}
                tone="danger"
                note="不可恢复"
                onClick={() => setConfirmWipe(true)}
              >
                清除本机数据
              </MenuRow>
            )}
          </FormGroup>

          <PillButton variant="primary" block onClick={onBack}>
            回到对话
          </PillButton>
        </div>
      </div>
    </div>
  );
}
