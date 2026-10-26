import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assemble, planBudget, withExtraMessage, defaultCost } from "@/lib/prompt";
import { buildInspector } from "@/lib/prompt/inspector";
import { formatInspector } from "@/lib/prompt/inspector";
import { DevReportPanel } from "./DevReportPanel";
import { PromptInspectorView } from "./PromptInspectorPanel";

/**
 * 面板的渲染测试。
 *
 * 组件读的是内存里的日志（useSyncExternalStore），所以这里主要验证
 * 「没数据时不崩、结构完整」——真实内容由 lib/prompt/inspector.test.ts
 * 那 27 条纯函数测试覆盖。
 */
describe("Prompt Inspector 面板", () => {
  it("没有记录时也画得出来，提示还没有数据", () => {
    const html = renderToStaticMarkup(<PromptInspectorView />);
    expect(html).toContain("0 条");
    expect(html).not.toContain("激活的世界书条目");
  });

  it("开发面板只渲染提示词结构视图", () => {
    const html = renderToStaticMarkup(<DevReportPanel open onClose={() => {}} />);
    expect(html).toContain("提示词结构");
    expect(html).not.toContain("检查结果");
  });
});

/**
 * 面板数据的自检：拿一份真实组装结果走一遍，
 * 确认展示所需的信息一个都不缺——这是 Inspector 能不能用来定位问题的前提。
 */
describe("Prompt Inspector：定位问题需要的信息都在", () => {
  const result = assemble({
    card: {
      name: "深月风花",
      description: "同班同学。",
      personality: "别扭。",
      scenario: "午休的教室。",
      post_history_instructions: "不要替玩家行动。",
      author_note: "慢一点。",
      voice: {
        sentenceLength: "short",
        directness: "indirect",
        emotionalExpression: "restrained",
        vocabulary: [],
        habits: [],
        avoidances: [],
        sampleLines: [],
      },
    },
    lorebooks: {
      card: { entries: [{ keys: ["书"], content: "她手里是《心》。" }] },
      chat: { entries: [{ keys: [], constant: true, content: "这一场是深秋。" }] },
    },
    history: [
      { role: "assistant", content: '<dlg who="深月风花">……你又没事干了？</dlg>' },
      { role: "user", content: "我问她看的是什么书。" },
    ],
    seed: 1,
    budget: planBudget(16_000, 1024),
  });

  const inspector = withExtraMessage(
    result.inspector,
    { role: "system", content: '{"beats":[{"kind":"act","text":"她翻页。"}]}' },
    { section: "director", layer: "post", detail: "导演计划" },
    defaultCost,
  );

  it("消息顺序和最终发出去的一致", () => {
    const flat = inspector.messages.map((row) => row.content);
    expect(flat.slice(0, result.messages.length)).toEqual(
      result.messages.map((message) => message.content),
    );
    expect(flat[flat.length - 1]).toContain("beats");
  });

  it("每条都有 role", () => {
    expect(inspector.messages.every((row) => row.role === "system" || row.role === "user" || row.role === "assistant")).toBe(true);
  });

  it("每条都有来源", () => {
    expect(inspector.messages.every((row) => row.detail.length > 0)).toBe(true);
    expect(inspector.messages.some((row) => row.detail === "未标注")).toBe(false);
  });

  it("每条都有 token 估算", () => {
    expect(inspector.messages.every((row) => row.tokens > 0)).toBe(true);
  });

  it("世界书激活情况可查", () => {
    expect(inspector.lorebook.length).toBe(2);
    expect(inspector.lorebook.map((item) => item.source).sort()).toEqual(["card", "chat"]);
  });

  it("场景状态、剧情线、作者注、导演计划各有着落", () => {
    const sections = new Set(inspector.messages.map((row) => row.section));
    expect(sections.has("scene")).toBe(true);
    expect(sections.has("note")).toBe(true);
    expect(sections.has("director")).toBe(true);
    expect(sections.has("post_history")).toBe(true);
    expect(sections.has("user")).toBe(true);
  });

  it("压成文本之后人能读", () => {
    const text = formatInspector(inspector);
    expect(text).toContain("[Director Plan]");
    expect(text).toContain("导演计划");
    expect(text).toContain("[World Book]");
  });

  it("空标签表也能跑，不崩", () => {
    const empty = buildInspector([{ role: "user", content: "你好" }], {}, defaultCost);
    expect(empty.messages[0].detail).toBe("未标注");
    expect(empty.sections).toHaveLength(1);
  });
});
