import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./Markdown";

/** 把模型输出渲染成静态 HTML，验证安全边界和异常输入不炸。 */
function render(text: string): string {
  return renderToStaticMarkup(<MarkdownText text={text} />);
}

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

describe("模型输出的安全边界", () => {
  it("原始 HTML 一律不渲染，script 也进不了页面", () => {
    const html = render('<narr>她把杯子放下。</narr><script>alert(1)</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<narr");
    // 标签里的正文仍然可读
    expect(html).toContain("她把杯子放下。");
  });

  it("链接只放行 http(s) 和 mailto，javascript 与 data 一律落空", () => {
    const bad = render("[点我](javascript:alert(1))和[data](data:text/html,hi)");
    expect(bad).not.toContain("javascript:");
    expect(bad).not.toContain("data:");

    const good = render("[主页](https://example.com)和[信](mailto:a@b.c)");
    expect(good).toContain('href="https://example.com"');
    expect(good).toContain('href="mailto:a@b.c"');
  });

  it("图片不加载，只留说明文字", () => {
    const html = render("![后台](https://example.com/track.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("后台");
  });

  it("链接都带 noopener，不会反向操纵本页", () => {
    const html = render("[外站](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("异常输入不炸：坏链接、孤立标记、超长一行都只是普通文本", () => {
    const html = render(
      '[坏](::::)[^] *** __ ```` <dlg who=" ">未闭合 <b>加粗\n\n\n' + "很长的".repeat(400),
    );
    expect(html).toContain("很长的");
    expect(html).not.toContain("<b>");
  });
});
