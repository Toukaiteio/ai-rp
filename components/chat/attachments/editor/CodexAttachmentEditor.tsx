"use client";

import { PillButton } from "@/components/ui";
import type { CodexAttachment, CodexEntry } from "@/lib/attachments";
import type { CardPolishField } from "@/lib/cards";
import { AiPolishButton } from "../../AiPolishButton";

const FIELD_CLASS =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong";

function newEntry(): CodexEntry {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now()}`;
  return { id: `entry-${suffix}`, title: "新条目", content: "", tags: [], enabled: true };
}

export function CodexAttachmentEditor({
  attachment,
  onChange,
  onDelete,
  onPolish = async () => "",
  polishingKey = null,
  polishLabel = "AI polish",
  polishingLabel = "…",
}: {
  attachment: CodexAttachment;
  onChange: (attachment: CodexAttachment) => void;
  onDelete: () => void;
  onPolish?: (field: CardPolishField, value: string, key: string) => Promise<string>;
  polishingKey?: string | null;
  polishLabel?: string;
  polishingLabel?: string;
}) {
  function patch(patch: Partial<CodexAttachment>) {
    onChange({ ...attachment, ...patch });
  }

  function updateEntry(id: string, patch: Partial<CodexEntry>) {
    onChange({
      ...attachment,
      entries: attachment.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry),
    });
  }

  function addEntry() {
    onChange({ ...attachment, entries: [...attachment.entries, newEntry()] });
  }

  function removeEntry(id: string) {
    onChange({ ...attachment, entries: attachment.entries.filter((entry) => entry.id !== id) });
  }

  function polish(field: CardPolishField, value: string, key: string, apply: (next: string) => void) {
    void onPolish(field, value, key).then(apply).catch(() => undefined);
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold text-ink">Codex 设置</h3>
          <p className="m-0 mt-1 text-[11.5px] text-ink-3">条目可被模型通过安全查询工具读取，也可声明式更新。</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <PillButton type="button" size="sm" onClick={addEntry}>新增条目</PillButton>
          <PillButton type="button" size="sm" variant="danger" onClick={onDelete}>删除</PillButton>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
              <span>标题</span>
              <AiPolishButton
                onClick={() => polish("codex_title", attachment.title ?? "", `${attachment.id}:title`, (next) => patch({ title: next }))}
                busy={polishingKey === `${attachment.id}:title`}
                label={polishLabel}
                workingLabel={polishingLabel}
              />
            </span>
          <input className={FIELD_CLASS} value={attachment.title ?? ""} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end text-[12px] text-ink-2">
          <input type="checkbox" checked={attachment.enabled !== false} onChange={(event) => patch({ enabled: event.target.checked })} />
          启用这个 Codex
        </label>
      </div>

      <div className="mt-4 grid gap-3">
        {attachment.entries.map((entry) => (
          <article key={entry.id} className="rounded-md border border-line bg-surface-2 p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
                    <span>条目标题</span>
                    <AiPolishButton
                      onClick={() => polish("codex_entry_title", entry.title, `${attachment.id}:${entry.id}:title`, (next) => updateEntry(entry.id, { title: next }))}
                      busy={polishingKey === `${attachment.id}:${entry.id}:title`}
                      label={polishLabel}
                      workingLabel={polishingLabel}
                    />
                  </span>
                  <input className={FIELD_CLASS} value={entry.title} onChange={(event) => updateEntry(entry.id, { title: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
                    <span>标签</span>
                    <AiPolishButton
                      onClick={() => polish("codex_entry_tags", entry.tags.join("、"), `${attachment.id}:${entry.id}:tags`, (next) => updateEntry(entry.id, { tags: next.split("、").map((tag) => tag.trim()).filter(Boolean) }))}
                      busy={polishingKey === `${attachment.id}:${entry.id}:tags`}
                      label={polishLabel}
                      workingLabel={polishingLabel}
                    />
                  </span>
                  <input className={FIELD_CLASS} value={entry.tags.join("、")} onChange={(event) => updateEntry(entry.id, { tags: event.target.value.split("、").map((tag) => tag.trim()).filter(Boolean) })} />
                </label>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 pb-2 text-[12px] text-ink-2">
                  <input type="checkbox" checked={entry.enabled} onChange={(event) => updateEntry(entry.id, { enabled: event.target.checked })} />
                  启用
                </label>
                <PillButton type="button" size="sm" variant="danger" onClick={() => removeEntry(entry.id)}>删除</PillButton>
              </div>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
                <span>内容</span>
                <AiPolishButton
                  onClick={() => polish("codex_entry_content", entry.content, `${attachment.id}:${entry.id}:content`, (next) => updateEntry(entry.id, { content: next }))}
                  busy={polishingKey === `${attachment.id}:${entry.id}:content`}
                  label={polishLabel}
                  workingLabel={polishingLabel}
                />
              </span>
              <textarea className={`${FIELD_CLASS} min-h-[120px] resize-y`} value={entry.content} onChange={(event) => updateEntry(entry.id, { content: event.target.value })} />
            </label>
          </article>
        ))}
        {attachment.entries.length === 0 ? <p className="m-0 rounded-md bg-surface-2 px-3 py-4 text-[12px] text-ink-3">还没有条目，点击“新增条目”开始编辑。</p> : null}
      </div>
    </section>
  );
}
