import type { ReactNode } from "react";
import { IconBook, IconHistory, IconSliders } from "../icons";
import { IconButton } from "./Button";
import { Capsule, CapsuleButton } from "./Chip";
import { cn } from "./cn";

/* 顶栏：角色入口在左，状态胶囊居中，低频入口收在右侧图标里。
   compact 对应手机宽度——隐藏场景胶囊与角色副标题，只留头像和记忆占用。 */
export function TopBar({
  avatar,
  name,
  subtitle,
  scene,
  memoryPercent,
  onWho,
  onMemory,
  onHistory,
  onExport,
  onSettings,
  compact = false,
  className,
}: {
  avatar?: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  scene?: ReactNode;
  memoryPercent?: ReactNode;
  onWho?: () => void;
  onMemory?: () => void;
  onHistory?: () => void;
  onExport?: () => void;
  onSettings?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-[10px] border-b border-line px-4 py-3",
        className,
      )}
    >
      <button
        type="button"
        onClick={onWho}
        aria-label="切换角色"
        className="flex min-w-0 items-center gap-[10px] border-0 bg-transparent p-0 text-left"
      >
        <span className="size-[42px] shrink-0 overflow-hidden rounded-pill bg-surface-2">
          {avatar}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-serif text-[16.5px] leading-tight font-black text-ink">
            {name}
          </span>
          {subtitle && !compact ? (
            <span className="block truncate text-xs text-ink-2">
              {subtitle}
            </span>
          ) : null}
        </span>
      </button>

      {scene && !compact ? (
        <Capsule className="ml-1">{scene}</Capsule>
      ) : null}

      <span className="flex-1" />

      <CapsuleButton
        onClick={onMemory}
        aria-label="查看记忆与上下文"
        className={compact ? "px-2.5" : undefined}
      >
        <span className={compact ? "hidden" : undefined}>记忆</span>
        {memoryPercent}
      </CapsuleButton>

      <IconButton onClick={onHistory} aria-label="回退消息与重置会话">
        <IconHistory />
      </IconButton>
      <IconButton onClick={onExport} aria-label="导出为 EPUB">
        <IconBook />
      </IconButton>
      <IconButton onClick={onSettings} aria-label="连接设置">
        <IconSliders />
      </IconButton>
    </div>
  );
}
