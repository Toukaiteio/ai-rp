"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Languages } from "lucide-react";
import { IconButton } from "@/components/ui";
import type { CharacterCard } from "@/lib/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";
import { confirmCardTranslation, shouldConfirmCardTranslation } from "@/lib/card-translation-preference";
import { clearTranslationSession, defaultTargetLanguage, translateAndSaveCard, translationBinding, translationDiagnostic, translationErrorKey, type TranslationDiagnostic, type TranslationProgress, type TranslationSession } from "./CardTranslationFlow";
import { getProviderConfigSnapshot, getProviderConfigServerSnapshot, subscribeProviderConfig } from "@/lib/storage/settings";
import { CardTranslationDialog, type CardTranslationStage } from "./CardTranslationDialog";
import { CardTranslationMenu } from "./CardTranslationMenu";

interface CardTranslationProps {
  card: CharacterCard;
  onCardsChanged?: () => void;
  onOpenSettings?: () => void;
}

export function CardTranslation(props: CardTranslationProps) {
  const { locale } = useI18n();
  const config = useSyncExternalStore(subscribeProviderConfig, getProviderConfigSnapshot, getProviderConfigServerSnapshot);
  return <CardTranslationAction key={translationBinding(props.card, defaultTargetLanguage(locale), config)} {...props} />;
}

function CardTranslationAction({ card, onCardsChanged, onOpenSettings }: CardTranslationProps) {
  const { locale, t } = useI18n();
  const [target, setTarget] = useState(() => defaultTargetLanguage(locale));
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  async function start(language: string) {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setSaving(false);
    setStage("loading");
    try {
      await translateAndSaveCard(card, language, request.signal, {
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

  function choose(language: string) {
    if (stage === "loading" || controller.current) return;
    setTarget(language);
    setMenuOpen(false);
    setSkip(false);
    setProgress(undefined);
    setDiagnostic(undefined);
    clearTranslationSession(session.current);
    if (shouldConfirmCardTranslation()) setStage("confirm");
    else void start(language);
  }

  return (
    <>
      <IconButton
        aria-label={`${t("card.translationConfirm")} · ${card.data.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={t("card.translationConfirm")}
        className="size-9 bg-surface-2/85 backdrop-blur-sm"
        disabled={stage === "loading"}
        onClick={(event) => { setAnchor(event.currentTarget); setMenuOpen((open) => !open); }}
      >
        <Languages className="size-4" aria-hidden="true" />
      </IconButton>
      {/* 浮层挂到 body：触发按钮在卡里，卡片的层叠上下文会把 z-index 压在邻卡操作之下 */}
      {menuOpen ? createPortal(
        <CardTranslationMenu anchor={anchor} current={target} onClose={() => setMenuOpen(false)} onPick={choose} />,
        document.body,
      ) : null}
      {stage !== "closed" ? createPortal(
        <CardTranslationDialog stage={stage} name={card.data.name} targetLanguage={target} skip={skip} error={error} diagnostic={diagnostic} progress={progress} saving={saving}
          onSkip={setSkip} onClose={close}
          onStart={() => { if (stage === "confirm") confirmCardTranslation(skip); void start(target); }}
          onOpenSettings={onOpenSettings ? () => { close(); onOpenSettings(); } : undefined} />,
        document.body,
      ) : null}
    </>
  );
}
