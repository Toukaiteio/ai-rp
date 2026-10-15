"use client";

import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-i18n";
import { IconSendUp } from "../icons";
import { cn } from "./cn";

/* 输入胶囊：只有一层，发送键常驻右端。
   无输入时是灰圆，有输入立刻变成强调色，状态变化本身就是引导。 */
export function Composer({
  value,
  onChange,
  onSend,
  onPlus,
  placeholder,
  hint,
  hintAlerts = false,
  plusDisabled = false,
  sendDisabled = false,
  hasExtra = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  onPlus?: () => void;
  placeholder?: string;
  hint?: ReactNode;
  /** 提示需要被看见时（比如还没配密钥），聚焦输入框就让提示闪几下 */
  hintAlerts?: boolean;
  plusDisabled?: boolean;
  sendDisabled?: boolean;
  /** 没有文字但有附图时也允许发送 */
  hasExtra?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [grow, setGrow] = useState(false);
  /** 每次聚焦加一，用来重挂提示节点，把动画从头放一遍 */
  const [alertTick, setAlertTick] = useState(0);
  const ready = (value.trim().length > 0 || hasExtra) && !sendDisabled;

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
          aria-label={t("composer.upload")}
          onClick={onPlus}
          disabled={plusDisabled}
          className="grid size-[42px] shrink-0 place-items-center rounded-pill border-0 bg-surface text-ink shadow-raised transition-colors hover:bg-surface-3 disabled:cursor-default disabled:opacity-45"
        >
          <Paperclip className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </button>

        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (hintAlerts) setAlertTick((tick) => tick + 1);
          }}
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
          aria-label={t("composer.send")}
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
        <p
          key={alertTick}
          className={cn(
            "mx-auto mt-2 max-w-[660px] text-center text-xs text-ink-2",
            alertTick > 0 && "hint-alert",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
