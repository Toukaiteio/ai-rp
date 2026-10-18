import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  emptySceneState,
  formatSceneState,
  hasConfirmedFact,
  isEmptySceneState,
  normalizeSceneState,
  sanitizePatch,
  SCENE_EMPTY,
  STATUS_LABELS,
} from "./state";
import type { SceneState } from "./types";

function stateWith(patch: Parameters<typeof applyScenePatch>[1], turn = 0): SceneState {
  return applyScenePatch(emptySceneState(0), patch, turn).state;
}

describe("场景状态：解析", () => {
  it("认得 5.1 里的全部字段", () => {
    const patch = sanitizePatch({
      location: "图书馆",
      time: "午后",
      weather: "阴",
      presentCharacters: ["深月风花", "我"],
      currentAction: "深月风花正在翻书",
      emotionalTone: "回避",
      unresolvedThreads: ["绷带的来历"],
      status: { location: "confirmed", emotionalTone: "inferred" },
      confidence: "inferred",
    });

    expect(patch).toEqual({
      location: "图书馆",
      time: "午后",
      weather: "阴",
      presentCharacters: ["深月风花", "我"],
      currentAction: "深月风花正在翻书",
      emotionalTone: "回避",
      unresolvedThreads: ["绷带的来历"],
      status: { location: "confirmed", emotionalTone: "inferred" },
      confidence: "inferred",
    });
  });

  it("坏字段丢掉，不因为一个坏键把整批变化丢掉", () => {
    const patch = sanitizePatch({
      location: 42,
      time: "  傍晚  ",
      presentCharacters: "不是数组",
      currentAction: "  她 抬头  ",
      nonsense: "丢掉",
    });
    expect(patch).toEqual({ time: "傍晚", currentAction: "她 抬头" });
  });

  it("空字符串和空数组不算变化", () => {
    expect(sanitizePatch({ location: "   ", presentCharacters: [] })).toBeNull();
    expect(sanitizePatch({})).toBeNull();
    expect(sanitizePatch(null)).toBeNull();
    expect(sanitizePatch("不是对象")).toBeNull();
  });

  it("超长的字段被截断，列表有上限", () => {
    const patch = sanitizePatch({
      currentAction: "字".repeat(300),
      presentCharacters: Array.from({ length: 20 }, (_, i) => `人${i}`),
    });
    expect(patch?.currentAction?.length).toBe(80);
    expect(patch?.presentCharacters).toHaveLength(8);
  });

  it("不认识的 status 值被丢掉，不会污染可信度", () => {
    const patch = sanitizePatch({
      location: "图书馆",
      status: { location: "maybe", time: "confirmed" },
    });
    expect(patch?.status).toEqual({ time: "confirmed" });
  });
});

describe("场景状态：只保存变化项", () => {
  it("值没变就不算变化，也不刷新轮次", () => {
    const first = applyScenePatch(emptySceneState(0), { location: "图书馆" }, 3);
    expect(first.changes).toHaveLength(1);
    expect(first.state.updatedTurn.location).toBe(3);

    const second = applyScenePatch(first.state, { location: "图书馆" }, 9);
    expect(second.changes).toHaveLength(0);
    expect(second.state.updatedTurn.location).toBe(3);
  });

  it("patch 里没给的字段保持原样，不会被空值清空", () => {
    const base = stateWith({ location: "图书馆", time: "午后" });
    const next = applyScenePatch(base, { currentAction: "她翻了一页" }, 2).state;
    expect(next.location).toBe("图书馆");
    expect(next.time).toBe("午后");
    expect(next.currentAction).toBe("她翻了一页");
  });

  it("只把变化的那几项记进 changes", () => {
    const base = stateWith({ location: "图书馆", time: "午后", emotionalTone: "平静" });
    const { changes } = applyScenePatch(
      base,
      { location: "走廊", time: "午后", emotionalTone: "回避" },
      4,
    );
    expect(changes.map((change) => change.key).sort()).toEqual(["emotionalTone", "location"]);
    expect(changes.find((change) => change.key === "location")).toMatchObject({
      from: "图书馆",
      to: "走廊",
      status: "inferred",
    });
  });

  it("列表型字段按整个列表比较", () => {
    const base = stateWith({ presentCharacters: ["深月风花", "我"] });
    expect(applyScenePatch(base, { presentCharacters: ["深月风花", "我"] }, 1).changes).toHaveLength(0);
    const moved = applyScenePatch(base, { presentCharacters: ["深月风花"] }, 2);
    expect(moved.changes[0]).toMatchObject({ key: "presentCharacters", to: "深月风花" });
  });
});

