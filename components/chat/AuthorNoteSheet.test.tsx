import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyScenePatch, emptySceneState } from "@/lib/scene";
import { AuthorNoteSheet } from "./AuthorNoteSheet";

/**
 * 作者注面板：至少要在没有浏览器的情况下也能渲染出来。
 * 这里验证的是「不炸、该有的字和常用句都有」，布局和交互靠实际页面看。
 */
describe("作者注面板", () => {
  it("关着的时候什么都不渲染", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet open={false} note={null} onClose={() => {}} onSave={() => {}} onClear={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("打开时说明它管什么、不管什么", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet open note={null} onClose={() => {}} onSave={() => {}} onClear={() => {}} />,
    );
    expect(html).toContain("作者注");
    // 说清边界：世界设定不要写在这里
    expect(html).toContain("世界设定和人物设定请写进角色卡");
  });

  it("给出可点的常用句，覆盖节奏、重点、格式、玩家主权、剧情线", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet open note={null} onClose={() => {}} onSave={() => {}} onClear={() => {}} />,
    );
    for (const example of [
      "本轮保持克制。",
      "只写角色对玩家刚才那句话的直接反应。",
      "act 只保留一个可见动作。",
      "不要替玩家行动。",
      "不要推进新的剧情线。",
    ]) {
      expect(html).toContain(example);
    }
  });

  it("带上已有的注记内容和频率、位置选项", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet
        open
        note={{ text: "只写直接反应。", frequency: 2, depth: 2 }}
        cardDefault="卡上的默认：克制一点。"
        onClose={() => {}}
        onSave={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain("只写直接反应。");
    expect(html).toContain("出现频率");
    expect(html).toContain("每 2 轮");
    expect(html).toContain("插入位置");
    expect(html).toContain("倒数第 2 句之前");
    expect(html).toContain("卡上的默认：克制一点。");
  });

  it("没有卡默认注记时不显示那一行", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet open note={null} onClose={() => {}} onSave={() => {}} onClear={() => {}} />,
    );
    expect(html).not.toContain("这张卡的默认作者注");
  });

  it("有场景状态时只读展示，并标出每个字段的可信度", () => {
    const scene = applyScenePatch(
      emptySceneState(0),
      {
        location: "图书馆",
        currentAction: "她在翻书",
        status: { location: "confirmed", currentAction: "inferred" },
      },
      1,
    ).state;

    const html = renderToStaticMarkup(
      <AuthorNoteSheet
        open
        note={null}
        scene={scene}
        onClose={() => {}}
        onSave={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain("当前场景状态");
    expect(html).toContain("图书馆（已确认的事实，可以照写）");
    expect(html).toContain("她在翻书（推断，顺着写就行，不要当成既定设定）");
  });

  it("没有场景状态时不显示那一段", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet
        open
        note={null}
        scene={emptySceneState()}
        onClose={() => {}}
        onSave={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).not.toContain("当前场景状态");
  });

  it("列出还没交代完的线，按重要度排，已解决的不出现", () => {
    const threads = [
      { id: "a", title: "左手绷带的来历", summary: "", status: "open" as const, importance: 5, lastActiveAt: 2, relatedCharacters: [] },
      { id: "b", title: "随口提过的雨伞", summary: "", status: "open" as const, importance: 1, lastActiveAt: 1, relatedCharacters: [] },
      { id: "c", title: "早就说完的事", summary: "", status: "resolved" as const, importance: 5, lastActiveAt: 1, relatedCharacters: [] },
      { id: "d", title: "搁下的约定", summary: "", status: "dormant" as const, importance: 3, lastActiveAt: 1, relatedCharacters: [] },
    ];
    const html = renderToStaticMarkup(
      <AuthorNoteSheet
        open
        note={null}
        threads={threads}
        onClose={() => {}}
        onSave={() => {}}
        onClear={() => {}}
      />,
    );

    expect(html).toContain("还没交代完的事");
    expect(html).toContain("左手绷带的来历");
    expect(html).toContain("重要度 5");
    expect(html).toContain("搁下的约定");
    expect(html).toContain("暂时搁下");
    // 已解决的不列出来
    expect(html).not.toContain("早就说完的事");
    // 重要度高的排在前面
    expect(html.indexOf("左手绷带的来历")).toBeLessThan(html.indexOf("随口提过的雨伞"));
  });

  it("没有剧情线时不显示那一段", () => {
    const html = renderToStaticMarkup(
      <AuthorNoteSheet open note={null} threads={[]} onClose={() => {}} onSave={() => {}} onClear={() => {}} />,
    );
    expect(html).not.toContain("还没交代完的事");
  });
});
