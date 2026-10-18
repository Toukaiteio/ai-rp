/**
 * 场景状态的更新规则。
 *
 * 三件事，全是纯函数：
 * 1. `sanitizePatch`：把导演或轻量模型吐出来的 JSON 收成合法的状态变化；
 * 2. `applyScenePatch`：和旧状态比较，只保存变化项，并且**挡住没依据的覆盖**；
 * 3. `formatSceneState`：拼成回合层里那一段。
 *
 * 5.3 的核心规则在这里：一个字段已经是 confirmed（明确发生过的事实）时，
 * 只有同样是 confirmed 的改动才能覆盖它。模型猜出来的 inferred 值会被挡下来，
 * 记进 `pending` 等人确认，而不是悄悄把设定改掉。
 */
import {
  SCENE_FIELDS,
  STATE_FACT_STATUSES,
  emptySceneState,
  type SceneChange,
  type SceneFieldKey,
  type ScenePatch,
  type SceneState,
  type StateConflict,
  type StateFactStatus,
  type StateUpdate,
} from "./types";

export { emptySceneState };

/** 单个字段的长度上限。场景状态是一行摘要，不是第二份正文。 */
const MAX_FIELD_CHARS = 80;
/** 在场人物最多记几个。未收的线也按这个数收。 */
const MAX_PRESENT = 8;
/** 被挡下来的改动最多留几条。 */
const MAX_CONFLICTS = 6;

/** 数组型字段。它们比较的是整个列表，不是逐项。 */
const LIST_FIELDS: SceneFieldKey[] = ["presentCharacters", "unresolvedThreads"];

/**
 * 每轮都会变、而且本来就该变的字段。
 *
 * 覆盖保护只针对「像设定一样的东西」：地点、时间、在场的人、未收的线。
 * `currentAction` 和 `emotionalTone` 描述的是此刻这一下——「正在发生什么」每轮都不同，
 * 把它锁在上一轮的 confirmed 值上，状态就冻住了。真机跑批里就冻过一次。
 */
const TRANSIENT_FIELDS: SceneFieldKey[] = ["currentAction", "emotionalTone"];

export function isSceneField(value: unknown): value is SceneFieldKey {
  return typeof value === "string" && (SCENE_FIELDS as readonly string[]).includes(value);
}

export function isFactStatus(value: unknown): value is StateFactStatus {
  return typeof value === "string" && (STATE_FACT_STATUSES as readonly string[]).includes(value);
}

/**
 * 把外来的 JSON 收成一个合法的状态变化。
 *
 * 宽松解析：认不出的字段直接丢掉，不因为一个坏字段把整批变化丢掉——
 * 状态是增强信息，宁缺勿错，但也不该因为导演多写了一个键就整轮作废。
 */
