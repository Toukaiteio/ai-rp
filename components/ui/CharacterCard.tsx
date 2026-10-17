import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PillButton } from "./Button";
import { cn } from "./cn";

/* 角色卡：立绘铺满整张卡，名字与标签压在它的下半部，详情从名字下面撑开。
   卡级操作（导出、删除）固定压在右上角，不用悬停就能看见。
   名字过长时悬停把名字横向推到底，露出后半段。
   当前角色整张可点，点击回到对话；底部按钮仍是灰态，只作状态标识。 */
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
  onReturn,
  returnLabel,
  className,
}: {
  portrait?: ReactNode;
  name: ReactNode;
  description: ReactNode;
  tags?: ReactNode;
  turns?: ReactNode;
  /** 卡级操作，压在右上角 */
  actions?: ReactNode;
  current?: boolean;
  currentLabel?: ReactNode;
  startLabel: ReactNode;
  onStart?: () => void;
  /** 当前角色卡的点击：回到对话。只有传了这个，整张卡才可点 */
  onReturn?: () => void;
  /** 整张卡可点时的无障碍名称，随界面语言传入 */
  returnLabel?: string;
  className?: string;
}) {
  const info = (
    <>
      {/* 压字底永远是深色，浅色主题下这里的文字也不能跟着变深 */}
      <p className="card-info-text m-0 text-[12px] leading-relaxed text-overlay-ink/80">
        {description}
      </p>
      {turns ? (
        <span className="mt-1 block truncate text-[11.5px] text-overlay-ink/60">{turns}</span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "character-card group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface-2",
        className,
      )}
    >
      {/* 立绘铺满整张卡，包括下半部被标题和标签压住的地方 */}
      <div className="card-portrait absolute inset-0">{portrait}</div>

      {/* 卡级操作压右上角，衬一层半透明底，压在什么画面上都看得见 */}
      {actions ? (
        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">{actions}</div>
      ) : null}

      {/* 只负责把卡片撑到应有的高度，立绘在它下面 */}
      <div className="card-spacer aspect-[4/5] w-full shrink-0" aria-hidden="true" />

      {/* 标题与标签压在卡片下半部，垫一层由下往上的黑保证可读。
          绝对定位钉在下缘：详情展开时只朝上吃立绘的区域，卡片尺寸不变 */}
      <div className="card-scrim absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-3.5 pt-3 pb-3.5">
        <div className="card-name font-serif text-[15.5px] leading-tight font-black text-overlay-ink">
          <span>{name}</span>
        </div>
        {tags ? <div className="card-tags">{tags}</div> : null}
        {/* 详情：默认收起，悬停或键盘聚焦时从名字下面撑开 */}
        <div className="card-info">{info}</div>
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

      {/* 当前角色整张可点，盖在标题区上回到对话。
          右上角操作是 z-20，在这层之上，不会被拦。键盘同样可达 */}
      {current && onReturn ? (
        <button
          type="button"
          aria-label={returnLabel ?? (typeof name === "string" ? name : undefined)}
          onClick={onReturn}
          className="absolute inset-0 z-10 cursor-pointer"
        />
      ) : null}
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
        "flex h-full min-h-[112px] flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-dashed border-line bg-transparent p-3 text-[13px] text-ink-2 sm:min-h-[180px] sm:gap-3 sm:p-5 sm:text-[14.5px] lg:min-h-[220px]",
        "transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      <span className="grid size-9 place-items-center rounded-pill border-[1.5px] border-line text-xl font-normal text-ink sm:size-[52px] sm:text-2xl">
        +
      </span>
      {label}
    </button>
  );
}

/** 新建角色卡：实线卡面，与外部文件导入保持区分。 */
export function CreateCard({
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-full min-h-[112px] flex-col items-center justify-center gap-2 rounded-card border border-line bg-surface p-3 text-[13px] text-ink sm:min-h-[180px] sm:gap-3 sm:p-5 sm:text-[14.5px] lg:min-h-[220px]",
        "transition-colors hover:border-line-strong hover:bg-surface-2",
        className,
      )}
      {...rest}
    >
      <span className="grid size-9 place-items-center rounded-pill bg-accent text-xl font-normal text-accent-ink sm:size-[52px] sm:text-2xl">+</span>
      {label}
    </button>
  );
}
