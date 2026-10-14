import type { ReactNode } from "react";
import { cn } from "./cn";

/* 应用外框：抽屉与侧栏都绝对定位在这层里，所以它必须是 relative。
   phone 对应手机宽度，用于检查单列布局。 */
export function Frame({
  children,
  phone = false,
  className,
}: {
  children: ReactNode;
  phone?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-[720px] w-full flex-col overflow-hidden rounded-frame border border-line bg-surface shadow-frame",
        "transition-[max-width] duration-[350ms] ease-out motion-reduce:transition-none",
        phone ? "max-w-[392px]" : "max-w-[880px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
