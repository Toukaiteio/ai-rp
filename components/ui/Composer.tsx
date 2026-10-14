"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconSendUp } from "../icons";
import { cn } from "./cn";

/* 输入胶囊：只有一层，发送键常驻右端。
   无输入时是灰圆，有输入立刻变成强调色，状态变化本身就是引导。 */
export function Composer({
  value,
  onChange,
  onSend,
  onPlus,
  placeholder = "说点什么……",
  hint,
  plusDisabled = false,
  sendDisabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  onPlus?: () => void;
  placeholder?: string;
  hint?: ReactNode;
  plusDisabled?: boolean;
  sendDisabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [grow, setGrow] = useState(false);
  const ready = value.trim().length > 0 && !sendDisabled;

  /* 多行时圆角从胶囊退成 28，避免文字贴到圆角切线上 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 110);
    el.style.height = `${next}px`;
    setGrow(next > 44);
  }, [value]);

  function submit() {
    if (!ready) return;
    onSend?.();
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "mx-auto flex max-w-[660px] items-end gap-2 border border-line bg-surface-2 p-1.5 transition-[border-radius]",
          grow ? "rounded-frame" : "rounded-pill",
        )}
      >
        <button
          type="button"
          aria-label="更多功能"
          onClick={onPlus}
          disabled={plusDisabled}
          className="grid size-[42px] shrink-0 place-items-center rounded-pill border-0 bg-surface text-ink shadow-raised transition-colors hover:bg-surface-3 disabled:cursor-default disabled:opacity-45"
        >
          <IconPlus className="size-5" />
        </button>

        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-[110px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-[9px] text-[15.5px] leading-normal text-ink outline-none placeholder:text-ink-3"
        />

        <button
          type="button"
          aria-label="发送"
          onClick={submit}
          disabled={!ready}
          className={cn(
            "grid size-[42px] shrink-0 place-items-center rounded-pill border-0 transition-[background-color,color,transform]",
            ready
              ? "bg-accent text-accent-ink hover:bg-accent-hover active:scale-[.93]"
              : "bg-line text-ink-2",
          )}
        >
          <IconSendUp className="size-5" />
        </button>
      </div>

      {hint ? (
        <p className="mx-auto mt-2 max-w-[660px] text-center text-xs text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
