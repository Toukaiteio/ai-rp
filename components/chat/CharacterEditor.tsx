"use client";

import { useRef, useState } from "react";
import { IconBack } from "@/components/icons";
import { PillButton, ScreenHead, Segmented } from "@/components/ui";
import { addImportedCard, updateImportedCard, type ImportedCardRecord } from "@/lib/storage/cards";
import { cardPortraitUrl, createEmptyCard, downloadCard, downloadCardPng, polishCardField, type CardPolishField, type CharacterCard } from "@/lib/cards";
import {
  ATTACHMENTS_KEY,
  ATTACHMENTS_NAMESPACE,
  normalizeAttachments,
  type CardAttachment,
  type ScriptAttachment,
} from "@/lib/attachments";
import {
  defaultVoiceProfile,
  normalizeVoiceProfile,
  type CharacterVoiceProfile,
} from "@/lib/voice";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";
import { assemble } from "@/lib/prompt";
import { Avatar } from "./Avatar";
import { AiPolishButton } from "./AiPolishButton";
import { hasNativeFilePicker, isAndroidApp, pickNativeFile } from "@/lib/storage/native";
import { AttachmentsEditor } from "./attachments/editor";

type EditorSection = "basic" | "content" | "voice" | "capabilities" | "advanced";

type Draft = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  author_note: string;
  voice: CharacterVoiceProfile;
  creator: string;
  character_version: string;
  tags: string;
  alternate_greetings: string;
  portrait: string;
  coverUrl: string;
  attachments: CardAttachment[];
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

function cardAttachments(card: CharacterCard): CardAttachment[] {
  if (Array.isArray(card.data.attachments)) return card.data.attachments;
  const namespace = card.data.extensions?.[ATTACHMENTS_NAMESPACE];
  if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) return [];
  const raw = (namespace as Record<string, unknown>)[ATTACHMENTS_KEY];
  return normalizeAttachments(raw);
}

function sanitizeAttachments(attachments: CardAttachment[]): CardAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.kind !== "script" || !("source" in attachment)) return attachment;
    const script = attachment as ScriptAttachment;
    return {
      ...script,
      runtime: "sandbox",
      requestedPermissions: {
        network: script.requestedPermissions?.network === true,
        filesystem: script.requestedPermissions?.filesystem === true,
        cardScope: script.requestedPermissions?.cardScope !== false,
      },
      permissions: { network: false, filesystem: false, cardScope: true },
      status: "unsupported",
      enabled: false,
    };
  });
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
    author_note: data.author_note ?? "",
    voice: data.voice ?? defaultVoiceProfile(),
    creator: data.creator ?? "",
    character_version: data.character_version ?? "",
    tags: data.tags?.join(", ") ?? "",
    alternate_greetings: data.alternate_greetings?.join("\n") ?? "",
    portrait: localPortrait(card) || cardPortraitUrl(data) || "",
    coverUrl: localPortraitUrl(card),
    attachments: cardAttachments(card),
  };
}

