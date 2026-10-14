import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PillButton } from "./Button";
import { cn } from "./cn";

/* 角色卡：预设角色卡，点「开始」直接进对话。
   当前角色用灰态按钮代替，不给假入口。
   actions 放导出、删除这类卡级操作，排在开始按钮左边。 */
export function CharacterCard({
  portrait,
  name,
  description,
  tags,
  turns,
  actions,
  current = false,
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
  onStart?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-card border border-line bg-surface",
        className,
      )}
    >
      <div className="aspect-[4/3.4] w-full overflow-hidden bg-surface-2">
        {portrait}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pt-[14px] pb-4">
        <div className="font-serif text-[17px] font-black text-ink">{name}</div>
        <p className="m-0 flex-1 text-[13px] leading-relaxed text-ink-2">
          {description}
        </p>
        {tags ? <div className="flex flex-wrap gap-1.5">{tags}</div> : null}
        <div className="flex items-center gap-2">
          {turns ? <span className="text-xs text-ink-2">{turns}</span> : null}
          <span className="flex-1" />
          {actions}
          <PillButton
            size="sm"
            variant={current ? "ghost" : "primary"}
            disabled={current}
            onClick={onStart}
            className={current ? "border-transparent bg-surface-2 text-ink-2" : undefined}
          >
            {current ? "当前角色" : "开始"}
          </PillButton>
        </div>
      </div>
    </div>
  );
}

/* 导入角色卡：虚线框，和实心角色卡区分开 */
export function ImportCard({
  label = "导入角色卡",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label?: ReactNode }) {
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
