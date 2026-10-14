import type { ReactNode } from "react";
import { cn } from "./cn";

/* 锁定态的画面骨架。聊天与设置整个不挂载，这里只放解锁入口。 */
export function LockScreen({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid h-dvh place-items-center bg-background px-6 py-10",
        className,
      )}
    >
      <div className="w-full max-w-[520px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-pill border border-line bg-surface-2 text-ink">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-[21px]"
            >
              <rect x="4" y="10.5" width="16" height="11" rx="3" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            </svg>
          </div>
          <h1 className="m-0 text-[19px] font-bold text-ink">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