export function sanitizePatch(raw: unknown): ScenePatch | null {
  if (!isRecord(raw)) return null;
  // 先收成扁平表再断言成 ScenePatch：逐字段赋值时 TS 会把 key 收窄成
  // 所有字段类型的交集，反而写不进去。
  const fields: Record<string, string | string[]> = {};

  for (const key of SCENE_FIELDS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (LIST_FIELDS.includes(key)) {
      const list = sanitizeList(value);
      if (list) fields[key] = list;
      continue;
    }
    const text = sanitizeText(value);
    if (text) fields[key] = text;
  }

  const patch = fields as ScenePatch;
  const status = sanitizeStatusMap(raw.status);
  if (status) patch.status = status;
  if (isFactStatus(raw.confidence)) patch.confidence = raw.confidence;

  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeStatusMap(raw: unknown): Partial<Record<SceneFieldKey, StateFactStatus>> | null {
  if (!isRecord(raw)) return null;
  const out: Partial<Record<SceneFieldKey, StateFactStatus>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isSceneField(key) || !isFactStatus(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
  return text || null;
}

function sanitizeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => sanitizeText(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items.slice(0, MAX_PRESENT) : null;
}

/**
 * 把一轮的状态变化合进旧状态。
 *
 * 三条规则：
 * 1. **只记变化**：值没变的字段不进 changes，也不刷新 updatedTurn——
 *    这样「这个字段是第几轮定下来的」才真的是它最后一次变化的轮次。
 * 2. **空值不清空**：patch 里没给的字段一律保持原样。
 * 3. **确认的事实挡得住猜测**：旧值是 confirmed 而新值不是 confirmed 时，
 *    改动被挡下来记进 conflicts，旧值保留。除非显式传 force。
 */
export function applyScenePatch(
  current: SceneState,
  patch: ScenePatch | null | undefined,
  turn: number,
  options: { force?: boolean; now?: number } = {},
): StateUpdate {
  const next: SceneState = {
    ...current,
    presentCharacters: [...current.presentCharacters],
    unresolvedThreads: [...current.unresolvedThreads],
    status: { ...current.status },
    updatedTurn: { ...current.updatedTurn },
  };
  const changes: SceneChange[] = [];
  const conflicts: StateConflict[] = [];
  if (!patch) return { state: next, changes, conflicts };

  for (const key of SCENE_FIELDS) {
    if (!(key in patch)) continue;
    const proposed = normalizeValue(key, patch[key as keyof ScenePatch]);
    if (!proposed) continue;

    const before = normalizeValue(key, current[key as keyof SceneState]);
    const nextStatus = patch.status?.[key] ?? patch.confidence ?? "inferred";
    const currentStatus = current.status[key] ?? "uncertain";

    if (before === proposed) continue;

    // 已确认的事实只能被同样是确认的改动覆盖。
    // 瞬时字段例外：它们描述的是此刻，本来就不该被锁住。
    if (
      currentStatus === "confirmed" &&
      nextStatus !== "confirmed" &&
      !options.force &&
      !TRANSIENT_FIELDS.includes(key)
    ) {
      conflicts.push({
        key,
        current: before,
        proposed,
        turn,
      });
      continue;
    }

    setField(next, key, key === "presentCharacters" || key === "unresolvedThreads"
      ? ((patch[key as keyof ScenePatch] as string[]) ?? [])
      : proposed);
    next.status[key] = nextStatus;
    next.updatedTurn[key] = turn;
    changes.push({
      key,
      from: before,
      to: proposed,
      status: nextStatus,
      statusFrom: before ? currentStatus : null,
    });
  }

  next.lastUpdatedAt = options.now ?? current.lastUpdatedAt;
  if (conflicts.length > 0) {
    next.pending = [...(current.pending ?? []), ...conflicts].slice(-MAX_CONFLICTS);
  }
  return { state: next, changes, conflicts };
}

function setField(state: SceneState, key: SceneFieldKey, value: string | string[]): void {
  if (key === "presentCharacters" || key === "unresolvedThreads") {
    state[key] = (Array.isArray(value) ? value : [value]).slice(0, MAX_PRESENT);
    return;
  }
  const text = Array.isArray(value) ? value.join("、") : value;
  if (key === "weather") state.weather = text;
  else if (key === "emotionalTone") state.emotionalTone = text;
  else state[key] = text;
}

/** 把某个字段归一成可以比较的字符串。数组用「、」连起来，比较的是整个列表。 */
function normalizeValue(key: SceneFieldKey, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("、");
  }
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 场景状态在提示词里的样子。
 *
 * 三条讲究：
 * - 每个字段标出可信度：confirmed 才当成事实写，inferred 只能顺着写、
 *   不能当成既定设定，uncertain 要模糊处理。这是 5.3 落到提示词里的那一步。
 * - 空字段不占行。
 * - 没有状态时给一句占位，保证回合层的结构每轮一致。
 */
export function formatSceneState(state: SceneState | undefined): string {
  if (!state) return SCENE_EMPTY;
  const lines: string[] = [];

  const push = (label: string, key: SceneFieldKey, value: string) => {
    if (!value) return;
    lines.push(`- ${label}：${value}（${STATUS_LABELS[state.status[key] ?? "uncertain"]}）`);
  };

  push("地点", "location", state.location);
  push("时间", "time", state.time);
  push("天气", "weather", state.weather ?? "");
  push("在场", "presentCharacters", state.presentCharacters.join("、"));
  push("正在发生", "currentAction", state.currentAction);
  push("气氛", "emotionalTone", state.emotionalTone ?? "");
  push("还没收的线", "unresolvedThreads", state.unresolvedThreads.join("；"));

  return lines.length > 0 ? lines.join("\n") : SCENE_EMPTY;
}

export const SCENE_EMPTY = "（还没有场景状态，按最近的对话判断）";

/** 可信度在提示词里的说法。用整句话，避免模型把 confirmed 当成一个要输出的字段。 */
export const STATUS_LABELS: Record<StateFactStatus, string> = {
  confirmed: "已确认的事实，可以照写",
  inferred: "推断，顺着写就行，不要当成既定设定",
  uncertain: "不确定，写的时候模糊一点",
};

/** 有没有任何字段是确认过的。开发面板和「要不要相信这份状态」都用它。 */
export function hasConfirmedFact(state: SceneState): boolean {
  return SCENE_FIELDS.some((key) => state.status[key] === "confirmed");
}

/** 状态是不是空的。空状态不必写进存储。 */
export function isEmptySceneState(state: SceneState): boolean {
  return SCENE_FIELDS.every((key) => {
    const value = state[key as keyof SceneState];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 旧存档补全。缺字段一律按空状态处理，坏值丢掉。 */
export function normalizeSceneState(value: unknown, now = 0): SceneState {
  const base = emptySceneState(now);
  if (!isRecord(value)) return base;

  for (const key of SCENE_FIELDS) {
    if (!(key in value)) continue;
    if (LIST_FIELDS.includes(key)) {
      const list = sanitizeList(value[key]);
      if (list) setField(base, key, list);
      continue;
    }
    const text = sanitizeText(value[key]);
    if (text) setField(base, key, text);
  }

  const status = sanitizeStatusMap(value.status);
  if (status) base.status = { ...base.status, ...status };

  if (isRecord(value.updatedTurn)) {
    for (const [key, turn] of Object.entries(value.updatedTurn)) {
      if (!isSceneField(key) || typeof turn !== "number" || !Number.isFinite(turn)) continue;
      base.updatedTurn[key] = Math.floor(turn);
    }
  }

  if (Array.isArray(value.pending)) {
    const pending: StateConflict[] = [];
    for (const item of value.pending) {
      if (!isRecord(item) || !isSceneField(item.key)) continue;
      pending.push({
        key: item.key,
        current: typeof item.current === "string" ? item.current.slice(0, MAX_FIELD_CHARS) : "",
        proposed: typeof item.proposed === "string" ? item.proposed.slice(0, MAX_FIELD_CHARS) : "",
        turn: typeof item.turn === "number" ? item.turn : 0,
      });
    }
    if (pending.length > 0) base.pending = pending.slice(-MAX_CONFLICTS);
  }

  if (typeof value.lastUpdatedAt === "number" && Number.isFinite(value.lastUpdatedAt)) {
    base.lastUpdatedAt = value.lastUpdatedAt;
  }
  return base;
}
