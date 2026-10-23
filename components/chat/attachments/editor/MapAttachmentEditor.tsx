"use client";

import { useMemo } from "react";
import { MapCanvas } from "../MapAttachmentView";
import {
  generateMap,
  MAP_PRESETS,
  PROCEDURAL_WORLD_GENERATOR_ID,
  PROCEDURAL_WORLD_GENERATOR_VERSION,
  resolveMapGeneration,
  type MapAttachment,
  type MapGenerationConfig,
  type MapParameters,
  type MapRandomRule,
  type MapRandomRules,
  type MapPresetId,
} from "@/lib/attachments";
import { PillButton } from "@/components/ui";
import type { CardPolishField } from "@/lib/cards";
import { AiPolishButton } from "../../AiPolishButton";

const PREVIEW_START_SEED = "editor-preview";
const CUSTOM_DEFAULTS: MapParameters = {
  width: 24,
  height: 12,
  continents: 3,
  landRatio: 0.38,
  islandDensity: 0.08,
  regionSize: 4,
};

const FIELD_CLASS =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong";

function isCustom(generation: MapGenerationConfig): generation is Extract<MapGenerationConfig, { mode: "CUSTOM" }> {
  return generation.mode === "CUSTOM";
}

function customGeneration(generation: MapGenerationConfig) {
  if (isCustom(generation)) return generation;
  return {
    mode: "CUSTOM" as const,
    generator: {
      id: PROCEDURAL_WORLD_GENERATOR_ID,
      version: PROCEDURAL_WORLD_GENERATOR_VERSION,
    },
    seed: "editor-map",
    parameters: { ...CUSTOM_DEFAULTS },
  };
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-bold text-ink">{label}</span>
      <input
        className={FIELD_CLASS}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function RuleEditor({
  label,
  rule,
  enabled,
  type,
  min,
  max,
  step,
  onToggle,
  onChange,
}: {
  label: string;
  rule?: MapRandomRule;
  enabled: boolean;
  type: "integer" | "float";
  min: number;
  max: number;
  step: number;
  onToggle: (enabled: boolean) => void;
  onChange: (rule: MapRandomRule) => void;
}) {
  const integerRule = rule?.type === "integer" ? rule : undefined;
  const floatRule = rule?.type === "float" ? rule : undefined;
  const currentMin = integerRule?.min ?? floatRule?.min ?? min;
  const currentMax = integerRule?.max ?? floatRule?.max ?? max;

  return (
    <div className="rounded-md border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-bold text-ink">{label}</span>
        <label className="flex items-center gap-2 text-[11px] text-ink-2">
          <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
          随机
        </label>
      </div>
      {enabled ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <NumberField
            label="最小值"
            value={currentMin}
            min={min}
            max={max}
            step={step}
            onChange={(value) => onChange(type === "integer"
              ? { type, min: Math.round(value), max: Math.max(Math.round(value), currentMax) }
              : { type, min: value, max: Math.max(value, currentMax), precision: 3 })}
          />
          <NumberField
            label="最大值"
            value={currentMax}
            min={min}
            max={max}
            step={step}
            onChange={(value) => onChange(type === "integer"
              ? { type, min: Math.min(currentMin, Math.round(value)), max: Math.round(value) }
              : { type, min: Math.min(currentMin, value), max: value, precision: 3 })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function MapAttachmentEditor({
  attachment,
  onChange,
  onDelete,
  onPolish = async () => "",
  polishingKey = null,
  polishLabel = "AI polish",
  polishingLabel = "…",
}: {
  attachment: MapAttachment;
  onChange: (attachment: MapAttachment) => void;
  onDelete: () => void;
  onPolish?: (field: CardPolishField, value: string, key: string) => Promise<string>;
  polishingKey?: string | null;
  polishLabel?: string;
  polishingLabel?: string;
}) {
  const generation = attachment.generation;
  const custom = customGeneration(generation);
  const preview = useMemo(() => {
    try {
      const resolved = resolveMapGeneration(generation, PREVIEW_START_SEED);
      return { map: generateMap(resolved), error: null };
    } catch (caught) {
      return { map: null, error: caught instanceof Error ? caught.message : "地图预览不可用" };
    }
  }, [generation]);

  function setTitle(title: string) {
    onChange({ ...attachment, title });
  }

  function setGeneration(next: MapGenerationConfig) {
    onChange({ ...attachment, generation: next });
  }

  function setCustomPatch(patch: Partial<typeof custom>) {
    setGeneration({ ...custom, ...patch, parameters: { ...(custom.parameters ?? {}), ...(patch.parameters ?? {}) } });
  }

  function setParameter(key: string, value: number) {
    setCustomPatch({ parameters: { ...(custom.parameters ?? {}), [key]: value } });
  }

  function setRandomRule(key: string, rule: MapRandomRule | undefined) {
    const random: MapRandomRules = { ...(custom.random ?? {}) };
    if (rule) random[key] = rule;
    else delete random[key];
    setCustomPatch({ random: Object.keys(random).length > 0 ? random : undefined });
  }

  function polishTitle() {
    void onPolish("map_title", attachment.title ?? "", `${attachment.id}:title`)
      .then((title) => setTitle(title))
      .catch(() => undefined);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.1fr)]">
      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-bold text-ink">地图设置</h3>
            <p className="m-0 mt-1 text-[11.5px] text-ink-3">参数变化会立即更新右侧预览。</p>
          </div>
          <PillButton type="button" size="sm" variant="danger" onClick={onDelete}>删除</PillButton>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
             <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
               <span>标题</span>
               <AiPolishButton
                 onClick={polishTitle}
                 busy={polishingKey === `${attachment.id}:title`}
                 label={polishLabel}
                 workingLabel={polishingLabel}
               />
             </span>
            <input className={FIELD_CLASS} value={attachment.title ?? ""} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-ink">生成方式</span>
            <div className="flex flex-wrap gap-1.5">
              {(["DEFAULT", "CUSTOM"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={generation.mode === mode}
                  onClick={() => setGeneration(mode === "DEFAULT"
                    ? { mode, preset: { id: "earth-simplified", version: "1" } }
                    : custom)}
                  className={`rounded-pill border px-3 py-1.5 text-[12px] transition-colors ${generation.mode === mode ? "border-selected-line bg-selected text-selected-ink" : "border-line bg-surface-2 text-ink-2 hover:border-line-strong"}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {generation.mode === "DEFAULT" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-ink">Preset</span>
              <select
                className={FIELD_CLASS}
                value={`${generation.preset.id}@${generation.preset.version}`}
                onChange={(event) => {
                  const [id, version] = event.target.value.split("@");
                  setGeneration({ mode: "DEFAULT", preset: { id: id as MapPresetId, version } });
                }}
              >
                {Object.values(MAP_PRESETS).map((preset) => (
                  <option key={`${preset.ref.id}@${preset.ref.version}`} value={`${preset.ref.id}@${preset.ref.version}`}>
                    {preset.ref.id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-bold text-ink">Seed</span>
                <input
                  className={FIELD_CLASS}
                  value={custom.seed}
                  onChange={(event) => setCustomPatch({ seed: event.target.value || "editor-map" })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="宽度" value={Number(custom.parameters?.width ?? CUSTOM_DEFAULTS.width)} min={8} max={64} step={1} onChange={(value) => setParameter("width", Math.round(value))} />
                <NumberField label="高度" value={Number(custom.parameters?.height ?? CUSTOM_DEFAULTS.height)} min={6} max={36} step={1} onChange={(value) => setParameter("height", Math.round(value))} />
                <NumberField label="大陆数量" value={Number(custom.parameters?.continents ?? CUSTOM_DEFAULTS.continents)} min={1} max={8} step={1} onChange={(value) => setParameter("continents", Math.round(value))} />
                <NumberField label="陆地比例" value={Number(custom.parameters?.landRatio ?? CUSTOM_DEFAULTS.landRatio)} min={0.1} max={0.85} step={0.01} onChange={(value) => setParameter("landRatio", value)} />
                <NumberField label="岛屿密度" value={Number(custom.parameters?.islandDensity ?? CUSTOM_DEFAULTS.islandDensity)} min={0} max={0.35} step={0.01} onChange={(value) => setParameter("islandDensity", value)} />
                <NumberField label="区域大小" value={Number(custom.parameters?.regionSize ?? CUSTOM_DEFAULTS.regionSize)} min={2} max={16} step={1} onChange={(value) => setParameter("regionSize", Math.round(value))} />
              </div>
              <div className="grid gap-3">
                <RuleEditor
                  label="大陆数量规则"
                  rule={custom.random?.continents}
                  enabled={Boolean(custom.random?.continents)}
                  type="integer"
                  min={1}
                  max={8}
                  step={1}
                  onToggle={(enabled) => setRandomRule("continents", enabled ? { type: "integer", min: 1, max: 8 } : undefined)}
                  onChange={(rule) => setRandomRule("continents", rule)}
                />
                <RuleEditor
                  label="岛屿密度规则"
                  rule={custom.random?.islandDensity}
                  enabled={Boolean(custom.random?.islandDensity)}
                  type="float"
                  min={0}
                  max={0.35}
                  step={0.01}
                  onToggle={(enabled) => setRandomRule("islandDensity", enabled ? { type: "float", min: 0, max: 0.15, precision: 3 } : undefined)}
                  onChange={(rule) => setRandomRule("islandDensity", rule)}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-bold text-ink">实时预览</h3>
            <p className="m-0 mt-1 text-[11.5px] text-ink-3">预览种子固定为 {PREVIEW_START_SEED}。</p>
          </div>
          {preview.map ? <span className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">{preview.map.fingerprint}</span> : null}
        </div>
        {preview.map ? (
          <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface-2">
            <MapCanvas map={preview.map} onRegionSelect={() => {}} />
          </div>
        ) : (
          <p className="m-0 mt-4 rounded-md bg-danger-soft px-3 py-2.5 text-[12px] text-danger">{preview.error}</p>
        )}
        {preview.map ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-ink-2">
            <span className="rounded-md bg-surface-2 px-2 py-2">陆地 {preview.map.stats.landCells}</span>
            <span className="rounded-md bg-surface-2 px-2 py-2">区域 {preview.map.stats.regionCount}</span>
            <span className="rounded-md bg-surface-2 px-2 py-2">大陆 {preview.map.stats.continentCount}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
