import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/* 按钮层级靠填充区分，不靠大小堆。
   同一屏主按钮最多一个；破坏性操作才允许用高饱和红。 */
type PillVariant = "primary" | "ghost" | "danger";
type PillSize = "sm" | "md";

const PILL_VARIANT: Record<PillVariant, string> = {
  primary:
    "bg-accent text-accent-ink border-transparent hover:bg-accent-hover disabled:bg-surface-2 disabled:text-ink-2",
  ghost:
    "bg-surface text-ink border-line font-medium hover:border-line-strong disabled:bg-surface-2 disabled:text-ink-2 disabled:border-transparent",
  danger:
    "bg-danger text-danger-ink border-transparent hover:bg-danger-hover disabled:bg-surface-2 disabled:text-ink-2",
};

const PILL_SIZE: Record<PillSize, string> = {
  sm: "px-[15px] py-[7px] text-[13.5px]",
  md: "px-[22px] py-[11px] text-[15px]",
};

export function PillButton({
  variant = "ghost",
  size = "md",
  block = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: PillVariant;
  size?: PillSize;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-pill border font-bold transition-colors",
        "disabled:cursor-default",
        PILL_VARIANT[variant],
        PILL_SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-pill border border-line bg-surface text-ink",
        "transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-45",
        className,
      )}
      {...rest}
    />
  );
}

/* 屏幕内的返回入口：比图标按钮多一个箭头和文字，压在内容流里 */
export function BackPill({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-4 py-2 pl-3",
        "text-sm font-medium text-ink transition-colors hover:border-line-strong",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true">←</span>
      {children}
    </button>
  );
}
