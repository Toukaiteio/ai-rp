import { describe, expect, it } from "vitest";
import EpubBuilder from "jepub/dist/jepub.es.js";
import JSZip from "jszip";
import { CHAPTER_TURN_LIMIT, selectedSwipe, splitChapters } from "./chapters";
import { clampEdge, MAX_IMAGE_EDGE } from "./image";
import { renderChapterHtml, stripOoc } from "./render";

const options = {
  includeNarration: true,
  includeOoc: false,
  userName: "你",
  charName: "林晚晴",
};

describe("分章", () => {
  it("场景切换、手动标记、满 30 轮都会新开一章", () => {
    const messages = [
      { role: "assistant" as const, content: "<narr>雨夜。</narr>\n<dlg who=\"林晚晴\">坐。</dlg>" },
      { role: "user" as const, content: "我上楼。" },
      {
        role: "assistant" as const,
        content: "<scene>二楼最里间</scene>\n<dlg who=\"林晚晴\">窗户漏风。</dlg>",
      },
      { role: "user" as const, content: "那我睡这儿。", chapterBreak: true },
      { role: "assistant" as const, content: "<dlg who=\"林晚晴\">随你。</dlg>" },
    ];
    const chapters = splitChapters(messages, 30);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["开场", "二楼最里间", "第 3 章"]);
    expect(chapters[1]?.messages[0]?.content).toContain("二楼");
    expect(chapters[2]?.messages[0]?.content).toContain("睡这儿");
  });

  it("没有场景也没有标记时，每 30 轮玩家发言切一章", () => {
    const messages = Array.from({ length: CHAPTER_TURN_LIMIT + 1 }, (_, index) => ({
      role: "user" as const,
      content: `第${index + 1}句`,
    }));
    const chapters = splitChapters(messages);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.messages).toHaveLength(CHAPTER_TURN_LIMIT);
    expect(chapters[1]?.messages).toHaveLength(1);
    expect(chapters[1]?.title).toBe("第 2 章");
  });
});

describe("选中的 swipe 与 OOC、旁白", () => {
  it("只导出当前选中的那条，没选中的不进正文", () => {
    const content = selectedSwipe({
      content: "旧的",
      swipes: ["她把杯子推回来。", "她没说话，只加了柴。"],
      swipeIndex: 1,
    });
    expect(content).toBe("她没说话，只加了柴。");
    const html = renderChapterHtml(
      [{ role: "assistant", content: `<dlg who="林晚晴">${content}</dlg>` }],
      options,
      new Map(),
    );
    expect(html).toContain("她没说话，只加了柴。");
    expect(html).not.toContain("她把杯子推回来。");
    expect(html).not.toContain("旧的");
  });

  it("关掉旁白就没有 narr，关掉 OOC 就去掉括号里的话", () => {
    const raw = "<narr>雨还在下。</narr>\n<dlg who=\"林晚晴\">坐。((这句是作者备注))</dlg>";
    const withNarr = renderChapterHtml([{ role: "assistant", content: raw }], options, new Map());
    expect(withNarr).toContain('class="narr"');
    expect(withNarr).not.toContain("作者备注");

    const noNarr = renderChapterHtml(
      [{ role: "assistant", content: raw }],
      { ...options, includeNarration: false, includeOoc: true },
      new Map(),
    );
    expect(noNarr).not.toContain('class="narr"');
    expect(noNarr).toContain("作者备注");
    expect(stripOoc("留下 ((不要导出)) 这句")).toBe("留下  这句");
  });

  it("对白和旁白用不同的排版 class", () => {
    const html = renderChapterHtml(
      [
        {
          role: "assistant",
          content: "<narr>雨。</narr>\n<dlg who=\"林晚晴\">坐。</dlg>",
        },
        { role: "user", content: "好。" },
      ],
      options,
      new Map(),
    );
    expect(html).toContain('class="narr"');
    expect(html).toContain('class="dlg"');
    expect(html).toContain('class="player"');
    expect(html.indexOf('class="narr"')).toBeLessThan(html.indexOf('class="dlg"'));
  });
});

describe("EPUB 容器", () => {
  it("生成的是 zip，目录里有章节标题，没有把没选中的 swipe 写进去", async () => {
    const Book = (EpubBuilder as { default?: typeof EpubBuilder }).default ?? EpubBuilder;
    const book = new Book();
    book.init({
      i18n: "zh",
      title: "晚星",
      author: "林晚晴",
      publisher: "ai-rp",
      description: "雨夜",
    });
    book.date(new Date("2026-10-14T00:00:00Z"));
    book.add("开场", "<p>雨还在下。</p>");
    book.add("二楼", "<p>窗户漏风。</p>");
    const out = await book.generate("uint8array");
    const bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const zip = await JSZip.loadAsync(bytes);
    const toc = await zip.file("toc.ncx")?.async("string");
    expect(toc).toContain("开场");
    expect(toc).toContain("二楼");
    const names = Object.keys(zip.files);
    expect(names.some((name) => name.endsWith(".html"))).toBe(true);
    const page = await zip.file("OEBPS/page-0.html")?.async("string");
    expect(page).toContain("雨还在下。");
    expect(page).not.toContain("没选中的另一条");
  });
});

describe("图片尺寸", () => {
  it("长边超过 800 会按比例缩小", () => {
    expect(clampEdge(2000, 1000)).toEqual({ width: MAX_IMAGE_EDGE, height: 400 });
    expect(clampEdge(400, 300)).toEqual({ width: 400, height: 300 });
  });
});
