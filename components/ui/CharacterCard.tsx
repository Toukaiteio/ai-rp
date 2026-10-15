import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PillButton } from "./Button";
import { cn } from "./cn";

/* 角色卡：默认只露名字和标签，简介、轮数与卡级操作压在画面上，悬停或键盘聚焦才浮出。
   名字过长时同一个悬停动作把它横向推到底，露出后半段。当前角色用灰态按钮代替，不给假入口。 */
export function CharacterCard({
  portrait,
  name,
  description,
  tags,
  turns,
  actions,
  current = false,
  currentLabel,
  startLabel,
  onStart,
  className,
}: {
  portrait?: ReactNode;
  name: ReactNode;
  description: ReactNode;
  tags?: ReactNode;
  turns?: ReactNode;
  actions?: ReactNode;
  current?: boolean;
  currentLabel?: ReactNode;
  startLabel: ReactNode;
  onStart?: () => void;
  className?: string;
}) {
  const info = (
    <>
      <p className="m-0 line-clamp-4 text-[12px] leading-relaxed text-ink-2">{description}</p>
      <div className="flex items-center gap-2">
        {turns ? (
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{turns}</span>
        ) : (
          <span className="flex-1" />
        )}
        {actions}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-card border border-line bg-surface",
        className,
      )}
    >
      <div className="relative aspect-[4/3.2] w-full shrink-0 overflow-hidden bg-surface-2">
        {portrait}
        <div className="card-info-hover absolute inset-0 justify-end gap-2.5 bg-surface/95 p-3.5">
          {info}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">
        <div className="card-name font-serif text-[15.5px] leading-tight font-black text-ink">
          <span>{name}</span>
        </div>
        {tags ? <div className="card-tags">{tags}</div> : null}
        <div className="card-info-inline">{info}</div>
        <span className="flex-1" />
        <PillButton
          size="sm"
          variant={current ? "ghost" : "primary"}
          disabled={current}
          onClick={onStart}
          className={cn("w-full", current && "border-transparent bg-surface-2 text-ink-2")}
        >
          {current ? currentLabel ?? "" : startLabel}
        </PillButton>
      </div>
    </div>
  );
}

/* 导入角色卡：虚线框，和实心角色卡区分开 */
export function ImportCard({
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-card border-[1.5px] border-dashed border-line bg-transparent p-5 text-[14.5px] text-ink-2",
        "transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      <span className="grid size-[52px] place-items-center rounded-pill border-[1.5px] border-line text-2xl font-normal text-ink">
        +
      </span>
      {label}
    </button>
  );
}
