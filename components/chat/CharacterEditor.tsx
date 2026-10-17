"use client";

import { useRef, useState } from "react";
import { IconBack } from "@/components/icons";
import { PillButton, ScreenHead } from "@/components/ui";
import { addImportedCard, updateImportedCard, type ImportedCardRecord } from "@/lib/storage/cards";
import { cardPortraitUrl, createEmptyCard, type CharacterCard } from "@/lib/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import { Avatar } from "./Avatar";

type Draft = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  creator: string;
  character_version: string;
  tags: string;
  alternate_greetings: string;
  portrait: string;
  coverUrl: string;
};

function localPortrait(card: CharacterCard): string {
  const local = card.data.extensions?._local;
  if (!local || typeof local !== "object" || Array.isArray(local)) return "";
  const portrait = (local as Record<string, unknown>).portrait;
  return typeof portrait === "string" ? portrait : "";
}

function localPortraitUrl(card: CharacterCard): string {
  const local = card.data.extensions?._local;
  if (!local || typeof local !== "object" || Array.isArray(local)) return "";
  const url = (local as Record<string, unknown>).portraitUrl;
  return typeof url === "string" ? url : "";
}

function toDraft(card: CharacterCard): Draft {
  const data = card.data;
  return {
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example ?? "",
    system_prompt: data.system_prompt ?? "",
    post_history_instructions: data.post_history_instructions ?? "",
    creator: data.creator ?? "",
    character_version: data.character_version ?? "",
    tags: data.tags?.join(", ") ?? "",
    alternate_greetings: data.alternate_greetings?.join("\n") ?? "",
    portrait: localPortrait(card) || cardPortraitUrl(data) || "",
    coverUrl: localPortraitUrl(card),
  };
}

