import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./Markdown";

describe("Markdown 中的替换文本", () => {
  it("把宏替换值渲染成带虚线的可点击文本", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
        text="Hello [Lin](macro:0)."
        macroMarkers={{ 0: { text: "Lin", name: "user", source: "{{user}}" } }}
        onMacroClick={() => {}}
      />,
    );

    expect(html).toContain("Lin");
    expect(html).toContain("border-dashed");
    expect(html).toContain('title="{{user}}"');
    expect(html).not.toContain('href="macro:0"');
  });
});
