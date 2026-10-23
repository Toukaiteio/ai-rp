"use client";

import type { ReactNode } from "react";
import type { CodexAttachment } from "@/lib/attachments";
import { AttachmentWorkspace, type AttachmentWorkspaceMode } from "./AttachmentWorkspace";

export interface CodexAttachmentViewProps {
  attachment: CodexAttachment;
  mode?: AttachmentWorkspaceMode;
  open?: boolean;
  title?: ReactNode;
  onClose?: () => void;
  onBackToChat?: () => void;
  onAskCharacter?: () => void;
  tabs?: Array<{ id: string; label: ReactNode }>;
  activeTabId?: string;
  onTabChange?: (id: string) => void;
}

export function CodexAttachmentView({
  attachment,
  mode = "desktop",
  open = true,
  title = attachment.title ?? "条目",
  onClose,
  onBackToChat,
  onAskCharacter,
  tabs,
  activeTabId,
  onTabChange,
}: CodexAttachmentViewProps) {
  const entries = attachment.entries.filter((entry) => entry.enabled);

  return (
    <AttachmentWorkspace
      mode={mode}
      open={open}
      title={title}
      subtitle={`${entries.length} 条`}
      onClose={onClose}
      onBackToChat={onBackToChat}
      onAskCharacter={onAskCharacter}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
    >
      <div className="grid gap-2 p-3 md:grid-cols-2 md:p-4">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-card border border-line bg-surface-2 p-3">
            <h3 className="m-0 text-[14px] font-bold text-ink">{entry.title}</h3>
            {entry.tags.length > 0 ? (
              <p className="m-0 mt-1 text-[11px] text-ink-3">{entry.tags.join(" · ")}</p>
            ) : null}
            <p className="m-0 mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{entry.content}</p>
          </article>
        ))}
        {entries.length === 0 ? <p className="m-0 p-2 text-[13px] text-ink-3">没有可显示的条目</p> : null}
      </div>
    </AttachmentWorkspace>
  );
}
