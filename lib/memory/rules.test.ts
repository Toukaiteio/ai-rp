import { describe, expect, it } from "vitest";
import {
  applyWriteRules,
  conflictNotice,
  confirmCandidate,
  decideWrite,
  isConflict,
  REASON_LABELS,
  REPEAT_THRESHOLD,
  type MemoryCandidate,
} from "./rules";
import { MEMORY_LAYERS, describeLayers, layerOf } from "./layers";

function candidate(over: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return { layer: "character", key: "深月风花", detail: "左手缠着绷带", ...over };
}

describe("记忆分层（7.1）", () => {
  it("五层都有完整的说明", () => {
    expect(MEMORY_LAYERS).toHaveLength(5);
    for (const layer of MEMORY_LAYERS) {
      expect(layer.label.length).toBeGreaterThan(0);
      expect(layer.holds.length).toBeGreaterThan(0);
      expect(layer.stored.length).toBeGreaterThan(0);
      expect(layer.injected.length).toBeGreaterThan(0);
      expect(layer.lifetime.length).toBeGreaterThan(0);
    }
  });

  it("五层分别是场景、角色、世界、剧情、风格", () => {
    expect(MEMORY_LAYERS.map((layer) => layer.id)).toEqual([
      "scene",
      "character",
      "world",
      "plot",
      "style",
    ]);
  });

  it("按 id 取层，取不到就报错", () => {
    expect(layerOf("plot").label).toBe("剧情记忆");
    expect(() => layerOf("nope" as never)).toThrow();
  });

  it("说明里写清每层记什么、存在哪儿、注入在哪儿", () => {
    const text = describeLayers();
    expect(text).toContain("当前场景记忆");
    expect(text).toContain("风格记忆");
    expect(text).toContain("会话");
  });
});

describe("记忆写入规则（7.2）", () => {
  it("一条理由都不满足就不写", () => {
    const decision = decideWrite(candidate());
    expect(decision.write).toBe(false);
    expect(decision.reasons).toEqual([]);
    expect(decision.note).toContain("没有满足");
  });

  it("玩家明确确认可以写", () => {
    const decision = decideWrite(candidate({ playerConfirmed: true }));
    expect(decision.write).toBe(true);
    expect(decision.reasons).toEqual(["player_confirmed"]);
  });

  it("同一事实出现多次可以写", () => {
    expect(decideWrite(candidate({ occurrences: REPEAT_THRESHOLD - 1 })).write).toBe(false);
    expect(decideWrite(candidate({ occurrences: REPEAT_THRESHOLD })).reasons).toEqual(["repeated"]);
  });

  it("对后续剧情有影响可以写", () => {
    expect(decideWrite(candidate({ plotRelevant: true })).reasons).toEqual(["plot_relevant"]);
  });

  it("来自角色卡或世界书可以写", () => {
    expect(decideWrite(candidate({ fromCard: true })).reasons).toEqual(["card_source"]);
  });

  it("被工具调用明确写入可以写", () => {
    expect(decideWrite(candidate({ fromTool: true })).reasons).toEqual(["tool_call"]);
  });

  it("多条理由同时命中时都记下来", () => {
    const decision = decideWrite(
      candidate({ fromTool: true, playerConfirmed: true, occurrences: 3 }),
    );
    expect(decision.reasons).toEqual(["tool_call", "player_confirmed", "repeated"]);
    expect(decision.note).toContain("被工具调用明确写入");
  });

  it("每个理由都有中文说法", () => {
    for (const label of Object.values(REASON_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("记忆冲突处理（7.3）", () => {
  it("旧内容为空时不算冲突", () => {
    expect(isConflict(candidate())).toBe(false);
  });

  it("新旧内容不同就是冲突", () => {
    expect(isConflict(candidate({ current: "左手缠着绷带", detail: "左手其实是刀伤" }))).toBe(true);
  });

  it("内容一样不算冲突", () => {
    expect(isConflict(candidate({ current: "左手缠着绷带", detail: "左手缠着绷带" }))).toBe(false);
  });

  it("冲突时保留旧事实，不写新的", () => {
    const result = applyWriteRules(
      [
        candidate({
          current: "她说是烫伤",
          detail: "其实是刀伤",
          fromTool: true,
        }),
      ],
      12,
    );

    expect(result.written).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      key: "深月风花",
      kept: "她说是烫伤",
      proposed: "其实是刀伤",
      turn: 12,
    });
  });

  it("没满足写入条件时进 skipped，不算冲突", () => {
    const result = applyWriteRules([candidate({ current: "旧的", detail: "新的" })], 3);
    expect(result.written).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.skipped[0].note).toContain("没有满足");
  });

  it("内容没变时不写，也不报冲突", () => {
    const result = applyWriteRules(
      [candidate({ current: "左手缠着绷带", detail: "左手缠着绷带", fromTool: true })],
      3,
    );
    expect(result.written).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.skipped[0].note).toContain("内容没变");
  });

  it("首次写入（没有旧内容）正常落库", () => {
    const result = applyWriteRules([candidate({ fromTool: true, detail: "左手缠着绷带" })], 1);
    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toMatchObject({ key: "深月风花", detail: "左手缠着绷带" });
    expect(result.conflicts).toHaveLength(0);
  });

  it("一批候选里，该写的写、该挡的挡、该跳的跳", () => {
    const result = applyWriteRules(
      [
        candidate({ key: "甲", detail: "新人物", fromTool: true }),
        candidate({ key: "乙", current: "旧说法", detail: "新说法", playerConfirmed: true }),
        candidate({ key: "丙", detail: "随口一提" }),
      ],
      5,
    );
    expect(result.written.map((item) => item.key)).toEqual(["甲"]);
    expect(result.conflicts.map((item) => item.key)).toEqual(["乙"]);
    expect(result.skipped.map((item) => item.key)).toEqual(["丙"]);
  });

  it("空 key 或空内容直接跳过", () => {
    const result = applyWriteRules(
      [candidate({ key: "  " }), candidate({ detail: "   " })],
      1,
    );
    expect(result.written).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("冲突提示明确说「旧的是对的」，免得模型反复顶", () => {
    const notice = conflictNotice({
      layer: "character",
      key: "深月风花",
      kept: "她说是烫伤",
      proposed: "其实是刀伤",
      turn: 12,
      reasons: ["tool_call"],
    });
    expect(notice).toContain("已经有记录");
    expect(notice).toContain("保留原来的记录");
    expect(notice).toContain("不要重复尝试覆盖");
  });

  it("玩家确认后可以把冲突变成一次正常写入", () => {
    const conflict = {
      layer: "character" as const,
      key: "深月风花",
      kept: "她说是烫伤",
      proposed: "其实是刀伤",
      turn: 12,
      reasons: ["tool_call" as const],
    };
    const confirmed = confirmCandidate(conflict);
    expect(confirmed).toMatchObject({
      key: "深月风花",
      detail: "其实是刀伤",
      playerConfirmed: true,
      overwriteConfirmed: true,
    });

    const result = applyWriteRules([confirmed], 13);
    expect(result.written).toHaveLength(1);
    expect(result.written[0].reasons).toContain("player_confirmed");
    expect(result.conflicts).toHaveLength(0);
  });

  it("光是玩家确认事实存在，还不足以覆盖旧记录", () => {
    // 「对，我左手有伤」不等于「旧记录写错了」，所以还是要等玩家确认那条改动
    const result = applyWriteRules(
      [candidate({ current: "她说是烫伤", detail: "其实是刀伤", playerConfirmed: true })],
      12,
    );
    expect(result.written).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });
});
