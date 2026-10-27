"use client";

import { useSyncExternalStore } from "react";
import { ChevronDown, Languages, LoaderCircle, X } from "lucide-react";
import { Bar, IconButton, PillButton } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";
import { translationLanguageLabel, translationPercent } from "./CardTranslationFlow";
import {
  removeCardTranslation,
  retryCardTranslation,
  setTranslationTray,
  subscribeTranslationTasks,
  getTranslationTasksServerSnapshot,
  getTranslationTasksSnapshot,
  getTranslationTrayServerSnapshot,
  getTranslationTraySnapshot,
  type TranslationTaskView,
} from "./CardTranslationTasks";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function isTranslating(task: TranslationTaskView): boolean {
  return task.status === "running" || task.status === "saving";
}

/** 进行中的任务排前面，看完的沉底；各组内按开始顺序。 */
export function sortTranslationTasks(tasks: TranslationTaskView[]): TranslationTaskView[] {
  const rank = (task: TranslationTaskView) => (isTranslating(task) ? 0 : task.status === "failed" ? 1 : 2);
  return [...tasks].sort((left, right) => rank(left) - rank(right) || left.startedAt - right.startedAt);
}

function statusText(task: TranslationTaskView, t: Translate): string {
  if (task.status === "saving") return t("card.translationSaving");
  if (task.progress?.phase === "preparing") return t("card.translationPreparing");
  if (task.progress?.phase === "validating" || task.progress?.phase === "complete") return t("card.translationValidating");
  if (task.progress?.phase === "translating") return t("card.translationTranslating");
  return t("card.translationPreparing");
}

