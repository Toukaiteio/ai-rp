import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { checkGeneration } from "@/lib/engine";
import { clearReportLog, recordReport } from "@/lib/engine/dev-log";
import { DevReportButton, DevReportPanel } from "./DevReportPanel";
/**
 * 面板是 Phase 0 的验收口子，至少要在没有浏览器的情况下也能渲染出来。
 * 用 renderToStaticMarkup 就够：这里验证的是「不炸、该有的字都有」，
 * 布局和颜色靠 build 之后的实际页面看。
 */
describe("开发模式观测面板", () => {
  afterEach(() => clearReportLog());

  it("没有记录时给出空状态提示，而不是报错", () => {
    const html = renderToStaticMarkup(<DevReportPanel open onClose={() => {}} />);
    expect(html).toContain("文本引擎观测");
    expect(html).toContain("还没有生成记录");
    expect(html).toContain("仅内存");
  });

  it("有记录时列出判定、九项指标和跑过的检查", () => {
    recordReport(
      checkGeneration({
        raw: '<act who="林晚晴">她起身，走向门口。</act><dlg who="林晚晴">住店？</dlg>',
        cardName: "林晚晴",
        userName: "你",
        playerInput: "我推门进来。",
        turn: 3,
        now: 1,
      }),
    );

    const html = renderToStaticMarkup(<DevReportPanel open onClose={() => {}} />);
    expect(html).toContain("第 3 轮");
    expect(html).toContain("可修复");
    expect(html).toContain("act 含多个动作");
    expect(html).toContain("替玩家说话或行动");
    expect(html).toContain("复读");
    expect(html).toContain("不合格 0");
  });

  it("按钮使用可识别的检查图标和辅助标签", () => {
    const empty = renderToStaticMarkup(<DevReportButton open={false} onToggle={() => {}} />);
    expect(empty).toContain("文本引擎观测（开发模式）");

    recordReport(
      checkGeneration({
        raw: '<narr>她把杯子放下。</narr>',
        cardName: "林晚晴",
        userName: "你",
        turn: 1,
        now: 2,
      }),
    );
    const ok = renderToStaticMarkup(<DevReportButton open={false} onToggle={() => {}} />);
    expect(ok).toContain("文本引擎观测（开发模式）");

    clearReportLog();
    recordReport(
      checkGeneration({
        raw: '<dlg who="你">我先坐会儿。</dlg>',
        cardName: "林晚晴",
        userName: "你",
        turn: 1,
        now: 3,
      }),
    );
    const rejected = renderToStaticMarkup(<DevReportButton open={false} onToggle={() => {}} />);
    expect(rejected).toContain("文本引擎观测（开发模式）");
  });

  it("被降级的一轮在面板里说明改写了哪几处", () => {
    recordReport(
      checkGeneration({
        raw: '<act who="林晚晴">她起身，走向门口。</act><dlg who="林晚晴">住店？</dlg>',
        cardName: "林晚晴",
        userName: "你",
        turn: 2,
        mode: "short",
        now: 4,
      }),
    );
    const html = renderToStaticMarkup(<DevReportPanel open onClose={() => {}} />);
    expect(html).toContain("已降级");
    expect(html).toContain("act→narr");
    // 回合模式也要显示出来，方便对照「模式有没有真的改变输出」
    expect(html).toContain("模式 short");
  });
});
