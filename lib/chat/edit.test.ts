import { describe, expect, it } from "vitest";
import {
  RESUMMARIZE_DISTANCE,
  STALE_LABELS,
  applyEdit,
  reportStale,
} from "./edit";

describe("编辑消息：改正文", () => {
  const turns = [
    { id: "a", content: "开场白", image: undefined },
    { id: "b", content: "我问她看的是什么书。", image: "data:image/png;base64,x" },
    { id: "c", content: "……你又没事干了？" },
  ];

  it("只改那一条的正文", () => {
    const result = applyEdit(turns, "b", "我问她在读什么。");
    expect(result.turns[1].content).toBe("我问她在读什么。");
    expect(result.turns[0].content).toBe("开场白");
    expect(result.turns[2].content).toBe("……你又没事干了？");
  });

  it("别的字段原样保留：改文字不该顺手把附件弄丢", () => {
    const result = applyEdit(turns, "b", "改了");
    expect(result.turns[1].image).toBe("data:image/png;base64,x");
  });

  it("不修改原数组", () => {
    const before = JSON.stringify(turns);
    applyEdit(turns, "b", "改了");
    expect(JSON.stringify(turns)).toBe(before);
  });

  it("带出被编辑那条的下标，调用方要拿它判断从哪儿重跑", () => {
    expect(applyEdit(turns, "b", "改了").index).toBe(1);
  });

  it("找不到 id 时原样返回，不报错", () => {
    const result = applyEdit(turns, "没有这个", "改了");
    expect(result.turns).toHaveLength(3);
    expect(result.edited).toBeUndefined();
    expect(result.index).toBe(-1);
  });
});

describe("编辑消息：状态过时判定", () => {
  // 状态是到第 5 条消息为止推出来的（索引 4）
  const THROUGH = 4;

  it("改最新一条：状态没有从它推出来，不用做事", () => {
    const report = reportStale({ index: 4, role: "user" }, THROUGH, 5);
    expect(report.stale).toEqual([]);
    expect(report.action).toBe("none");
  });

  it("改更早的一条：四种状态全标过时", () => {
    const report = reportStale({ index: 3, role: "user" }, THROUGH, 5);
    expect(report.stale).toEqual(["scene", "threads", "summary", "facts"]);
    expect(report.action).toBe("mark");
    expect(report.note).toContain("场景状态");
    expect(report.note).toContain("关键事实");
  });

  it("改得很早：建议重新生成摘要", () => {
    const report = reportStale({ index: 1, role: "user" }, THROUGH, 4 + RESUMMARIZE_DISTANCE);
    expect(report.action).toBe("resummarize");
    expect(report.note).toContain("重新生成摘要");
  });

  it("刚好等于状态覆盖范围时不算过时", () => {
    // 状态是那一轮结束时算的，编辑那一轮的输入影响很小，
    // 每次都提示会让编辑变得很烦
    expect(reportStale({ index: 4, role: "user" }, THROUGH, 9).stale).toEqual([]);
  });

  it("还没有任何状态时不提示", () => {
    const report = reportStale({ index: 1, role: "user" }, 0, 9);
    expect(report.stale).toEqual([]);
    expect(report.action).toBe("none");
  });

  it("四种状态的标签都齐", () => {
    expect(Object.values(STALE_LABELS)).toEqual(["场景状态", "剧情线", "滚动摘要", "关键事实"]);
  });

  it("报告带上被编辑的下标，调用方要拿它决定从哪儿重跑", () => {
    expect(reportStale({ index: 3, role: "user" }, THROUGH, 9).index).toBe(3);
  });
});
