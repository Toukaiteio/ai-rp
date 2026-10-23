"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Languages } from "lucide-react";
import { Dialog, IconButton, PillButton } from "@/components/ui";
import type { CharacterCard } from "@/lib/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import { confirmCardTranslation, shouldConfirmCardTranslation } from "@/lib/card-translation-preference";
import { translationLanguageLabel } from "./CardTranslationFlow";
import { startCardTranslation } from "./CardTranslationTasks";
import { CardTranslationMenu } from "./CardTranslationMenu";

interface CardTranslationProps {
  card: CharacterCard;
  /** 译卡入库后回调。首卡场景下调用方用它把画面留在角色架。 */
  onCardsChanged?: () => void;
}

/** 翻译前的知情确认：内容会发给模型、另存新卡。勾「不再提示」之后直接开跑。 */
export function CardTranslationConfirm({ name, language, skip, onSkip, onClose, onStart }: {
  name: string;
  language: string;
  skip: boolean;
  onSkip: (checked: boolean) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onClose={onClose} closeLabel={t("common.close")}
      title={t("card.translateToLanguage", { language: translationLanguageLabel(language, t) })}>
      <p className="mb-3 text-[13px] font-bold text-ink">{name}</p>
      <p className="text-[13px] leading-relaxed text-ink-2">{t("card.translationNotice")}</p>
      <label className="my-4 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
        <span className="relative grid size-5 shrink-0 place-items-center">
          <input type="checkbox" checked={skip} onChange={(event) => onSkip(event.target.checked)}
            className="peer size-5 appearance-none rounded border border-line-strong bg-surface checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
          <Check className="pointer-events-none absolute size-3.5 text-accent-ink opacity-0 peer-checked:opacity-100" aria-hidden="true" />
        </span>
        {t("card.translationSkip")}
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <PillButton size="sm" onClick={onClose}>{t("card.cancel")}</PillButton>
        <PillButton size="sm" variant="primary" onClick={onStart}>{t("card.translationStart")}</PillButton>
      </div>
    </Dialog>
  );
}

export function CardTranslation({ card, onCardsChanged }: CardTranslationProps) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [skip, setSkip] = useState(false);

  function start(language: string) {
    startCardTranslation(card, language, { onSaved: onCardsChanged });
  }

  function choose(language: string) {
    setMenuOpen(false);
    if (shouldConfirmCardTranslation()) {
      setSkip(false);
      setPending(language);
    } else {
      start(language);
    }
  }

  return (
    <>
      <IconButton
        aria-label={`${t("card.translationConfirm")} · ${card.data.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={t("card.translationConfirm")}
        className="size-9 bg-surface-2/85 backdrop-blur-sm"
        onClick={(event) => { setAnchor(event.currentTarget); setMenuOpen((open) => !open); }}
      >
        <Languages className="size-4" aria-hidden="true" />
      </IconButton>
      {/* 浮层挂到 body：触发按钮在卡里，卡片的层叠上下文会把 z-index 压在邻卡操作之下 */}
      {menuOpen ? createPortal(
        <CardTranslationMenu anchor={anchor} current="" onClose={() => setMenuOpen(false)} onPick={choose} />,
        document.body,
      ) : null}
      {pending ? createPortal(
        <CardTranslationConfirm
          name={card.data.name}
          language={pending}
          skip={skip}
          onSkip={setSkip}
          onClose={() => setPending(null)}
          onStart={() => {
            const language = pending;
            confirmCardTranslation(skip);
            setPending(null);
            start(language);
          }}
        />,
        document.body,
      ) : null}
    </>
  );
}