describe("场景状态：可信度与覆盖保护（5.3）", () => {
  it("confirmed 的字段挡得住 inferred 的改动", () => {
    const base = stateWith({ location: "图书馆", status: { location: "confirmed" } }, 1);
    const { state, changes, conflicts } = applyScenePatch(base, { location: "天台" }, 2);

    expect(changes).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ key: "location", current: "图书馆", proposed: "天台" });
    // 旧值保留，可信度不掉
    expect(state.location).toBe("图书馆");
    expect(state.status.location).toBe("confirmed");
    // 被挡下来的改动留在 pending 里，等人确认
    expect(state.pending?.[0].proposed).toBe("天台");
  });

  it("同样是 confirmed 的改动可以覆盖", () => {
    const base = stateWith({ location: "图书馆", status: { location: "confirmed" } }, 1);
    const { state, changes } = applyScenePatch(
      base,
      { location: "天台", status: { location: "confirmed" } },
      2,
    );
    expect(changes).toHaveLength(1);
    expect(state.location).toBe("天台");
  });

  it("inferred 之间可以互相覆盖，但不会升级成 confirmed", () => {
    const base = stateWith({ location: "图书馆" }, 1);
    const { state } = applyScenePatch(base, { location: "天台" }, 2);
    expect(state.location).toBe("天台");
    expect(state.status.location).toBe("inferred");
  });

  it("inferred 可以被 confirmed 升级，并记下升级前的状态", () => {
    const base = stateWith({ location: "图书馆" }, 1);
    const { state, changes } = applyScenePatch(
      base,
      { location: "图书馆二楼", status: { location: "confirmed" } },
      2,
    );
    expect(state.status.location).toBe("confirmed");
    expect(changes[0]).toMatchObject({ status: "confirmed", statusFrom: "inferred" });
  });

  it("force 可以强行覆盖，给以后的人工确认留口子", () => {
    const base = stateWith({ location: "图书馆", status: { location: "confirmed" } }, 1);
    const { state, conflicts } = applyScenePatch(base, { location: "天台" }, 2, { force: true });
    expect(conflicts).toHaveLength(0);
    expect(state.location).toBe("天台");
  });

  it("瞬时字段不受保护：正在发生什么本来就该每轮都变", () => {
    // 真机跑批里抓到的：currentAction 被 confirmed 锁住，状态冻在上一轮
    const base = stateWith(
      { currentAction: "她合上书", status: { currentAction: "confirmed" } },
      1,
    );
    const { state, changes, conflicts } = applyScenePatch(
      base,
      { currentAction: "她拎起书包" },
      2,
    );
    expect(conflicts).toHaveLength(0);
    expect(changes).toHaveLength(1);
    expect(state.currentAction).toBe("她拎起书包");
    expect(state.status.currentAction).toBe("inferred");
  });

  it("气氛也是瞬时的，不会被锁住", () => {
    const base = stateWith(
      { emotionalTone: "平静", status: { emotionalTone: "confirmed" } },
      1,
    );
    expect(applyScenePatch(base, { emotionalTone: "戒备" }, 2).conflicts).toHaveLength(0);
  });

  it("地点、时间、在场的人仍然受保护", () => {
    const base = stateWith(
      {
        location: "教室",
        time: "午休",
        presentCharacters: ["深月风花"],
        status: { location: "confirmed", time: "confirmed", presentCharacters: "confirmed" },
      },
      1,
    );
    const { conflicts } = applyScenePatch(
      base,
      { location: "天台", time: "傍晚", presentCharacters: ["深月风花", "店员"] },
      2,
    );
    expect(conflicts.map((conflict) => conflict.key).sort()).toEqual([
      "location",
      "presentCharacters",
      "time",
    ]);
  });

  it("整批 confidence 会作用到没单独标注的字段", () => {
    const base = stateWith({ location: "图书馆" }, 1);
    const { state } = applyScenePatch(base, { location: "天台", confidence: "confirmed" }, 2);
    expect(state.status.location).toBe("confirmed");
  });

  it("被挡下来的改动最多留六条，不会无限堆", () => {
    let state = stateWith({ location: "图书馆", status: { location: "confirmed" } }, 1);
    for (let i = 0; i < 10; i += 1) {
      state = applyScenePatch(state, { location: `别处${i}` }, i + 2).state;
    }
    expect(state.pending?.length).toBe(6);
    expect(state.location).toBe("图书馆");
  });
});

