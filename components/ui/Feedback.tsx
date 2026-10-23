import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/* 上下文占用条：底槽用次级填充，进度用主文字色，不引入色相 */
export function Bar({
  value,
  tone = "ink",
  className,
  ...rest
}: {
  value: number,
  tone?: "ink" | "ok" | "danger",
  className?: string,
} & Omit<HTMLAttributes<HTMLDivElement>, "className">) {
  const fill =
    tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-ink";
  return (
    <div
      role="progressbar"
      {...rest}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 overflow-hidden rounded-pill bg-surface-2",
        className,
      )}
    >
      <i
        className={cn("block h-full rounded-pill", fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-selected text-selected-ink",
    ok: "bg-ok-soft text-ok",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-[11px] py-[3px] text-xs font-bold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* 轻提示：整屏最亮的浮层，短暂出现，不打断输入 */
export function Toast({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute bottom-24 left-1/2 z-40 max-w-[92%] -translate-x-1/2 truncate",
        "rounded-pill bg-ink px-5 py-2.5 text-[13.5px] whitespace-nowrap text-background",
        "transition-[opacity,transform] duration-200 motion-reduce:transition-none",
        open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
