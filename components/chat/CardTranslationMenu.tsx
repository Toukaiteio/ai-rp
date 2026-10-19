"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { PillButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { translationLanguages } from "@/lib/cards";
import { hasMessage } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";

/** 目标语言菜单：别在圆形按钮下面的小面板，常见语言一列一个，自定义语言走输入框。
    用 fixed 定位：触发按钮在卡里，卡片 overflow-hidden 会切掉 absolute 的子层。 */
export function CardTranslationMenu({ anchor, current, onClose, onPick }: {
  /** 触发按钮，菜单贴着它展开 */
  anchor: HTMLElement | null;
  /** 当前目标语言（送进提示词的语言名） */
  current: string;
  onClose: () => void;
  onPick: (language: string) => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState("");
  const [origin, setOrigin] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const languages = Object.entries(translationLanguages());
  const label = (code: string, name: string) => {
    const key = `card.lang.${code}`;
    return hasMessage(key) ? t(key) : name;
  };
  const submit = () => {
    const language = custom.trim();
    if (!language) return;
    setCustom("");
    onPick(language);
  };

  // 贴着按钮展开：按钮跟着页面滚，每次布局变化都按视口重算，下面不够就翻到上面
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const height = panel.current?.offsetHeight ?? 0;
      const width = panel.current?.offsetWidth ?? 0;
      const below = box.bottom + 6;
      const top = below + height > window.innerHeight - 8 && box.top - height - 6 >= 8
        ? box.top - height - 6
        : below;
      const left = Math.min(Math.max(8, box.left), Math.max(8, window.innerWidth - width - 8));
      setOrigin({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  // 点外面与按 Esc 都当收起；点触发按钮自己不算外面，交给它自己的 toggle
  useEffect(() => {
    if (!anchor) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={panel}
      style={{ top: origin?.top ?? 0, left: origin?.left ?? 0 }}
      className={cn(
        "fixed z-[60] flex max-h-[70dvh] w-[240px] flex-col rounded-card border border-line bg-surface p-1.5 shadow-pop",
        "transition-opacity duration-150 motion-reduce:transition-none",
        origin ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <p className="m-0 px-2.5 pt-1 pb-1 text-[12px] font-bold text-ink-2">{t("card.translateTo")}</p>
      <div role="menu" className="flex flex-col overflow-y-auto">
        {languages.map(([code, name]) => (
          <button
            key={code}
            type="button"
            role="menuitem"
            aria-current={name === current ? "true" : undefined}
            onClick={() => onPick(name)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
              name === current ? "bg-selected font-bold text-selected-ink" : "text-ink hover:bg-surface-2",
            )}
          >
            <span className="truncate">{label(code, name)}</span>
            {name === current ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="mt-1 border-t border-line px-0.5 pt-2 pb-0.5">
        <p className="m-0 mb-1.5 px-1.5 text-[12px] text-ink-2">{t("card.translateCustom")}</p>
        <div className="flex items-center gap-1.5">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
            placeholder={t("card.translateCustomPlaceholder")}
            aria-label={t("card.translateCustom")}
            className="min-w-0 flex-1 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
          />
          <PillButton size="sm" variant="primary" disabled={!custom.trim()} onClick={submit}>
            {t("common.confirm")}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
