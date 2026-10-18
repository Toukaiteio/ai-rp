import { describe, expect, it } from "vitest";
import { assemble } from "@/lib/prompt";
import { checkGeneration } from "@/lib/engine";
import { createEmptyCard, parseCharacterCard, serializeCard, toWireCard } from "@/lib/cards";
import { defaultVoiceProfile, type CharacterVoiceProfile } from "./profile";

function voice(over: Partial<CharacterVoiceProfile> = {}): CharacterVoiceProfile {
  return { ...defaultVoiceProfile(), ...over };
}

const CARD = {
  name: "深月风花",
  description: "同班同学。",
  personality: "别扭，嘴硬。",
  scenario: "午休的教室。",
};

function flat(messages: Array<{ content: string }>): string {
  return messages.map((message) => message.content).join("\n");
}

describe("角色声音：进提示词", () => {
  it("压成一句话，放在角色卡那一段后面", () => {
    const result = assemble({
      card: {
        ...CARD,
        voice: voice({
          sentenceLength: "short",
          directness: "indirect",
          emotionalExpression: "restrained",
          avoidances: ["自己的过去"],
        }),
      },
      history: [],
      seed: 1,
      budget: 100_000,
    });
    const text = flat(result.messages);
    expect(text).toContain("她说话的样子：");
    expect(text).toContain("平时话短，习惯先回避再回答，情绪收着");
    expect(text).toContain("不会主动提：自己的过去");
    // 和性格挨着，不是散在别处
    expect(text.indexOf("性格：")).toBeLessThan(text.indexOf("她说话的样子："));
  });

  it("不逐项列清单：提示词里不出现字段名", () => {
    const result = assemble({
      card: {
        ...CARD,
        voice: voice({ sentenceLength: "short", habits: ["习惯省略主语"], vocabulary: ["哼"] }),
      },
      history: [],
      seed: 1,
      budget: 100_000,
    });
    const text = flat(result.messages);
    expect(text).not.toContain("sentenceLength");
    expect(text).not.toContain("vocabulary");
    expect(text).not.toContain("sampleLines");
    // 但内容都在
    expect(text).toContain("习惯省略主语");
    expect(text).toContain("常挂嘴边的词：哼");
  });

  it("没有声音设定的卡完全不出现这一段", () => {
    const result = assemble({ card: CARD, history: [], seed: 1, budget: 100_000 });
    expect(flat(result.messages)).not.toContain("她说话的样子");
  });

  it("声音进前缀，所以换轮次不打掉缓存指纹", () => {
    const card = { ...CARD, voice: voice({ sentenceLength: "short" }) };
    const first = assemble({
      card,
      history: [{ role: "user", content: "第一轮" }],
      seed: 1,
      budget: 100_000,
    });
    const second = assemble({
      card,
      history: [
        { role: "user", content: "第一轮" },
        { role: "assistant", content: "<dlg who=\"深月风花\">嗯。</dlg>" },
        { role: "user", content: "第二轮" },
      ],
      seed: 1,
      budget: 100_000,
    });
    expect(second.cacheKey).toBe(first.cacheKey);
  });

  it("改声音会改变缓存指纹——它确实是前缀的一部分", () => {
    const base = assemble({ card: CARD, history: [], seed: 1, budget: 100_000 });
    const withVoice = assemble({
      card: { ...CARD, voice: voice({ sentenceLength: "short" }) },
      history: [],
      seed: 1,
      budget: 100_000,
    });
    expect(withVoice.cacheKey).not.toBe(base.cacheKey);
  });
});

describe("角色声音：进质量检查", () => {
  const options = {
    cardName: "深月风花",
    userName: "你",
    knownCharacters: ["深月风花"],
    playerInput: "你以前住在哪？",
    previousReply: "",
  };

  it("说了禁用的话会被记下来", () => {
    const report = checkGeneration({
      raw: '<dlg who="深月风花">我妈以前也这样。</dlg>',
      ...options,
      voice: voice({ avoidances: ["我妈"] }),
    });
    const issue = report.issues.find((item) => item.code === "voice_breach");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warn");
    expect(issue?.detail).toContain("我妈");
  });

  it("没有声音档案时这一项跳过，不产生误报", () => {
    const report = checkGeneration({
      raw: '<dlg who="深月风花">我妈以前也这样。</dlg>',
      ...options,
    });
    expect(report.issues.some((item) => item.code === "voice_breach")).toBe(false);
    const check = report.checks.find((item) => item.code === "voice_breach");
    expect(check?.status).toBe("pass");
  });

  it("声音违背只记录，不影响这一轮能不能进历史", () => {
    const report = checkGeneration({
      raw: '<dlg who="深月风花">我妈以前也这样。</dlg>',
      ...options,
      voice: voice({ avoidances: ["我妈"] }),
    });
    expect(report.severity).toBe("none");
    expect(report.decision).toBe("accepted");
    expect(report.verdict).toBe("pass");
  });

  it("检查项出现在面板的固定顺序里", () => {
    const report = checkGeneration({ raw: '<dlg who="深月风花">嗯。</dlg>', ...options });
    const codes = report.checks.map((check) => check.code);
    expect(codes).toContain("voice_breach");
    expect(codes.indexOf("voice_breach")).toBe(codes.length - 1);
  });
});

describe("角色声音：卡片往返", () => {
  it("存档里放 extensions，不占 V2 规范字段", () => {
    const card = createEmptyCard("深月风花");
    card.data.voice = voice({ sentenceLength: "short", avoidances: ["过去"] });
    const wire = toWireCard(card);

    expect(wire.data.voice).toBeUndefined();
    expect(wire.data.extensions?.voice_profile).toEqual(card.data.voice);
  });

  it("导出的 JSON 里没有顶层 voice 字段", () => {
    const card = createEmptyCard("深月风花");
    card.data.voice = voice({ sentenceLength: "short" });
    const parsed = JSON.parse(serializeCard(card)) as {
      data: { voice?: unknown; extensions?: Record<string, unknown> };
    };
    expect(parsed.data.voice).toBeUndefined();
    expect(parsed.data.extensions?.voice_profile).toBeDefined();
  });

  it("读回来还是同一份档案", () => {
    const card = createEmptyCard("深月风花");
    card.data.voice = voice({
      sentenceLength: "short",
      directness: "indirect",
      vocabulary: ["哼"],
      avoidances: ["过去"],
      sampleLines: ["……你又没事干了？"],
    });

    const result = parseCharacterCard(JSON.parse(serializeCard(card)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.voice).toEqual(card.data.voice);
  });

  it("没有声音的卡导出后不会多出一个空档案", () => {
    const card = createEmptyCard("深月风花");
    const result = parseCharacterCard(JSON.parse(serializeCard(card)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.voice).toBeUndefined();
  });

  it("外部卡里写坏的 voice 被丢掉，不影响其它字段", () => {
    const result = parseCharacterCard({
      spec: "chara_card_v2",
      data: {
        name: "深月风花",
        description: "同班同学。",
        extensions: { voice_profile: { sentenceLength: "乱写", directness: "indirect" } },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.description).toBe("同班同学。");
    expect(result.card.data.voice?.directness).toBe("indirect");
    expect(result.card.data.voice?.sentenceLength).toBe("medium");
  });
});