function toCard(draft: Draft, original: CharacterCard): CharacterCard {
  const originalData = original.data;
  const { attachments: originalAttachments, ...data } = originalData;
  const attachments = sanitizeAttachments(draft.attachments);
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

  const originalNamespace = extensions[ATTACHMENTS_NAMESPACE];
  const namespace = originalNamespace && typeof originalNamespace === "object" && !Array.isArray(originalNamespace)
    ? { ...(originalNamespace as Record<string, unknown>) }
    : {};
  const hadAttachments = originalAttachments !== undefined || Array.isArray(namespace[ATTACHMENTS_KEY]);
  if (draft.attachments.length > 0 || hadAttachments) {
    namespace[ATTACHMENTS_KEY] = attachments;
    extensions[ATTACHMENTS_NAMESPACE] = namespace;
  }

  const nextData = {
    ...data,
    name: draft.name.trim(),
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    first_mes: draft.first_mes,
    mes_example: draft.mes_example,
    system_prompt: draft.system_prompt,
    post_history_instructions: draft.post_history_instructions,
    author_note: draft.author_note,
    ...(normalizeVoiceProfile(draft.voice) ? { voice: draft.voice } : { voice: undefined }),
    creator: draft.creator.trim(),
    character_version: draft.character_version.trim(),
    tags,
    alternate_greetings: alternateGreetings,
    extensions,
    ...(attachments.length > 0 || hadAttachments ? { attachments } : {}),
  };

  return { ...original, data: nextData };
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  required,
  hint,
  onPolish,
  polishBusy = false,
  polishLabel = "AI polish",
  polishWorkingLabel = "…",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  onPolish?: () => void;
  polishBusy?: boolean;
  polishLabel?: string;
  polishWorkingLabel?: string;
}) {
  const className =
    "w-full rounded-md border border-line bg-surface-2 px-3.5 py-3 text-[14px] leading-6 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2 text-[13px] font-bold text-ink">
        <span>{label}{required ? " *" : ""}</span>
        {onPolish ? (
          <AiPolishButton
            onClick={onPolish}
            busy={polishBusy}
            label={polishLabel}
            workingLabel={polishWorkingLabel}
          />
        ) : null}
      </span>
      {multiline ? (
        <textarea className={`${className} min-h-[110px] resize-y`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={className} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
      {hint ? <span className="text-[11.5px] leading-relaxed text-ink-3">{hint}</span> : null}
    </label>
  );
}

function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-ink">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-pill border px-3 py-1.5 text-[12.5px] transition-colors ${value === option.value ? "border-selected-line bg-selected text-selected-ink" : "border-line bg-surface-2 text-ink-2 hover:border-line-strong"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorInspector({
  draft,
  sectionLabel,
  t,
}: {
  draft: Draft;
  sectionLabel: string;
  t: (key: MessageKey) => string;
}) {
  const compiled = assemble({
    card: {
      name: draft.name.trim() || "未命名角色",
      description: draft.description,
      personality: draft.personality,
      scenario: draft.scenario,
      first_mes: draft.first_mes,
      mes_example: draft.mes_example,
      system_prompt: draft.system_prompt,
      post_history_instructions: draft.post_history_instructions,
      author_note: draft.author_note,
      voice: draft.voice,
      attachments: draft.attachments,
    },
    history: [],
    seed: 0,
    budget: 6_000,
  });
  const preview = compiled.messages.map((message) => message.content).filter(Boolean).join("\n\n").trim();
  const textFields = [
    draft.description,
    draft.personality,
    draft.scenario,
    draft.first_mes,
    draft.mes_example,
    draft.system_prompt,
    draft.post_history_instructions,
    draft.author_note,
    draft.voice.vocabulary.join("、"),
    draft.voice.habits.join("、"),
    draft.voice.avoidances.join("、"),
    draft.voice.sampleLines.join("\n"),
  ];
  const filledFields = textFields.filter((value) => value.trim()).length;

  return (
    <aside className="hidden min-w-0 xl:block">
      <div className="sticky top-[78px] grid gap-3">
        <section className="rounded-card border border-line bg-surface p-4" data-editor-inspector>
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[14px] font-bold text-ink">{t("card.workbenchStatus")}</h2>
            <span className="rounded-pill bg-selected px-2 py-1 text-[10px] font-bold text-selected-ink">{t("card.workbenchDraft")}</span>
          </div>
          <dl className="mt-3 grid gap-2 text-[12px]">
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-3">{t("card.workbenchSection")}</dt><dd className="m-0 font-bold text-ink">{sectionLabel}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-3">{t("card.workbenchFields")}</dt><dd className="m-0 font-bold text-ink">{filledFields}/{textFields.length}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-ink-3">{t("card.workbenchAttachments")}</dt><dd className="m-0 font-bold text-ink">{draft.attachments.length}</dd></div>
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="m-0 text-[14px] font-bold text-ink">{t("card.workbenchPreview")}</h2>
          <p className="mt-3 max-h-[180px] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-2">
            {preview || t("card.workbenchPreviewEmpty")}
          </p>
        </section>
      </div>
    </aside>
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
  const [section, setSection] = useState<EditorSection>("basic");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [polishingField, setPolishingField] = useState<string | null>(null);
  const portraitRef = useRef<HTMLInputElement>(null);

  const sections: Array<{ value: EditorSection; label: string }> = [
    { value: "basic", label: t("card.section.basic") },
    { value: "content", label: t("card.section.content") },
    { value: "voice", label: t("card.section.voice") },
    { value: "capabilities", label: t("card.section.capabilities") },
    { value: "advanced", label: t("card.section.advanced") },
  ];

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setVoice(patch: Partial<CharacterVoiceProfile>) {
    setDraft((current) => ({ ...current, voice: { ...current.voice, ...patch } }));
  }

  function setVoiceList(key: "vocabulary" | "habits" | "avoidances" | "sampleLines", value: string, separator = "、") {
    const items = value.split(separator).map((item) => item.trim()).filter(Boolean);
    setVoice({ [key]: items } as Partial<CharacterVoiceProfile>);
  }

  async function polishValue(field: CardPolishField, value: string, key: string = field): Promise<string> {
    if (!value.trim()) {
      setError(t("card.aiPolishEmpty"));
      throw new Error("polish_empty");
    }
    setError(null);
    setPolishingField(key);
    try {
      return await polishCardField(
        { ...baseCard, data: { ...baseCard.data, name: draft.name.trim() || baseCard.data.name } },
        field,
        value,
      );
    } catch (caught) {
      setError(t("card.aiPolishFail"));
      throw caught;
    } finally {
      setPolishingField((current) => current === key ? null : current);
    }
  }

  function aiPolish(field: CardPolishField, value: string, apply: (next: string) => void): () => void {
    return () => {
      void polishValue(field, value).then(apply).catch(() => undefined);
    };
  }

  function polishProps(field: CardPolishField, value: string, apply: (next: string) => void) {
    return {
      onPolish: aiPolish(field, value, apply),
      polishBusy: polishingField === field,
      polishLabel: t("card.aiPolish"),
      polishWorkingLabel: t("card.aiPolishing"),
    };
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

  async function choosePortraitFile() {
    if (!isAndroidApp()) {
      portraitRef.current?.click();
      return;
    }
    if (!hasNativeFilePicker()) {
      setError(t("native.filePickerUnavailable"));
      return;
    }
    try {
      choosePortrait((await pickNativeFile("image/*")) ?? undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("native.filePickerUnavailable"));
    }
  }

  async function exportCard(format: "json" | "png") {
    try {
      const card = toCard(draft, baseCard);
      if (format === "json") downloadCard(card);
      else await downloadCardPng(card);
    } catch {
      setError(t("card.exportFail"));
    }
  }

  const title = draft.name.trim() || (record ? t("card.edit") : t("card.create"));

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <form
        id="character-editor-form"
        className="min-h-full"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="sticky top-0 z-20 border-b border-line bg-background/95 backdrop-blur">
          <div className="mx-auto max-w-[1180px] px-4 py-3 md:px-6">
            <ScreenHead
              className="mb-0"
              title={title}
              subtitle={record ? t("card.edit") : t("card.create")}
              before={<button type="button" aria-label={t("card.cancel")} onClick={onCancel} className="grid size-10 place-items-center rounded-pill border border-line bg-surface text-ink transition-colors hover:border-line-strong"><IconBack /></button>}
              action={<PillButton type="submit" form="character-editor-form" variant="primary" disabled={saving}>{saving ? "…" : t("card.save")}</PillButton>}
            />
          </div>
        </div>

        <div className="mx-auto max-w-[1180px] px-4 py-4 md:px-6 md:py-6">
          {error ? <div className="mb-4 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</div> : null}

          <div className="mb-4 overflow-x-auto lg:hidden">
            <Segmented items={sections} value={section} onChange={setSection} label={t("card.sectionNavigation")} className="min-w-max" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_260px] xl:items-start">
            <aside className="sticky top-[78px] hidden rounded-card border border-line bg-surface p-2 lg:block">
              <nav aria-label={t("card.sectionNavigation")} className="grid gap-1">
                {sections.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={section === item.value}
                    onClick={() => setSection(item.value)}
                    className={`rounded-pill px-3.5 py-2.5 text-left text-[13px] font-bold transition-colors ${section === item.value ? "bg-selected text-selected-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </aside>

             <main className="min-w-0">
              {section === "basic" ? (
                <section className="grid gap-5 rounded-card border border-line bg-surface p-4 md:p-5 sm:grid-cols-2">
                  <div className="flex items-end gap-5 border-b border-line pb-5 sm:col-span-2">
                    <div className="size-[112px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2 shadow-raised">
                      <Avatar name={draft.name} src={draft.portrait || null} />
                    </div>
                    <div className="flex min-h-[112px] min-w-0 flex-col justify-end gap-2">
                      <span className="text-[13px] font-bold text-ink">{t("card.cover")}</span>
                      <div className="flex flex-wrap gap-2">
                        <PillButton type="button" size="sm" onClick={() => void choosePortraitFile()}>{t("card.coverUpload")}</PillButton>
                        {draft.portrait ? <PillButton type="button" size="sm" onClick={() => { set("portrait", ""); set("coverUrl", ""); }}>{t("card.coverRemove")}</PillButton> : null}
                      </div>
                      <input ref={portraitRef} type="file" accept="image/*" className="hidden" onChange={(event) => { choosePortrait(event.target.files?.[0]); event.target.value = ""; }} />
                      <input type="url" value={draft.coverUrl} placeholder={t("card.coverUrlPlaceholder")} onChange={(event) => { const value = event.target.value; set("coverUrl", value); set("portrait", value); }} className="w-full max-w-[360px] rounded-pill border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong" />
                    </div>
                  </div>
                  <TextField label={t("card.name")} value={draft.name} onChange={(value) => set("name", value)} required />
                  <TextField label={t("card.tags")} value={draft.tags} onChange={(value) => set("tags", value)} placeholder={t("card.tagsPlaceholder")} />
                  <TextField label={t("card.creator")} value={draft.creator} onChange={(value) => set("creator", value)} />
                  <TextField label={t("card.version")} value={draft.character_version} onChange={(value) => set("character_version", value)} />
                </section>
              ) : null}

              {section === "content" ? (
                <section className="grid gap-5 rounded-card border border-line bg-surface p-4 md:p-5">
                  <TextField {...polishProps("description", draft.description, (value) => set("description", value))} label={t("card.description")} value={draft.description} onChange={(value) => set("description", value)} multiline />
                  <TextField {...polishProps("personality", draft.personality, (value) => set("personality", value))} label={t("card.personality")} value={draft.personality} onChange={(value) => set("personality", value)} multiline />
                  <TextField {...polishProps("scenario", draft.scenario, (value) => set("scenario", value))} label={t("card.scenario")} value={draft.scenario} onChange={(value) => set("scenario", value)} multiline />
                  <TextField {...polishProps("first_mes", draft.first_mes, (value) => set("first_mes", value))} label={t("card.firstMes")} value={draft.first_mes} onChange={(value) => set("first_mes", value)} multiline />
                  <TextField {...polishProps("mes_example", draft.mes_example, (value) => set("mes_example", value))} label={t("card.examples")} value={draft.mes_example} onChange={(value) => set("mes_example", value)} multiline />
                  <TextField {...polishProps("alternate_greetings", draft.alternate_greetings, (value) => set("alternate_greetings", value))} label={t("card.alternateGreetings")} value={draft.alternate_greetings} onChange={(value) => set("alternate_greetings", value)} multiline placeholder={t("card.alternateGreetingsPlaceholder")} />
                </section>
              ) : null}

              {section === "voice" ? (
                <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
                  <h2 className="m-0 text-[15px] font-bold text-ink">{t("voice.title")}</h2>
                  <ChoiceRow label={t("voice.sentenceLength")} value={draft.voice.sentenceLength} options={[{ value: "short", label: t("voice.length.short") }, { value: "medium", label: t("voice.length.medium") }, { value: "long", label: t("voice.length.long") }]} onChange={(value) => setVoice({ sentenceLength: value })} />
                  <ChoiceRow label={t("voice.directness")} value={draft.voice.directness} options={[{ value: "direct", label: t("voice.direct.direct") }, { value: "indirect", label: t("voice.direct.indirect") }]} onChange={(value) => setVoice({ directness: value })} />
                  <ChoiceRow label={t("voice.emotion")} value={draft.voice.emotionalExpression} options={[{ value: "open", label: t("voice.emotion.open") }, { value: "restrained", label: t("voice.emotion.restrained") }]} onChange={(value) => setVoice({ emotionalExpression: value })} />
                  <TextField {...polishProps("voice", draft.voice.vocabulary.join("、"), (value) => setVoiceList("vocabulary", value))} label={t("voice.vocabulary")} value={draft.voice.vocabulary.join("、")} onChange={(value) => setVoiceList("vocabulary", value)} placeholder={t("voice.vocabularyPlaceholder")} />
                  <TextField {...polishProps("voice", draft.voice.habits.join("、"), (value) => setVoiceList("habits", value))} label={t("voice.habits")} value={draft.voice.habits.join("、")} onChange={(value) => setVoiceList("habits", value)} placeholder={t("voice.habitsPlaceholder")} />
                  <TextField {...polishProps("voice", draft.voice.avoidances.join("、"), (value) => setVoiceList("avoidances", value))} label={t("voice.avoidances")} value={draft.voice.avoidances.join("、")} onChange={(value) => setVoiceList("avoidances", value)} placeholder={t("voice.avoidancesPlaceholder")} />
                  <TextField {...polishProps("voice", draft.voice.sampleLines.join("\n"), (value) => setVoiceList("sampleLines", value, "\n"))} label={t("voice.samples")} value={draft.voice.sampleLines.join("\n")} onChange={(value) => setVoiceList("sampleLines", value, "\n")} multiline placeholder={t("voice.samplesPlaceholder")} />
                </section>
              ) : null}

              {section === "capabilities" ? (
                <AttachmentsEditor
                  attachments={draft.attachments}
                  onChange={(attachments) => set("attachments", attachments)}
                  onPolish={(field, value, key) => polishValue(field, value, key)}
                  polishingKey={polishingField}
                  polishLabel={t("card.aiPolish")}
                  polishingLabel={t("card.aiPolishing")}
                />
              ) : null}

              {section === "advanced" ? (
                <section className="grid gap-5 rounded-card border border-line bg-surface p-4 md:p-5">
                  <TextField {...polishProps("system_prompt", draft.system_prompt, (value) => set("system_prompt", value))} label={t("card.systemPrompt")} value={draft.system_prompt} onChange={(value) => set("system_prompt", value)} multiline />
                  <TextField {...polishProps("post_history_instructions", draft.post_history_instructions, (value) => set("post_history_instructions", value))} label={t("card.postHistory")} value={draft.post_history_instructions} onChange={(value) => set("post_history_instructions", value)} multiline />
                  <TextField {...polishProps("author_note", draft.author_note, (value) => set("author_note", value))} label={t("card.authorNote")} value={draft.author_note} onChange={(value) => set("author_note", value)} multiline placeholder={t("card.authorNotePlaceholder")} />
                </section>
              ) : null}
            </main>

            <EditorInspector draft={draft} sectionLabel={sections.find((item) => item.value === section)?.label ?? ""} t={t} />
          </div>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              <PillButton type="button" size="sm" onClick={() => void exportCard("json")}>{t("card.exportJson")}</PillButton>
              <PillButton type="button" size="sm" onClick={() => void exportCard("png")}>{t("card.exportPng")}</PillButton>
            </div>
            <PillButton type="button" onClick={onCancel} disabled={saving}>{t("card.cancel")}</PillButton>
          </footer>
        </div>
      </form>
    </div>
  );
}
