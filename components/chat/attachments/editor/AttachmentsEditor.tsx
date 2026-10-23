"use client";

import { useMemo, useState } from "react";
import { PillButton } from "@/components/ui";
import type { CardAttachment, CodexAttachment, MapAttachment, ScriptAttachment, UnknownAttachment } from "@/lib/attachments";
import type { CardPolishField } from "@/lib/cards";
import { PROCEDURAL_WORLD_GENERATOR_ID, PROCEDURAL_WORLD_GENERATOR_VERSION } from "@/lib/attachments";
import { MapAttachmentEditor } from "./MapAttachmentEditor";
import { ScriptAttachmentEditor } from "./ScriptAttachmentEditor";
import { CodexAttachmentEditor } from "./CodexAttachmentEditor";

function newId(kind: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now()}`;
  return `${kind}-${suffix}`;
}

function newMap(): MapAttachment {
  return {
    id: newId("map"),
    kind: "map",
    version: "1",
    title: "新地图",
    generation: {
      mode: "CUSTOM",
      generator: { id: PROCEDURAL_WORLD_GENERATOR_ID, version: PROCEDURAL_WORLD_GENERATOR_VERSION },
      seed: "editor-map",
      parameters: { width: 24, height: 12, continents: 3, landRatio: 0.38, islandDensity: 0.08, regionSize: 4 },
    },
  };
}

function newCodex(): CodexAttachment {
  return { id: newId("codex"), kind: "codex", version: "1", title: "新条目集", entries: [] };
}

function newScript(): ScriptAttachment {
  return {
    id: newId("script"),
    kind: "script",
    version: "1",
    title: "新脚本",
    runtime: "sandbox",
    source: "",
    requestedPermissions: { network: false, filesystem: false, cardScope: true },
    permissions: { network: false, filesystem: false, cardScope: true },
    status: "unsupported",
    enabled: false,
  };
}

function kindLabel(attachment: CardAttachment): string {
  if (attachment.kind === "map") return "地图";
  if (attachment.kind === "codex") return "Codex";
  if (attachment.kind === "script") return "脚本";
  return "未知";
}

function attachmentLabel(attachment: CardAttachment): string {
  return attachment.title?.trim() || `${kindLabel(attachment)} · ${attachment.id}`;
}

function isUnknown(attachment: CardAttachment): attachment is UnknownAttachment {
  return !isMap(attachment) && !isCodex(attachment) && !isScript(attachment);
}

function isMap(attachment: CardAttachment): attachment is MapAttachment {
  return attachment.kind === "map" && "generation" in attachment;
}

function isCodex(attachment: CardAttachment): attachment is CodexAttachment {
  return attachment.kind === "codex" && "entries" in attachment;
}

function isScript(attachment: CardAttachment): attachment is ScriptAttachment {
  return attachment.kind === "script" && "source" in attachment;
}

export function AttachmentsEditor({
  attachments,
  onChange,
  onPolish,
  polishingKey,
  polishLabel,
  polishingLabel,
}: {
  attachments: CardAttachment[];
  onChange: (attachments: CardAttachment[]) => void;
  onPolish: (field: CardPolishField, value: string, key: string) => Promise<string>;
  polishingKey: string | null;
  polishLabel: string;
  polishingLabel: string;
}) {
  const [selectedIdState, setSelectedId] = useState<string | undefined>(attachments[0]?.id);
  const selectedId = selectedIdState && attachments.some((attachment) => attachment.id === selectedIdState)
    ? selectedIdState
    : attachments[0]?.id;
  const selected = useMemo(() => attachments.find((attachment) => attachment.id === selectedId), [attachments, selectedId]);

  function add(attachment: CardAttachment) {
    onChange([...attachments, attachment]);
    setSelectedId(attachment.id);
  }

  function update(attachment: CardAttachment) {
    const currentId = selectedId ?? attachment.id;
    const index = attachments.findIndex((item) => item.id === currentId);
    if (index < 0) return;
    const next = [...attachments];
    next[index] = attachment;
    onChange(next);
    setSelectedId(attachment.id);
  }

  function remove(id: string) {
    const next = attachments.filter((attachment) => attachment.id !== id);
    onChange(next);
    setSelectedId(next[0]?.id);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="rounded-card border border-line bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[14px] font-bold text-ink">能力</h3>
          <span className="text-[11px] text-ink-3">{attachments.length}</span>
        </div>
        <div className="mt-3 grid gap-1.5">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              aria-pressed={attachment.id === selectedId}
              onClick={() => setSelectedId(attachment.id)}
              className={`min-w-0 rounded-md border px-3 py-2 text-left text-[12px] transition-colors ${attachment.id === selectedId ? "border-selected-line bg-selected text-selected-ink" : "border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink"}`}
            >
              <span className="block truncate font-bold">{attachmentLabel(attachment)}</span>
              <span className="mt-0.5 block text-[10px] opacity-75">{kindLabel(attachment)}</span>
            </button>
          ))}
          {attachments.length === 0 ? <p className="m-0 rounded-md bg-surface-2 px-3 py-3 text-[12px] text-ink-3">还没有能力附件</p> : null}
        </div>
        <div className="mt-3 grid gap-1.5">
          <PillButton type="button" size="sm" onClick={() => add(newMap())}>新增地图</PillButton>
          <PillButton type="button" size="sm" onClick={() => add(newCodex())}>新增 Codex</PillButton>
          <PillButton type="button" size="sm" onClick={() => add(newScript())}>新增脚本</PillButton>
        </div>
      </aside>

      <div className="min-w-0">
        {selected && isMap(selected) ? (
          <MapAttachmentEditor
            attachment={selected}
            onChange={update}
            onDelete={() => remove(selected.id)}
            onPolish={onPolish}
            polishingKey={polishingKey}
            polishLabel={polishLabel}
            polishingLabel={polishingLabel}
          />
        ) : null}
        {selected && isScript(selected) ? (
          <ScriptAttachmentEditor
            attachment={selected}
            onChange={update}
            onDelete={() => remove(selected.id)}
            onPolish={onPolish}
            polishingKey={polishingKey}
            polishLabel={polishLabel}
            polishingLabel={polishingLabel}
          />
        ) : null}
        {selected && isCodex(selected) ? (
          <CodexAttachmentEditor
            attachment={selected}
            onChange={update}
            onDelete={() => remove(selected.id)}
            onPolish={onPolish}
            polishingKey={polishingKey}
            polishLabel={polishLabel}
            polishingLabel={polishingLabel}
          />
        ) : null}
        {selected && isUnknown(selected) ? <UnknownSummary attachment={selected} /> : null}
        {!selected ? <div className="rounded-card border border-dashed border-line bg-surface p-6 text-center text-[13px] text-ink-3">选择一个附件，或从左侧新增。</div> : null}
      </div>
    </div>
  );
}

function UnknownSummary({ attachment }: { attachment: UnknownAttachment }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h3 className="m-0 text-[15px] font-bold text-ink">未知附件</h3>
      <p className="m-0 mt-1 text-[11.5px] text-ink-3">只读显示，不执行，也不提供删除入口。</p>
      <pre className="mt-4 max-h-[520px] overflow-auto rounded-md bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">{JSON.stringify(attachment, null, 2)}</pre>
    </section>
  );
}
