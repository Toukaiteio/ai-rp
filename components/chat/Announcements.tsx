"use client";

import { useEffect, useSyncExternalStore } from "react";
import { IconNotice, IconX } from "@/components/icons";
import { Dialog } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import {
  ANNOUNCEMENTS,
  getDismissedServerSnapshot,
  getDismissedSnapshot,
  loadDismissed,
  subscribeAnnouncements,
  visibleAnnouncements,
} from "@/lib/announcements";
import { hasMessage } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";

function copy(
  id: string,
  field: "title" | "body",
  fallback: string,
  t: (key: MessageKey) => string,
): string {
  const key = `announcement.${id}.${field}`;
  return hasMessage(key) ? t(key) : fallback;
}

/** 未读条数。公告是公开信息，只按 id 记在本机，不进加密存储。 */
export function useUnreadCount(): number {
  const dismissed = useSyncExternalStore(
    subscribeAnnouncements,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  );

  useEffect(() => {
    loadDismissed();
  }, []);

  return visibleAnnouncements(dismissed).length;
}

/**
 * 公告铃铛：只有按钮，对话框由调用方挂到屏幕根部。
 * 按钮放哪都行，对话框自己是 fixed 定位，不会跟着内容滚。
 */
export function AnnouncementBell({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const unread = useUnreadCount();
  const { t } = useI18n();

  return (
    <button
      type="button"
      aria-label={unread > 0 ? t("announce.bellUnread", { count: unread }) : t("announce.bell")}
      onClick={onClick}
      className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-pill border border-line bg-surface text-ink",
        "transition-colors hover:border-line-strong",
        className,
      )}
    >
      <IconNotice />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 size-[7px] rounded-pill bg-accent"
        />
      ) : null}
    </button>
  );
}

/**
 * 公告对话框。
 *
 * 不带标题栏。每条公告自己的标题在右侧放一个叉，点它或点遮罩都是关掉，
 * 不记「不再提示」。
 */
export function AnnouncementDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onClose={onClose} closeLabel={t("common.close")}>
      {ANNOUNCEMENTS.length === 0 ? (
        <p className="m-0 py-4 text-center text-[13px] text-ink-2">{t("announce.empty")}</p>
      ) : (
        <div className="flex flex-col">
          {ANNOUNCEMENTS.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "py-3",
                index > 0 ? "border-t border-line" : undefined,
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="font-serif text-[15px] font-black text-ink">
                  {copy(item.id, "title", item.title, t)}
                </span>
                {item.date ? <span className="text-[11.5px] text-ink-3">{item.date}</span> : null}
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={t("common.close")}
                  onClick={onClose}
                  className="grid size-8 shrink-0 place-items-center rounded-pill border-0 bg-transparent text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <IconX className="size-4" />
                </button>
              </div>
              <p className="m-0 whitespace-pre-line text-[13px] leading-[1.75] text-ink-2">
                {copy(item.id, "body", item.body, t)}
              </p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
