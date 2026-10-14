import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Bar } from "./Feedback";
import { cn } from "./cn";

/* 导出章节行：分章按场景切换自动切，导出前可改 */
export function ChapterRow({
  index,
  title,
  note,
  className,
}: {
  index: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-[10px] border-b border-line px-0.5 py-[11px] text-[14.5px] text-ink last:border-b-0",
        className,
      )}
    >
      <span className="shrink-0 rounded-pill border border-line px-[11px] py-[2px] text-xs text-ink-2">
        {index}
      </span>
      {title}
      {note ? (
        <span className="ml-auto text-xs text-ink-2">{note}</span>
      ) : null}
    </div>
  );
}

/* 回退行：点任意一轮即回到那里，用回退代替会话管理列表 */
export function HistoryRow({
  label,
  text,
  action = "回到这里",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: ReactNode;
  text: ReactNode;
  action?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-3 border-0 border-b border-line bg-transparent px-0.5 py-[13px] text-left text-[14.5px] text-ink last:border-b-0",
        className,
      )}
      {...rest}
    >
      <span className="shrink-0 rounded-pill border border-line px-[11px] py-[2px] text-xs whitespace-nowrap text-ink-2">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate group-hover:text-accent">
        {text}
      </span>
      <span className="shrink-0 text-[12.5px] font-bold text-accent">
        {action}
      </span>
    </button>
  );
}

export function BookRow({
  cover,
  title,
  meta,
  className,
}: {
  cover: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-center gap-[14px]", className)}>
      <div className="size-[64px] shrink-0 overflow-hidden rounded-sm bg-surface-2">
        {cover}
      </div>
      <div className="min-w-0">
        <div className="font-serif text-[16.5px] font-black text-ink">
          {title}
        </div>
        <div className="text-[12.5px] text-ink-2">{meta}</div>
      </div>
    </div>
  );
}

/* 上下文分层：固定前缀 / 滚动摘要 / 近期对话 */
export function MemoryLayer({
  name,
  tokens,
  percent,
  badge,
  children,
  className,
}: {
  name: ReactNode;
  tokens: ReactNode;
  percent: number;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3 rounded-lg border border-line px-4 py-[14px]",
        className,
      )}
    >
      <div className="mb-[7px] flex items-center gap-2">
        <span className="text-[14.5px] font-bold text-ink">{name}</span>
        <span className="ml-auto text-[12.5px] whitespace-nowrap text-ink-2">
          {tokens}
        </span>
      </div>
      <p className="m-0 mb-[10px] text-[13px] leading-relaxed text-ink-2">
        {children}
      </p>
      <Bar value={percent} />
      {badge ? <div className="mt-[10px]">{badge}</div> : null}
    </div>
  );
}

export function TotalRow({
  total,
  limit,
  className,
}: {
  total: ReactNode;
  limit: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("my-4 flex items-center justify-between", className)}>
      <b className="text-[15px] font-bold text-ink">{total}</b>
      <span className="text-[13px] text-ink-2">{limit}</span>
    </div>
  );
}

/* 保险库状态：底色用次级填充，警示语用红，其余保持中性 */
export function VaultStatus({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface-2 px-4 py-[14px] text-[13.5px] leading-[1.7] text-ink-2",
        "[&_b]:text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function VaultWarn({ children }: { children: ReactNode }) {
  return <span className="font-bold text-danger">{children}</span>;
}