describe("场景状态：拼进提示词", () => {
  it("每个字段标出可信度，确认过的说「可以照写」", () => {
    const state = stateWith(
      {
        location: "图书馆",
        time: "午后",
        presentCharacters: ["深月风花"],
        currentAction: "她在翻书",
        status: { location: "confirmed", currentAction: "inferred" },
      },
      1,
    );
    const text = formatSceneState(state);
    expect(text).toContain("地点：图书馆（已确认的事实，可以照写）");
    expect(text).toContain("正在发生：她在翻书（推断，顺着写就行，不要当成既定设定）");
    expect(text).toContain("在场：深月风花");
    // 空字段不占行
    expect(text).not.toContain("天气");
    expect(text).not.toContain("还没收的线");
  });

  it("没有状态时给一句占位，结构保持每轮一致", () => {
    expect(formatSceneState(undefined)).toBe(SCENE_EMPTY);
    expect(formatSceneState(emptySceneState())).toBe(SCENE_EMPTY);
  });

  it("三种可信度都有对应的说法", () => {
    expect(STATUS_LABELS.confirmed).toContain("事实");
    expect(STATUS_LABELS.inferred).toContain("推断");
    expect(STATUS_LABELS.uncertain).toContain("不确定");
  });

  it("未收的线用分号连起来", () => {
    const state = stateWith({ unresolvedThreads: ["绷带的来历", "借的书还没还"] }, 1);
    expect(formatSceneState(state)).toContain("还没收的线：绷带的来历；借的书还没还");
  });
});

describe("场景状态：存储", () => {
  it("旧存档补全成完整状态，坏值丢掉", () => {
    const state = normalizeSceneState({
      location: "图书馆",
      presentCharacters: ["深月风花", 42],
      status: { location: "confirmed" },
      updatedTurn: { location: 3 },
      lastUpdatedAt: 1234,
    });
    expect(state.location).toBe("图书馆");
    expect(state.presentCharacters).toEqual(["深月风花"]);
    expect(state.status.location).toBe("confirmed");
    expect(state.updatedTurn.location).toBe(3);
    expect(state.lastUpdatedAt).toBe(1234);
  });

  it("完全没有状态时是空状态，不是 undefined", () => {
    expect(normalizeSceneState(undefined)).toEqual(emptySceneState(0));
    expect(isEmptySceneState(normalizeSceneState(undefined))).toBe(true);
  });

  it("有确认过的事实才算「可信状态」", () => {
    expect(hasConfirmedFact(stateWith({ location: "图书馆" }))).toBe(false);
    expect(hasConfirmedFact(stateWith({ location: "图书馆", status: { location: "confirmed" } }))).toBe(
      true,
    );
  });

  it("空状态不会被当成有内容写进存储", () => {
    expect(isEmptySceneState(emptySceneState())).toBe(true);
    expect(isEmptySceneState(stateWith({ location: "图书馆" }))).toBe(false);
  });
});
