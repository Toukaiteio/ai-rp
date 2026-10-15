import type { ReactNode } from "react";
import { IconX } from "../icons";
import { cn } from "./cn";

/* 居中对话框：遮罩加一张居中的卡。
   用 fixed 而不是 absolute：它可能从任何一层里被打开，
   定位基准必须是视口，不能是某个会滚动的祖先，否则就跟着内容跑了。 */
export function Dialog({
  open,
  onClose,
  closeLabel,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-[60] grid place-items-center p-5",
        "transition-opacity duration-200 motion-reduce:transition-none",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="absolute inset-0 bg-veil" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal={open}
        className={cn(
          "relative flex max-h-[72dvh] w-full max-w-[420px] flex-col overflow-hidden",
          "rounded-card border border-line bg-surface shadow-pop",
          className,
        )}
      >
        {title ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3.5">
            <h3 className="m-0 font-serif text-[16px] font-black text-ink">{title}</h3>
            <span className="flex-1" />
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-pill border-0 bg-transparent text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <IconX className="size-4" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
