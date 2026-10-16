import type { ReactNode } from "react";
import { IconBook, IconBrain, IconHistory, IconSliders } from "../icons";
import { IconButton } from "./Button";
import { cn } from "./cn";

/* 顶栏本身没有底色、没有边框，只浮着左右两块：
   左边一个大胶囊（头像、名字、标签），右边四个圆按钮。
   记忆是大脑图标，外圈进度表示上下文占用的百分比。 */
export function TopBar({
  avatar,
  name,
  subtitle,
  memoryUsed = null,
  whoLabel,
  memoryLabel,
  historyLabel,
  exportLabel,
  settingsLabel,
  onWho,
  onMemory,
  onHistory,
  onExport,
  onSettings,
  /** 跟右侧圆按钮放在一起，尺寸由调用方对齐到 40px */
  extra,
  compact = false,
  className,
}: {
  avatar?: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  /** 0 到 100。还没有统计时为 null，只画空环 */
  memoryUsed?: number | null;
  whoLabel: string;
  memoryLabel: string;
  historyLabel: string;
  exportLabel: string;
  settingsLabel: string;
  onWho?: () => void;
  onMemory?: () => void;
  onHistory?: () => void;
  onExport?: () => void;
  onSettings?: () => void;
  extra?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const used =
    memoryUsed == null ? null : Math.min(100, Math.max(0, Math.round(memoryUsed)));

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 bg-black/25 px-3 py-3 md:gap-3 md:px-4",
        className,
      )}
    >
      <button
        type="button"
        onClick={onWho}
        aria-label={whoLabel}
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-surface p-0 text-left transition-colors hover:border-line-strong md:h-auto md:w-auto md:max-w-[46%] md:min-w-0 md:justify-start md:gap-2.5 md:py-1 md:pr-4 md:pl-1"
      >
        <span className="size-full shrink-0 overflow-hidden rounded-pill bg-surface-2 md:size-10">
          {avatar}
        </span>
        <span className="hidden min-w-0 py-0.5 pr-1 md:block">
          <span className="block truncate font-serif text-[15.5px] leading-tight font-black text-ink">
            {name}
          </span>
          {subtitle && !compact ? (
            <span className="block truncate text-[12px] leading-tight text-ink-2">{subtitle}</span>
          ) : null}
        </span>
      </button>

      <span className="flex-1" />

      <div className="flex shrink-0 items-center gap-1 md:gap-2">
        <MemoryButton percent={used} label={memoryLabel} onClick={onMemory} />
        <IconButton onClick={onHistory} aria-label={historyLabel}>
          <IconHistory />
        </IconButton>
        <IconButton onClick={onExport} aria-label={exportLabel}>
          <IconBook />
        </IconButton>
        <IconButton onClick={onSettings} aria-label={settingsLabel}>
          <IconSliders />
        </IconButton>
        {extra}
      </div>
    </div>
  );
}

/** 大脑图标外圈一环。环的实线长度就是占用百分比。 */
function MemoryButton({
  percent,
  label,
  onClick,
}: {
  percent: number | null;
  label: string;
  onClick?: () => void;
}) {
  /* 40px 的按钮里留一圈。线宽 2.5，半径往里收，避免描边画出按钮。 */
  const radius = 18;
  const stroke = 2.5;
  const circumference = 2 * Math.PI * radius;
  const filled = percent == null ? 0 : (percent / 100) * circumference;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative grid size-10 shrink-0 place-items-center rounded-pill bg-surface text-ink"
    >
      <svg
        viewBox="0 0 40 40"
        className="pointer-events-none absolute inset-0 size-10 -rotate-90 overflow-visible"
        aria-hidden="true"
      >
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {percent != null && percent > 0 ? (
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
          />
        ) : null}
      </svg>
      <IconBrain className="size-[19px]" />
    </button>
  );
}
