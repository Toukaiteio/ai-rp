/**
 * 场景状态的对外入口。
 * 提示词组装、存储、界面都从这里引，不直接引内部文件。
 */
export {
  SCENE_FIELDS,
  STATE_FACT_STATUSES,
  type SceneChange,
  type SceneFieldKey,
  type ScenePatch,
  type SceneState,
  type StateChange,
  type StateConflict,
  type StateFactStatus,
  type StateUpdate,
} from "./types";
export {
  SCENE_EMPTY,
  STATUS_LABELS,
  applyScenePatch,
  emptySceneState,
  formatSceneState,
  hasConfirmedFact,
  isEmptySceneState,
  isFactStatus,
  isSceneField,
  normalizeSceneState,
  sanitizePatch,
} from "./state";
