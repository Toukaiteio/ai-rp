import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/* 输入外壳：整条都是胶囊，输入框本体不带边框，视觉上只有一条线 */
export function Field({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-pill border border-line bg-surface py-[5px] pr-[6px] pl-[18px]",
        "transition-colors focus-within:border-line-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FieldInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-w-0 flex-1 border-0 bg-transparent py-2 text-[14.5px] text-ink outline-none",
        "placeholder:text-ink-3",
        className,
      )}
      {...rest}
    />
  );
}

/* 输入框尾部的圆形小动作（显示密钥、清空等） */
export function FieldAction({
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-[34px] shrink-0 place-items-center rounded-pill border-0 bg-surface-2 text-ink-2",
        "transition-colors hover:text-ink",
        className,
      )}
      {...rest}
    />
  );
}

/* 只留真正影响手感的量：随机度与回复长度 */
export function SliderRow({
  label,
  value,
  display,
  min = 0,
  max = 20,
  step = 1,
  onChange,
  className,
}: {
  label: ReactNode;
  value: number;
  display?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-[14px]", className)}>
      <span className="shrink-0 text-sm text-ink">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 flex-1 accent-accent"
      />
      <output className="min-w-[34px] text-right text-[13.5px] text-ink-2">
        {display ?? value}
      </output>
    </div>
  );
}
