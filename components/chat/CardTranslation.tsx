"use client";

import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { PillButton } from "@/components/ui";
import type { CharacterCard } from "@/lib/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";
import { confirmCardTranslation, shouldConfirmCardTranslation } from "@/lib/card-translation-preference";
import { translateAndSaveCard, translationErrorKey } from "./CardTranslationFlow";
import { CardTranslationDialog, type CardTranslationStage } from "./CardTranslationDialog";

export function CardTranslation({ card, onCardsChanged, onOpenSettings }: {
  card: CharacterCard;
  onCardsChanged?: () => void;
  onOpenSettings?: () => void;
}) {
  const { locale, t } = useI18n();
  const [stage, setStage] = useState<CardTranslationStage>("closed");
  const [skip, setSkip] = useState(false);
  const [error, setError] = useState<MessageKey>("card.translationFailed");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); }, []);

  function close() {
    controller.current?.abort();
    controller.current = null;
    setSkip(false);
    setStage("closed");
  }

  async function start() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setStage("loading");
    try {
      await translateAndSaveCard(card, locale, request.signal);
      if (request.signal.aborted) return;
      setStage("success");
      onCardsChanged?.();
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(translationErrorKey(cause));
      setStage("error");
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  function open() {
    if (stage === "loading" || controller.current) return;
    setSkip(false);
    if (shouldConfirmCardTranslation()) setStage("confirm");
    else void start();
  }

  return (
    <>
      <PillButton size="sm" block aria-label={`${t("card.translate")} · ${card.data.name}`} disabled={stage === "loading"} onClick={open}>
        <Languages className="size-4" aria-hidden="true" />
        {t("card.translate")}
      </PillButton>
      {stage !== "closed" ? (
        <CardTranslationDialog stage={stage} name={card.data.name} skip={skip} error={error}
          onSkip={setSkip} onClose={close}
          onStart={() => { if (stage === "confirm") confirmCardTranslation(skip); void start(); }}
          onOpenSettings={onOpenSettings ? () => { close(); onOpenSettings(); } : undefined} />
      ) : null}
    </>
  );
}
