import type { ReactNode } from "react";
import { cn } from "./cn";

/* 屏幕内页头：标题用衬线，左右两块贴着内容栏的两端，
   左边标题（可带一个前置按钮），右边放返回入口和铃铛这类操作 */
export function ScreenHead({
  title,
  subtitle,
  before,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 标题左侧的前置按钮。角色架把返回对话的箭头放这里 */
  before?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto mb-[18px] flex w-full items-center gap-2.5",
        className,
      )}
    >
      {before}
      <div className="min-w-0">
        <h3 className="m-0 font-serif text-[21px] font-black text-ink">
          {title}
        </h3>
        {subtitle ? (
          <span className="text-[13px] text-ink-2">{subtitle}</span>
        ) : null}
      </div>
      <span className="flex-1" />
      {action}
    </div>
  );
}
