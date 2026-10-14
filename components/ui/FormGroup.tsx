import type { ReactNode } from "react";
import { cn } from "./cn";

/* 设置页的一个分组：标题 + 一句解释 + 控件。
   不做大下拉列表，选项全部平铺成胶囊。 */
export function FormGroup({
  title,
  note,
  children,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <h4 className="m-0 mb-1 text-[15px] font-bold text-ink">{title}</h4>
        {note ? (
          <p className="m-0 text-[12.5px] text-ink-2">{note}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* 平铺的选项行：换行排列，不滚动、不折叠 */
export function OptRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>
  );
}