function toCard(draft: Draft, original: CharacterCard): CharacterCard {
  const data = original.data;
  const tags = [...new Set(draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean))];
  const alternateGreetings = draft.alternate_greetings
    .split("\n")
    .map((greeting) => greeting.trim())
    .filter(Boolean);
  const extensions = { ...(data.extensions ?? {}) };
  const local = extensions._local && typeof extensions._local === "object" && !Array.isArray(extensions._local)
    ? { ...(extensions._local as Record<string, unknown>) }
    : {};
  if (draft.portrait.startsWith("data:image/")) local.portrait = draft.portrait;
  else delete local.portrait;
  if (draft.coverUrl) local.portraitUrl = draft.coverUrl;
  else delete local.portraitUrl;
  if (Object.keys(local).length > 0) extensions._local = local;
  else delete extensions._local;

  return {
    ...original,
    data: {
      ...data,
      name: draft.name.trim(),
      description: draft.description,
      personality: draft.personality,
      scenario: draft.scenario,
      first_mes: draft.first_mes,
      mes_example: draft.mes_example,
      system_prompt: draft.system_prompt,
      post_history_instructions: draft.post_history_instructions,
      creator: draft.creator.trim(),
      character_version: draft.character_version.trim(),
      tags,
      alternate_greetings: alternateGreetings,
      extensions,
    },
  };
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const className =
    "w-full rounded-md border border-line bg-surface-2 px-3.5 py-3 text-[14px] leading-6 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-ink">{label}{required ? " *" : ""}</span>
      {multiline ? (
        <textarea className={`${className} min-h-[110px] resize-y`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={className} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function CharacterEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: ImportedCardRecord;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useI18n();
  const [baseCard] = useState(() => record?.card ?? createEmptyCard());
  const [draft, setDraft] = useState(() => toDraft(baseCard));
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const portraitRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!draft.name.trim()) {
      setError(t("card.nameRequired"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const card = toCard(draft, baseCard);
      let saved: ImportedCardRecord;
      if (record) {
        await updateImportedCard({ ...record, card });
        saved = { ...record, card };
      } else {
        saved = await addImportedCard(card);
      }
      onSaved(saved.id);
    } catch {
      setError(t("card.saveFail"));
    } finally {
      setSaving(false);
    }
  }

  function choosePortrait(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setError(t("card.coverFail"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        set("portrait", reader.result);
        set("coverUrl", "");
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-[780px] px-6 py-8">
        <ScreenHead
          title={record ? t("card.edit") : t("card.create")}
          before={<button type="button" aria-label={t("card.cancel")} onClick={onCancel} className="grid size-10 place-items-center rounded-pill border border-line bg-surface text-ink transition-colors hover:border-line-strong"><IconBack /></button>}
        />

        {error ? <div className="mb-5 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</div> : null}

        <form className="flex flex-col gap-7" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <section className="grid gap-5 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">
            <div className="flex items-end gap-5 border-b border-line pb-5 sm:col-span-2">
              <div className="size-[112px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2 shadow-raised">
                <Avatar name={draft.name} src={draft.portrait || null} />
              </div>
              <div className="flex min-h-[112px] flex-col justify-end gap-2">
                <span className="text-[13px] font-bold text-ink">{t("card.cover")}</span>
                <div className="flex flex-wrap gap-2">
                  <PillButton type="button" size="sm" onClick={() => portraitRef.current?.click()}>{t("card.coverUpload")}</PillButton>
                  {draft.portrait ? <PillButton type="button" size="sm" onClick={() => { set("portrait", ""); set("coverUrl", ""); }}>{t("card.coverRemove")}</PillButton> : null}
                </div>
                <input
                  ref={portraitRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    choosePortrait(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <input
                  type="url"
                  value={draft.coverUrl}
                  placeholder={t("card.coverUrlPlaceholder")}
                  onChange={(event) => {
                    const value = event.target.value;
                    set("coverUrl", value);
                    set("portrait", value);
                  }}
                  className="w-full max-w-[360px] rounded-pill border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
                />
              </div>
            </div>
            <TextField label={t("card.name")} value={draft.name} onChange={(value) => set("name", value)} required />
            <TextField label={t("card.tags")} value={draft.tags} onChange={(value) => set("tags", value)} placeholder={t("card.tagsPlaceholder")} />
            <TextField label={t("card.description")} value={draft.description} onChange={(value) => set("description", value)} multiline />
            <TextField label={t("card.personality")} value={draft.personality} onChange={(value) => set("personality", value)} multiline />
            <TextField label={t("card.scenario")} value={draft.scenario} onChange={(value) => set("scenario", value)} multiline />
            <TextField label={t("card.firstMes")} value={draft.first_mes} onChange={(value) => set("first_mes", value)} multiline />
          </section>

          <section className="grid gap-5 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">
            <TextField label={t("card.creator")} value={draft.creator} onChange={(value) => set("creator", value)} />
            <TextField label={t("card.version")} value={draft.character_version} onChange={(value) => set("character_version", value)} />
            <div className="sm:col-span-2">
              <button
                type="button"
                aria-expanded={advanced}
                onClick={() => setAdvanced((value) => !value)}
                className="flex w-full items-center justify-between rounded-md border border-line bg-surface-2 px-3.5 py-3 text-left text-[13px] font-bold text-ink transition-colors hover:border-line-strong"
              >
                <span>{t("card.advanced")}</span>
                <span
                  aria-hidden="true"
                  className={`size-2 rotate-45 border-b-2 border-r-2 border-ink-2 transition-transform duration-200 ${advanced ? "rotate-[225deg]" : ""}`}
                />
              </button>
            </div>
            {advanced ? (
              <>
                <TextField label={t("card.examples")} value={draft.mes_example} onChange={(value) => set("mes_example", value)} multiline />
                <TextField label={t("card.systemPrompt")} value={draft.system_prompt} onChange={(value) => set("system_prompt", value)} multiline />
                <TextField label={t("card.postHistory")} value={draft.post_history_instructions} onChange={(value) => set("post_history_instructions", value)} multiline />
                <TextField label={t("card.alternateGreetings")} value={draft.alternate_greetings} onChange={(value) => set("alternate_greetings", value)} multiline placeholder={t("card.alternateGreetingsPlaceholder")} />
              </>
            ) : null}
          </section>

          <div className="flex justify-end gap-2 pb-4">
            <PillButton type="button" onClick={onCancel} disabled={saving}>{t("card.cancel")}</PillButton>
            <PillButton type="submit" variant="primary" disabled={saving}>{saving ? "…" : t("card.save")}</PillButton>
          </div>
        </form>
      </div>
    </div>
  );
}
