/* 顶栏只做两件事：垫一层从 --bar-scrim 渐隐到透明的底，摆头像与右侧按钮。
 *
 * 这里**不写定位**。浮在内容上还是排在流里，由调用方决定（见 ChatScreen 的 placement）：
 *   - 浮着（absolute）：内容从栏下滚过，渐隐底把内容压暗，才看得出「透明渐变」；
 *   - 排在流里（relative）：栏下面直接就是滚动区，渐变只能落到页面底色上，
 *     观感永远是一条实心黑带——不管 --bar-scrim 调多淡。
 *
 * 设备状态行（app 里没有系统状态栏，时间和电量由网页自己画）由 androidStatus 传入。
 */
import type { ReactNode } from "react";
import { IconBook, IconGear, IconHistory } from "../icons";
import { IconButton } from "./Button";
import { cn } from "./cn";
export function TopBar({
  avatar,
  name,
  subtitle,
  whoLabel,
  historyLabel,
  exportLabel,
  settingsLabel,
  onWho,
  onHistory,
  onExport,
  onSettings,
  androidStatus,
  /** 跟右侧圆按钮放在一起，尺寸由调用方对齐到 40px */
  extra,
  compact = false,
  floating = false,
  className,
}: {
  avatar?: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  whoLabel: string;
  historyLabel: string;
  exportLabel: string;
  settingsLabel: string;
  onWho?: () => void;
  onHistory?: () => void;
  onExport?: () => void;
  onSettings?: () => void;
  androidStatus?: ReactNode;
  extra?: ReactNode;
  compact?: boolean;
  /**
   * 浮在内容上（内容会从栏下滚过，渐隐底负责压暗它），还是占据流内高度。
   * 只有浮着时 --bar-scrim 的渐变才有东西可渐隐；排在流里时它只落在页面底色上，
   * 看上去必然是一条实心带。定位只在这里决定，调用方不要再传 position 类。
   */
  floating?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col bg-[linear-gradient(to_bottom,var(--bar-scrim),transparent)] px-3 md:px-4",
        floating ? "absolute inset-x-0 top-0 z-20" : "relative z-20",
        androidStatus
          ? "gap-1.5 pt-[max(12px,env(safe-area-inset-top))] pb-3 md:gap-2"
          : "gap-1.5 py-3 md:gap-3",
        className,
      )}
    >
      {androidStatus}
      <div className="flex w-full items-center gap-1.5 md:gap-3">
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
          <IconButton onClick={onHistory} aria-label={historyLabel}>
            <IconHistory />
          </IconButton>
          <IconButton onClick={onExport} aria-label={exportLabel}>
            <IconBook />
          </IconButton>
          <IconButton onClick={onSettings} aria-label={settingsLabel}>
            <IconGear />
          </IconButton>
          {extra}
        </div>
      </div>
    </div>
  );
}
