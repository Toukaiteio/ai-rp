import { describe, expect, it } from "vitest";
import { assemble } from "@/lib/prompt";
import {
  allowAutoCg,
  AUTO_TURN_GAP,
  buildPromptWriterMessages,
  extractAppearance,
  isSimilarScene,
  parseImagePrompt,
  parseScore,
  sceneKey,
  scoreAllows,
  stylePrompt,
} from "@/lib/image";

const appearance = "身形偏瘦，左眉有一道旧疤，深色棉布衣。";

describe("作画提示词", () => {
  it("外貌和固定风格每次都在，不把图片塞进对话提示词", () => {
    const description = `晚星旅店老板娘。\n\n【外貌】${appearance}\n\n【来历】北方来的。`;
    expect(extractAppearance(description)).toBe(appearance);

    const messages = buildPromptWriterMessages({
      name: "林晚晴",
      appearance,
      scene: "雨夜的一楼，她把姜茶推过来。",
      styleId: "jp-flat",
    });
    const flat = messages.map((message) => message.content).join("\n");
    expect(flat).toContain(appearance);
    expect(flat).toContain(stylePrompt("jp-flat"));
    expect(flat).toContain("林晚晴");
    expect(parseImagePrompt(`"  ${flat.slice(0, 40)}  "`).length).toBeGreaterThan(0);

    const chat = assemble({
      card: {
        name: "林晚晴",
        description,
        personality: "嘴上赶人。",
        scenario: "雨夜。",
      },
      history: [{ role: "assistant", content: "<narr>雨还在下。</narr>" }],
      seed: 1,
      budget: 8000,
    });
    const chatText = chat.messages.map((message) => message.content).join("\n");
    expect(chatText).not.toContain("data:image");
    expect(chatText).not.toContain("flat cel shading");
  });

  it("相似场景认得出，空场景不算相似", () => {
    const a = sceneKey("<scene>晚星旅店一楼，雨夜</scene><dlg who=\"林晚晴\">坐。</dlg>");
    const b = sceneKey("<narr>晚星旅店一楼，雨夜。她没抬头。</narr>");
    expect(isSimilarScene(a, a)).toBe(true);
    expect(isSimilarScene("", a)).toBe(false);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });
});

describe("自动生图节流", () => {
  const base = {
    enabled: true,
    turn: 12,
    lastCgTurn: null as number | null,
    count: 0,
    budget: 3,
    sceneKey: "晚星旅店一楼雨夜",
    seen: [] as string[],
  };

  it("默认关闭时直接拒绝", () => {
    expect(allowAutoCg({ ...base, enabled: false }).reason).toBe("disabled");
  });

  it("每 10 轮最多一张，每场不超过预算，相似场景不重复", () => {
    expect(allowAutoCg({ ...base, lastCgTurn: 12 - AUTO_TURN_GAP + 1 }).reason).toBe("gap");
    expect(allowAutoCg({ ...base, lastCgTurn: 1, turn: 11 }).ok).toBe(true);
    expect(allowAutoCg({ ...base, count: 3, budget: 3 }).reason).toBe("budget");
    expect(allowAutoCg({ ...base, seen: ["晚星旅店一楼雨夜"] }).reason).toBe("similar");
  });

  it("分数不到阈值不出图，解析只认数字", () => {
    expect(scoreAllows(6, 7)).toBe(false);
    expect(scoreAllows(7, 7)).toBe(true);
    expect(scoreAllows(null, 7)).toBe(false);
    expect(parseScore("8")).toBe(8);
    expect(parseScore("分数：10")).toBe(10);
    expect(parseScore("没有")).toBeNull();
  });
});
