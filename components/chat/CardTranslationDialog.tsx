import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { Dialog, PillButton } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";
import { translationFieldKey, translationLanguageLabel, translationPercent, type TranslationDiagnostic, type TranslationProgress } from "./CardTranslationFlow";

export type CardTranslationStage = "closed" | "confirm" | "loading" | "success" | "error";

export function CardTranslationDialog({ stage, name, targetLanguage, skip, error, diagnostic, progress, saving, onSkip, onClose, onStart, onOpenSettings }: {
  stage: Exclude<CardTranslationStage, "closed">;
  name: string;
  /** 目标语言（送进提示词的语言名），标题里显示成界面语言 */
  targetLanguage: string;
  skip: boolean;
  error: MessageKey;
  diagnostic?: TranslationDiagnostic;
  progress?: TranslationProgress;
  saving?: boolean;
  onSkip: (checked: boolean) => void;
  onClose: () => void;
  onStart: () => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useI18n();
  const percent = translationPercent(progress, stage === "success");
  const completed = stage === "error" ? diagnostic?.completed ?? progress?.completed : progress?.completed;
  const total = stage === "error" ? diagnostic?.total ?? progress?.total : progress?.total;
  const loadingKey: MessageKey = saving ? "card.translationSaving" : progress?.phase === "preparing" ? "card.translationPreparing" : progress?.phase === "validating" || progress?.phase === "complete" ? "card.translationValidating" : "card.translationLoading";
  const field = stage === "error" && diagnostic && diagnostic.field !== "card.translationFieldUnknown" ? diagnostic.field : translationFieldKey(progress?.field);
  const received = stage === "error" ? diagnostic?.receivedCharacters ?? progress?.receivedCharacters : progress?.receivedCharacters;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <div ref={root} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <Dialog open onClose={onClose} closeLabel={t("common.close")} title={t("card.translateToLanguage", { language: translationLanguageLabel(targetLanguage, t) })}>
        <p className="mb-3 text-[13px] font-bold text-ink">{name}</p>
        {stage === "confirm" ? (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">{t("card.translationNotice")}</p>
            <label className="my-4 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <span className="relative grid size-5 shrink-0 place-items-center">
                <input type="checkbox" checked={skip} onChange={(event) => onSkip(event.target.checked)}
                  className="peer size-5 appearance-none rounded border border-line-strong bg-surface checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
                <Check className="pointer-events-none absolute size-3.5 text-accent-ink opacity-0 peer-checked:opacity-100" aria-hidden="true" />
              </span>
              {t("card.translationSkip")}
            </label>
          </>
        ) : (
          <p role={stage === "error" ? "alert" : "status"} aria-live="polite" aria-busy={stage === "loading"}
            className={`my-4 text-[13px] leading-relaxed ${stage === "error" ? "text-danger" : "text-ink-2"}`}>
            {t(stage === "loading" ? loadingKey : stage === "success" ? "card.translationSuccess" : error)}
          </p>
        )}
        {stage === "loading" || stage === "success" || (stage === "error" && error !== "card.translationNotConfigured") ? (
          <div className="space-y-2 text-[12px] text-ink-2">
            <div role="progressbar" aria-label={t("card.translationCharacters")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
            <p>{t("card.translationCharacters")}: {progress?.completedCharacters ?? 0} / {progress?.totalCharacters ?? "—"} · {percent}%</p>
            <p>{t("card.translationSegments")}: {completed ?? 0} / {total ?? "—"}</p>
            {stage !== "success" ? <>
              <p>{t("card.translationField")}: {t(field)}</p>
              <p>{t("card.translationReceived")}: {received ?? 0}</p>
            </> : null}
          </div>
        ) : null}
        {stage === "error" && error !== "card.translationNotConfigured" && error !== "card.translationSaveFailed" ? (
          <p className="mt-3 text-[13px] text-danger">{t(diagnostic?.reason ?? "card.translationReasonUnknown")}{diagnostic?.status ? ` (HTTP ${diagnostic.status})` : ""}</p>
        ) : null}
        {stage === "error" && error === "card.translationSaveFailed" ? (
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">{t("card.translationSaveRetryNotice")}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <PillButton size="sm" onClick={onClose}>{t(stage === "confirm" || stage === "loading" ? "card.cancel" : "common.close")}</PillButton>
          {stage === "confirm" ? (
            <PillButton size="sm" variant="primary" onClick={onStart}>{t("card.translationStart")}</PillButton>
          ) : null}
          {stage === "error" && error === "card.translationNotConfigured" && onOpenSettings ? (
            <PillButton size="sm" variant="primary" onClick={onOpenSettings}>{t("card.translationSettings")}</PillButton>
          ) : null}
          {stage === "error" ? <PillButton size="sm" onClick={onStart}>{t(error === "card.translationSaveFailed" ? "card.translationRetrySave" : error === "card.translationNotConfigured" ? "common.retry" : "card.translationContinue")}</PillButton> : null}
        </div>
      </Dialog>
    </div>
  );
}
