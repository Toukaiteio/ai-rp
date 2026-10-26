import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/* 设置页的可折叠分区卡：标题栏点击展开收起，默认展开 */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="overflow-hidden rounded-card border border-line-strong bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between bg-surface-2 px-4 py-3.5 text-left"
      >
        <span className="text-[16px] font-black text-ink">{title}</span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.8}
          className={`size-4 text-ink-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="flex flex-col gap-7 border-t border-line-strong px-4 py-4">{children}</div> : null}
    </section>
  );
}