export function TranslationTaskRow({ task, onRetry, onRemove, onOpenSettings }: {
  task: TranslationTaskView;
  onRetry: (id: number) => void;
  onRemove: (id: number) => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useI18n();
  const percent = translationPercent(task.progress, task.status === "done");
  const failedField = task.status === "failed" ? task.diagnostic?.field ?? null : null;
  const retryLabel = task.error === "card.translationSaveFailed"
    ? t("card.translationRetrySave")
    : t("card.translationContinue");
  return (
    <li className="flex flex-col gap-1.5 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-1">
        <p className="m-0 min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{task.name}</p>
        <IconButton
          aria-label={isTranslating(task) ? t("card.cancel") : t("card.translationDismiss")}
          title={isTranslating(task) ? t("card.cancel") : t("card.translationDismiss")}
          className="size-7 border-0 bg-transparent shadow-none"
          onClick={() => onRemove(task.id)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      {task.status === "failed" && task.error ? (
        <p role="alert" className="m-0 text-[12.5px] leading-relaxed text-danger">{t(task.error)}</p>
      ) : null}
      {task.status === "failed" ? (
        <>
          <p className="m-0 text-[12px] leading-relaxed text-ink-2">
            {t(task.diagnostic?.reason ?? "card.translationReasonUnknown")}
            {task.diagnostic?.status ? ` (HTTP ${task.diagnostic.status})` : ""}
          </p>
          {failedField ? (
            <p className="m-0 text-[12px] text-ink-2">{t("card.translationFailedField", { field: t(failedField) })}</p>
          ) : null}
          {task.error === "card.translationSaveFailed" ? (
            <p className="m-0 text-[12px] leading-relaxed text-ink-2">{t("card.translationSaveRetryNotice")}</p>
          ) : null}
        </>
      ) : (
        <p className="m-0 truncate text-[12px] text-ink-2">
          {translationLanguageLabel(task.language, t)} · {task.status === "done" ? t("card.translationSuccess") : statusText(task, t)}
        </p>
      )}
      {isTranslating(task) || task.status === "done" ? (
        <>
          <Bar value={percent} aria-label={t("card.translationTasks")} />
          {isTranslating(task) && (task.progress?.totalCharacters ?? 0) > 0 ? (
            <p className="m-0 text-[12px] tabular-nums text-ink-2">
              {t("card.translationProgress", {
                completed: task.progress?.completedCharacters ?? 0,
                total: task.progress?.totalCharacters ?? 0,
                percent,
              })}
            </p>
          ) : null}
        </>
      ) : null}
      {task.status === "failed" ? (
        <div className="mt-0.5 flex flex-wrap justify-end gap-1.5">
          {task.error === "card.translationNotConfigured" && onOpenSettings ? (
            <PillButton size="sm" variant="primary" onClick={onOpenSettings}>{t("card.translationSettings")}</PillButton>
          ) : null}
          <PillButton size="sm" onClick={() => onRetry(task.id)}>{retryLabel}</PillButton>
        </div>
      ) : null}
    </li>
  );
}

export function TranslationTaskList({ tasks, onRetry, onRemove, onOpenSettings }: {
  tasks: TranslationTaskView[];
  onRetry: (id: number) => void;
  onRemove: (id: number) => void;
  onOpenSettings?: () => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {sortTranslationTasks(tasks).map((task) => (
        <TranslationTaskRow key={task.id} task={task} onRetry={onRetry} onRemove={onRemove} onOpenSettings={onOpenSettings} />
      ))}
    </ul>
  );
}

/** 收起后的形态：左下角一小粒，跑着显示进度，只剩看完的显示条数。 */
export function TranslationTrayPill({ tasks }: { tasks: TranslationTaskView[] }) {
  const { t } = useI18n();
  const active = tasks.filter(isTranslating);
  const running = active[0];
  return (
    <button
      type="button"
      aria-label={t("card.translationOpen")}
      title={t("card.translationOpen")}
      onClick={() => setTranslationTray("open")}
      className="flex items-center gap-2 rounded-pill border border-line bg-surface px-3.5 py-2 text-[12.5px] font-bold text-ink shadow-pop transition-colors hover:border-line-strong"
    >
      {running ? (
        <>
          <LoaderCircle className="size-4 animate-spin text-ink-2" aria-hidden="true" />
          <span className="tabular-nums">{translationPercent(running.progress)}%</span>
          {active.length > 1 ? <span className="text-ink-2">×{active.length}</span> : null}
        </>
      ) : (
        <>
          <Languages className="size-4 text-ink-2" aria-hidden="true" />
          <span className="tabular-nums">{tasks.length}</span>
        </>
      )}
    </button>
  );
}

export function CardTranslationTray({ onSaved, onOpenSettings }: { onSaved?: () => void; onOpenSettings?: () => void }) {
  const { t } = useI18n();
  const tasks = useSyncExternalStore(
    subscribeTranslationTasks, getTranslationTasksSnapshot, getTranslationTasksServerSnapshot);
  const tray = useSyncExternalStore(
    subscribeTranslationTasks, getTranslationTraySnapshot, getTranslationTrayServerSnapshot);
  if (tray === "hidden") return null;
  if (tray === "collapsed") {
    return tasks.length ? (
      <div className="fixed bottom-4 left-4 z-40 sm:bottom-6 sm:left-6">
        <TranslationTrayPill tasks={tasks} />
      </div>
    ) : null;
  }
  return (
    <aside
      aria-label={t("card.translationTasks")}
      className="fixed bottom-4 left-4 z-40 flex max-h-[min(70dvh,420px)] w-[300px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop sm:bottom-6 sm:left-6"
    >
      <div className="flex shrink-0 items-center border-b border-line pr-1.5 pl-4">
        <p className="m-0 flex-1 py-2.5 text-[13px] font-bold text-ink">{t("card.translationTasks")}</p>
        <IconButton
          aria-label={t("card.translationCollapse")}
          title={t("card.translationCollapse")}
          className="size-8 border-0 bg-transparent shadow-none"
          onClick={() => setTranslationTray("collapsed")}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tasks.length ? (
          <TranslationTaskList
            tasks={tasks}
            onRetry={(id) => retryCardTranslation(id, onSaved)}
            onRemove={removeCardTranslation}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">{t("card.translationEmpty")}</p>
        )}
      </div>
    </aside>
  );
}
