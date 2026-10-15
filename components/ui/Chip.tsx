import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/* ------------------------------------------------------------------
   状态胶囊：不带圆点，状态靠文字本身说清
   ------------------------------------------------------------------ */
export function Capsule({
  children,
  tone = "muted",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "strong" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-pill border border-line bg-surface px-[13px] py-[7px] text-[12.5px]",
        tone === "muted" ? "text-ink-2" : "text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export function CapsuleButton({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-pill border border-line bg-surface px-[13px] py-[7px] text-[12.5px] text-ink",
        "transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-45",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------
   选项胶囊：设置页里成排出现，选中靠描边加提亮，不引入色相
   ------------------------------------------------------------------ */
export function OptChip({
  selected = false,
  disabled = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border px-[17px] py-[9px] text-sm transition-colors",
        selected
          ? "border-selected-line bg-selected font-bold text-selected-ink"
          : "border-line bg-surface font-medium text-ink-2 hover:border-line-strong hover:text-ink",
        disabled && "cursor-default opacity-45 hover:border-line hover:text-ink-2",
        className,
      )}
      {...rest}
    />
  );
}

/* 回复下方的低频操作：重新生成、继续、生成 CG */
export function ActPill({
  hot = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { hot?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-[6px] rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[12.5px] text-ink-2",
        "transition-colors hover:border-line-strong hover:text-ink",
        "disabled:cursor-default disabled:opacity-45 disabled:hover:border-line disabled:hover:text-ink-2",
        hot && "border-line-strong text-ink",
        className,
      )}
      {...rest}
    />
  );
}

/* 开场的建议输入：只在没有对话时出现，点一下就填进输入框 */
export function SuggestChip({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-pill border border-line bg-surface px-[15px] py-[7px] text-[13.5px] text-ink-2",
        "transition-colors hover:border-accent hover:text-accent",
        className,
      )}
      {...rest}
    />
  );
}

export function Tag({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-pill border border-line px-[9px] py-[1.5px] text-[11px] text-ink-2",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
