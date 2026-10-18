/** 剧情线的对外入口。 */
export {
  MAX_IMPORTANCE,
  MAX_THREADS,
  MIN_IMPORTANCE,
  THREAD_STATUSES,
  isThreadStatus,
  type StoryThread,
  type ThreadPatchEntry,
  type ThreadStatus,
  type ThreadUpdate,
} from "./types";
export {
  DEFAULT_THREAD_LIMIT,
  RECENT_TURNS,
  applyThreadPatch,
  formatThreads,
  normalizeThreads,
  sanitizeThreadPatch,
  selectThreads,
  type SelectedThread,
  type ThreadContext,
} from "./threads";
