import type { ReactNode } from "react";
import { cn } from "./cn";

/* 屏幕内页头：标题用衬线，右侧放返回入口，内容居中在 760 栏内 */
export function ScreenHead({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto mb-[18px] flex max-w-[760px] items-center gap-3",
        className,
      )}
    >
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
