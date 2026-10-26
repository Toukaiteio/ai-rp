import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DevReportButton, DevReportPanel } from "./DevReportPanel";
/**
 * 面板现在是提示词结构的单一视图，至少要在没有浏览器的情况下也能渲染出来。
 * 用 renderToStaticMarkup 就够：这里验证的是「不炸、该有的字都有」，
 * 布局和颜色靠 build 之后的实际页面看。
 */
describe("开发模式观测面板", () => {
  it("面板只渲染提示词结构视图", () => {
    const html = renderToStaticMarkup(<DevReportPanel open onClose={() => {}} />);
    expect(html).toContain("提示词结构");
    expect(html).not.toContain("检查结果");
    expect(html).not.toContain("可修复");
  });

  it("按钮使用可识别的图标和辅助标签", () => {
    const html = renderToStaticMarkup(<DevReportButton open={false} onToggle={() => {}} />);
    expect(html).toContain("提示词结构（开发模式）");
  });
});
