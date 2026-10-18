/**
 * 场景状态。
 *
 * 它回答一个问题：**现在是什么情况**——在哪儿、什么时候、谁在场、正在发生什么、
 * 气氛如何、有哪些线还没收。
 *
 * 和记忆的分工：
 * - 记忆（journal / facts）记的是「已经发生过的事」，长线、跨场景；
 * - 场景状态记的是「此刻」，每轮都可能变，变了就覆盖。
 *
 * 所以它不写进前缀（每轮都在变），而是拼进回合层，跟着历史走。
 */

/** 一个字段的可信度。5.3 的核心：猜测不能变成设定。 */
export type StateFactStatus = "confirmed" | "inferred" | "uncertain";

export const STATE_FACT_STATUSES: readonly StateFactStatus[] = [
  "confirmed",
  "inferred",
  "uncertain",
];

/** 状态里的字段名。status / updatedTurn 这两张表按它索引。 */
export const SCENE_FIELDS = [
  "location",
  "time",
  "weather",
  "presentCharacters",
  "currentAction",
  "emotionalTone",
  "unresolvedThreads",
] as const;

export type SceneFieldKey = (typeof SCENE_FIELDS)[number];

/**
 * 场景状态。
 *
 * 字段形状照 5.1 的约定，另加两张表：
 * - `status`：每个字段是确认的事实、推断还是不确定；
 * - `updatedTurn`：每个字段是第几轮定下来的，用来判断它有多旧。
 *
 * 分成两张表而不是把每个字段包成 `{ value, status }`，是为了让提示词拼装
 * 和存储都保持扁平——这两处是最常读写的地方。
 */
export interface SceneState {
  location: string;
  time: string;
  weather?: string;
  presentCharacters: string[];
  currentAction: string;
  emotionalTone?: string;
  unresolvedThreads: string[];
  lastUpdatedAt: number;
  status: Record<SceneFieldKey, StateFactStatus>;
  updatedTurn: Record<SceneFieldKey, number>;
  /**
   * 被挡下来的改动：模型想用一个没有依据的值覆盖已确认的事实。
   * 留着给开发面板看，也是以后「人工确认」的入口。
   */
  pending?: StateConflict[];
}

/** 一条被挡下来的改动。 */
export interface StateConflict {
  key: SceneFieldKey;
  /** 已确认的旧值 */
  current: string;
  /** 模型想写进来的值 */
  proposed: string;
  turn: number;
}

/**
 * 一轮的状态变化。
 *
 * 由导演阶段给出（5.2 的第一版做法）。字段都是可选的：
 * 没给的字段一律保持原样，**绝不用空值清空已有状态**。
 */
export interface ScenePatch {
  location?: string;
  time?: string;
  weather?: string;
  presentCharacters?: string[];
  currentAction?: string;
  emotionalTone?: string;
  unresolvedThreads?: string[];
  /** 逐字段的可信度。没给的字段看 confidence，再没有就按 inferred。 */
  status?: Partial<Record<SceneFieldKey, StateFactStatus>>;
  /** 整批改动的自评可信度 */
  confidence?: StateFactStatus;
}

/** 一处真正的变化。只有变化项才进这个列表，也就是 5.2 的「只保存变化项」。 */
export interface StateChange {
  key: SceneFieldKey;
  from: string;
  to: string;
  status: StateFactStatus;
  /** 从什么状态升/降到了什么状态 */
  statusFrom: StateFactStatus | null;
}

/** 兼容旧名字：状态变化就是 StateChange。 */
export type SceneChange = StateChange;

/** 一次应用的结果。 */
export interface StateUpdate {
  state: SceneState;
  changes: StateChange[];
  conflicts: StateConflict[];
}

export function emptySceneState(now = 0): SceneState {
  return {
    location: "",
    time: "",
    presentCharacters: [],
    currentAction: "",
    unresolvedThreads: [],
    lastUpdatedAt: now,
    status: {
      location: "uncertain",
      time: "uncertain",
      weather: "uncertain",
      presentCharacters: "uncertain",
      currentAction: "uncertain",
      emotionalTone: "uncertain",
      unresolvedThreads: "uncertain",
    },
    updatedTurn: {
      location: -1,
      time: -1,
      weather: -1,
      presentCharacters: -1,
      currentAction: -1,
      emotionalTone: -1,
      unresolvedThreads: -1,
    },
  };
}
