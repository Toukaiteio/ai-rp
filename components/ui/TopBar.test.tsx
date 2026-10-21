import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopBar } from "./TopBar";

const labels = {
  whoLabel: "切换角色",
  historyLabel: "回退",
  exportLabel: "导出",
  settingsLabel: "设置",
};

describe("TopBar", () => {
  it("floating 时浮在内容上，否则排在流里", () => {
    const floating = renderToStaticMarkup(<TopBar name="A" {...labels} floating />);
    const inline = renderToStaticMarkup(<TopBar name="A" {...labels} />);

    expect(floating).toContain("absolute inset-x-0 top-0");
    expect(inline).toContain("relative");
    expect(inline).not.toContain("absolute");
  });

  it("定位只由 floating 决定，根节点上只有一个 position 类", () => {
    const html = renderToStaticMarkup(<TopBar name="A" {...labels} floating />);
    const root = html.slice(0, html.indexOf(">"));

    expect(root.match(/\b(absolute|relative|fixed|sticky)\b/g)).toHaveLength(1);
  });
});
