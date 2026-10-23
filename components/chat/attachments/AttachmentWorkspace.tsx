"use client";

import type { ReactNode } from "react";
import { IconX } from "@/components/icons";
import { BackPill, IconButton, PillButton, Veil } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export type AttachmentWorkspaceMode = "desktop" | "overlay" | "fullscreen";

export interface AttachmentWorkspaceProps {
  mode?: AttachmentWorkspaceMode;
  open?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  onBackToChat?: () => void;
  onAskCharacter?: () => void;
  closeLabel?: string;
  backLabel?: string;
  askLabel?: string;
  tabs?: Array<{ id: string; label: ReactNode }>;
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  className?: string;
}

const ROOT_CLASS: Record<AttachmentWorkspaceMode, string> = {
  desktop: "absolute inset-0 z-30",
  overlay: "fixed inset-0 z-[50]",
  fullscreen: "fixed inset-0 z-[50]",
};

const PANEL_CLASS: Record<AttachmentWorkspaceMode, string> = {
  desktop:
    "absolute inset-y-0 right-0 z-[31] flex w-[min(420px,100%)] flex-col overflow-hidden border-l border-line bg-surface shadow-pop",
  overlay:
    "absolute inset-3 z-[31] flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-frame md:inset-6",
  fullscreen: "absolute inset-0 z-[31] flex flex-col overflow-hidden bg-surface",
};

export function AttachmentWorkspace({
  mode = "desktop",
  open = true,
  title = "附件",
  subtitle,
  children,
  onClose,
  onBackToChat,
  onAskCharacter,
  closeLabel = "关闭附件",
  backLabel = "返回聊天",
  askLabel = "询问角色",
  tabs,
  activeTabId,
  onTabChange,
  className,
}: AttachmentWorkspaceProps) {
  if (!open) return null;

  const modal = mode !== "desktop";

  return (
    <div className={ROOT_CLASS[mode]} data-attachment-workspace data-mode={mode}>
      {mode === "overlay" ? <Veil open onClose={onClose} /> : null}
      <section
        role={modal ? "dialog" : "complementary"}
        aria-modal={modal ? true : undefined}
        aria-label="附件工作区"
        className={cn(PANEL_CLASS[mode], className)}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 md:px-4">
          {onBackToChat ? (
            <BackPill className="shrink-0" onClick={onBackToChat}>
              {backLabel}
            </BackPill>
          ) : null}
          <div className="min-w-0">
            <h2 className="m-0 truncate font-serif text-[17px] font-black text-ink">{title}</h2>
            {subtitle ? <p className="m-0 truncate text-[12px] text-ink-2">{subtitle}</p> : null}
          </div>
          <span className="flex-1" />
          {onAskCharacter ? (
            <PillButton size="sm" variant="primary" onClick={onAskCharacter}>
              {askLabel}
            </PillButton>
          ) : null}
          {onClose ? (
            <IconButton aria-label={closeLabel} onClick={onClose}>
              <IconX className="size-4" />
            </IconButton>
          ) : null}
        </header>
        {tabs && tabs.length > 1 ? (
          <nav aria-label="附件" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2 md:px-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeTabId === tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={cn(
                  "shrink-0 rounded-pill border px-3 py-1.5 text-[12px] transition-colors",
                  activeTabId === tab.id
                    ? "border-line-strong bg-surface-3 text-ink"
                    : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : null}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </section>
    </div>
  );
}
