"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import { PillButton } from "@/components/ui";
import type { CharacterCard } from "@/lib/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";
import { confirmCardTranslation, shouldConfirmCardTranslation } from "@/lib/card-translation-preference";
import { clearTranslationSession, translateAndSaveCard, translationBinding, translationDiagnostic, translationErrorKey, type TranslationDiagnostic, type TranslationProgress, type TranslationSession } from "./CardTranslationFlow";
import { getProviderConfigSnapshot, getProviderConfigServerSnapshot, subscribeProviderConfig } from "@/lib/storage/settings";
import { CardTranslationDialog, type CardTranslationStage } from "./CardTranslationDialog";

interface CardTranslationProps {
  card: CharacterCard;
  onCardsChanged?: () => void;
  onOpenSettings?: () => void;
}

export function CardTranslation(props: CardTranslationProps) {
  const { locale } = useI18n();
  const config = useSyncExternalStore(subscribeProviderConfig, getProviderConfigSnapshot, getProviderConfigServerSnapshot);
  return <CardTranslationAction key={translationBinding(props.card, locale, config)} {...props} />;
}

function CardTranslationAction({ card, onCardsChanged, onOpenSettings }: CardTranslationProps) {
  const { locale, t } = useI18n();
  const [stage, setStage] = useState<CardTranslationStage>("closed");
  const [skip, setSkip] = useState(false);
  const [error, setError] = useState<MessageKey>("card.translationFailed");
  const [diagnostic, setDiagnostic] = useState<TranslationDiagnostic>();
  const [progress, setProgress] = useState<TranslationProgress>();
  const [saving, setSaving] = useState(false);
  const session = useRef<TranslationSession>({ checkpoint: { translations: {} } });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = session.current;
    const unsubscribe = subscribeProviderConfig(() => {
      controller.current?.abort();
      controller.current = null;
      clearTranslationSession(current);
      setStage("closed");
    });
    return () => {
      unsubscribe();
      controller.current?.abort();
      clearTranslationSession(current);
    };
  }, []);

  function close() {
    controller.current?.abort();
    controller.current = null;
    clearTranslationSession(session.current);
    setProgress(undefined);
    setSkip(false);
    setStage("closed");
  }

  async function start() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setSaving(false);
    setStage("loading");
    try {
      await translateAndSaveCard(card, locale, request.signal, {
        session: session.current,
        onProgress: (next) => { if (!request.signal.aborted) setProgress(next); },
        onSaving: () => { if (!request.signal.aborted) setSaving(true); },
      });
      if (request.signal.aborted) return;
      setStage("success");
      onCardsChanged?.();
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(translationErrorKey(cause));
      setDiagnostic(translationDiagnostic(cause));
      setStage("error");
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  function open() {
    if (stage === "loading" || controller.current) return;
    setSkip(false);
    setProgress(undefined);
    setDiagnostic(undefined);
    clearTranslationSession(session.current);
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
        <CardTranslationDialog stage={stage} name={card.data.name} skip={skip} error={error} diagnostic={diagnostic} progress={progress} saving={saving}
          onSkip={setSkip} onClose={close}
          onStart={() => { if (stage === "confirm") confirmCardTranslation(skip); void start(); }}
          onOpenSettings={onOpenSettings ? () => { close(); onOpenSettings(); } : undefined} />
      ) : null}
    </>
  );
}
