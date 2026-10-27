import type { MessageKey } from "@/lib/i18n";
import type { CharacterCard } from "@/lib/cards";
import { subscribeProviderConfig } from "@/lib/storage/settings";
import {
  clearTranslationSession,
  translateAndSaveCard,
  translationDiagnostic,
  translationErrorKey,
  type TranslationDiagnostic,
  type TranslationProgress,
  type TranslationSession,
} from "./CardTranslationFlow";

export type TranslationTaskStatus = "running" | "saving" | "done" | "failed";

export interface TranslationTaskView {
  id: number;
  name: string;
  /** 送进提示词的目标语言名，展示时经 translationLanguageLabel 换成界面语言 */
  language: string;
  status: TranslationTaskStatus;
  progress?: TranslationProgress;
  error?: MessageKey;
  diagnostic?: TranslationDiagnostic;
  startedAt: number;
}

export type TranslationTrayState = "hidden" | "open" | "collapsed";

interface TaskRecord {
  id: number;
  card: CharacterCard;
  language: string;
  name: string;
  status: TranslationTaskStatus;
  progress?: TranslationProgress;
  error?: MessageKey;
  diagnostic?: TranslationDiagnostic;
  session: TranslationSession;
  controller: AbortController;
  startedAt: number;
}

let nextTaskId = 1;
let records: TaskRecord[] = [];
let views: TranslationTaskView[] = [];
let tray: TranslationTrayState = "hidden";
const listeners = new Set<() => void>();
const emptyViews: TranslationTaskView[] = [];
let configWatched = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function publish(): void {
  views = records.map((record) => ({
    id: record.id,
    name: record.name,
    language: record.language,
    status: record.status,
    ...(record.progress ? { progress: record.progress } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.diagnostic ? { diagnostic: record.diagnostic } : {}),
    startedAt: record.startedAt,
  }));
  if (records.length === 0) tray = "hidden";
  notify();
}

export function subscribeTranslationTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTranslationTasksSnapshot(): TranslationTaskView[] {
  return views;
}

export function getTranslationTasksServerSnapshot(): TranslationTaskView[] {
  return emptyViews;
}

export function hasLiveTranslationTasksSnapshot(): boolean {
  return views.some(
    (task) => task.status === "running" || task.status === "saving" || task.status === "failed",
  );
}

export function hasLiveTranslationTasksServerSnapshot(): boolean {
  return false;
}

export function getTranslationTraySnapshot(): TranslationTrayState {
  return tray;
}

export function getTranslationTrayServerSnapshot(): TranslationTrayState {
  return "hidden";
}

export function setTranslationTray(next: TranslationTrayState): void {
  if (tray === next) return;
  tray = next;
  notify();
}

export function toggleTranslationTray(): void {
  setTranslationTray(tray === "open" ? "collapsed" : "open");
}

/** 任务活着就不重复起同卡同语言的第二份；再点入口时把窗口带回展开态。 */
export function startCardTranslation(
  card: CharacterCard,
  language: string,
  options?: { onSaved?: () => void },
): boolean {
  const active = records.some(
    (record) => record.card === card && record.language === language
      && record.status !== "done" && record.status !== "failed",
  );
  setTranslationTray("open");
  if (active) return false;

  watchProviderConfig();
  const record: TaskRecord = {
    id: nextTaskId++,
    card,
    language,
    name: card.data.name,
    status: "running",
    session: { checkpoint: { translations: {} } },
    controller: new AbortController(),
    startedAt: Date.now(),
  };
  records = [...records, record];
  publish();
  void runTask(record, options?.onSaved);
  return true;
}

async function runTask(record: TaskRecord, onSaved?: () => void): Promise<void> {
  const update = (patch: Partial<TaskRecord>) => {
    if (record.controller.signal.aborted) return;
    Object.assign(record, patch);
    publish();
  };
  try {
    await translateAndSaveCard(record.card, record.language, record.controller.signal, {
      session: record.session,
      onProgress: (progress) => update({ status: "running", progress }),
      onSaving: () => update({ status: "saving" }),
    });
    if (record.controller.signal.aborted) return;
    record.status = "done";
    delete record.error;
    delete record.diagnostic;
    publish();
    onSaved?.();
  } catch (cause) {
    if (record.controller.signal.aborted) return;
    record.status = "failed";
    record.error = translationErrorKey(cause);
    record.diagnostic = translationDiagnostic(cause);
    publish();
  }
}

/** 失败的任务原样续跑：断流续检查点，保存失败只重存，都不再从零开始。 */
export function retryCardTranslation(id: number, onSaved?: () => void): void {
  const record = records.find((task) => task.id === id);
  if (!record || record.status === "running" || record.status === "saving") return;
  record.status = "running";
  record.progress = undefined;
  setTranslationTray("open");
  publish();
  void runTask(record, onSaved);
}

/** 取消进行中的任务和移除已结束的任务是同一个动作：出列表、弃检查点。 */
export function removeCardTranslation(id: number): void {
  const record = records.find((task) => task.id === id);
  if (!record) return;
  record.controller.abort();
  clearTranslationSession(record.session);
  records = records.filter((task) => task !== record);
  publish();
}

/** 配置一动，在跑的任务全部作废：检查点按旧配置绑定，续下去只会混出脏卡。 */
function watchProviderConfig(): void {
  if (configWatched) return;
  configWatched = true;
  subscribeProviderConfig(() => {
    for (const record of [...records]) {
      if (record.status === "running" || record.status === "saving") removeCardTranslation(record.id);
    }
  });
}
