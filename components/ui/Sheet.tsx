import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/* 遮罩：抽屉与侧栏共用，点击即关闭 */
export function Veil({
  open,
  onClose,
  className,
}: {
  open: boolean;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClose}
      aria-hidden="true"
      className={cn(
        "absolute inset-0 z-30 bg-veil transition-opacity duration-200 motion-reduce:transition-none",
        open ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    />
  );
}

export function Grab({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "mx-auto mt-1 mb-4 h-1 w-[38px] rounded-pill bg-line",
        className,
      )}
    />
  );
}

/* 底部抽屉：低频功能全部收在这里，不占首屏。
   收起时直接不渲染：translate 只在动画开始时生效，
   首屏那一帧它会先按文档流占位再被移走，用户会看到抽屉闪一下。 */
export function Sheet({
  open,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      className={cn(
        "absolute inset-x-0 bottom-0 z-[31] max-h-[82%] overflow-y-auto rounded-t-frame border-t border-line bg-surface px-[22px] pt-2.5 pb-6",
        className,
      )}
    >
      <Grab />
      {title ? (
        <h3 className="m-0 mb-1 text-[17px] font-bold text-ink">{title}</h3>
      ) : null}
      {description ? (
        <p className="m-0 mb-4 text-[13.5px] text-ink-2">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

/* 抽屉里的一行功能：图标 + 名称 + 右侧注解。
   破坏性操作（重置、删除）用高饱和红，是唯一允许抢眼的地方。 */
export function MenuRow({
  icon,
  note,
  tone = "default",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  note?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-[13px] border-0 border-b border-line bg-transparent px-0.5 py-[14px] text-left text-[15.5px]",
        "transition-colors last:border-b-0 hover:text-ink",
        "disabled:cursor-default disabled:opacity-45",
        tone === "danger" ? "text-danger hover:text-danger-hover" : "text-ink",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span
          className={cn(
            "grid size-[38px] shrink-0 place-items-center rounded-pill bg-surface-2",
            tone === "danger" ? "text-danger" : "text-ink",
          )}
        >
          {icon}
        </span>
      ) : null}
      {children}
      {note ? (
        <span
          className={cn(
            "ml-auto text-[12.5px]",
            tone === "danger"
              ? "font-bold text-danger"
              : "text-ink-2",
          )}
        >
          {note}
        </span>
      ) : null}
    </button>
  );
}

/* 右侧滑出面板：记忆与上下文这类查看型内容 */
export function Panel({
  open,
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { open: boolean; children: ReactNode }) {
  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-[31] w-[min(340px,88%)] overflow-y-auto border-l border-line bg-surface p-5",
        "transition-transform duration-[250ms] ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "translate-x-[105%]",
        className,
      )}
      {...rest}
    >
      {children}
    </aside>
  );
}
