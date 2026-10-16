"use client";

import { Paperclip } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const boxRef = useRef<HTMLDivElement>(null);
  /** 每次聚焦加一，用来重挂提示节点，把动画从头放一遍 */
  const [alertTick, setAlertTick] = useState(0);
  const ready = (value.trim().length > 0 || hasExtra) && !sendDisabled;

  /* 撑到内容高度，再让 CSS 的 max-height 收住（手机三行、桌面四行）。
     用 layout effect 先测量再绘制，避免输入变成多行时闪一下。圆角直接写入
     DOM，不为此增加一次 React 渲染。 */
  useLayoutEffect(() => {
    const el = ref.current;
    const box = boxRef.current;
    if (!el || !box) return;
    el.style.height = "auto";
    const height = el.scrollHeight;
    el.style.height = `${height}px`;
    box.style.borderRadius = height > 44 ? "24px" : "9999px";
  }, [value]);

  function submit() {
    if (!ready) return;
    onSend?.();
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={boxRef}
        className={cn(
          "mx-auto flex max-w-[660px] items-end gap-2 overflow-hidden rounded-pill border border-line bg-surface-2 p-1.5",
          "transition-[border-radius] duration-[250ms] ease-[cubic-bezier(.22,1,.36,1)]",
          "motion-reduce:transition-none",
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
          className={cn(
            // 手机三行、桌面四行，超过就在框内滚动
            "max-h-[88px] min-h-[42px] min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-[9px] text-[15.5px] leading-normal text-ink outline-none placeholder:text-ink-3 md:max-h-[112px]",
            // 空框时只有 placeholder，别让它跟着换行：单行截断，长了打省略号
            value.length === 0 && "overflow-hidden text-ellipsis whitespace-nowrap",
          )}
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
