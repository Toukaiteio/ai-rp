import { describe, expect, it } from "vitest";
import { checkGeneration } from "./report";
import {
  DEV_LOG_LIMIT,
  clearReportLog,
  devReportEnabled,
  formatReportLine,
  recordReport,
  reportLog,
  reportTotals,
} from "./dev-log";

function fakeReport(index: number) {
  return checkGeneration({
    raw: index % 3 === 0 ? '<dlg who="你">我先坐会儿。</dlg>' : '<dlg who="林晚晴">住店？</dlg>',
    cardName: "林晚晴",
    userName: "你",
    turn: index,
    now: index,
  });
}

describe("开发模式观测日志", () => {
  it("环形缓冲不超过上限，保留最近的记录", () => {
    clearReportLog();
    for (let i = 0; i < DEV_LOG_LIMIT + 5; i += 1) recordReport(fakeReport(i));
    const log = reportLog();
    expect(log).toHaveLength(DEV_LOG_LIMIT);
    expect(log[log.length - 1].turn).toBe(DEV_LOG_LIMIT + 4);
    clearReportLog();
  });

  it("汇总统计各判定分支和高频问题", () => {
    clearReportLog();
    for (let i = 0; i < 6; i += 1) recordReport(fakeReport(i));
    const totals = reportTotals(reportLog());
    expect(totals.rounds).toBe(6);
    // 每三条里有一条是替玩家说话，判不合格
    expect(totals.rejected).toBe(2);
    expect(totals.playerControl).toBe(2);
    expect(totals.byCode.some(([code]) => code === "player_control")).toBe(true);
    clearReportLog();
  });

  it("一行摘要里带判定、块数、act 和失败项", () => {
    const report = checkGeneration({
      raw: '<act who="林晚晴">她起身，走向门口。</act>',
      cardName: "林晚晴",
      now: 0,
    });
    const line = formatReportLine(report, 0);
    expect(line).toContain("repair");
    expect(line).toContain("act 1(坏1)");
    expect(line).toContain("act 含多个动作");
  });

  it("没有 window 时不打开观测，避免在服务端渲染里记录", () => {
    expect(devReportEnabled("?dev=1")).toBe(false);
  });
});
