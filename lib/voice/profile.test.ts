import { describe, expect, it } from "vitest";
import {
  applyToggles,
  checkVoice,
  defaultVoiceProfile,
  describeVoice,
  isDirectness,
  isEmotionalExpression,
  isSentenceLength,
  normalizeVoiceProfile,
  type CharacterVoiceProfile,
} from "./profile";

function profile(over: Partial<CharacterVoiceProfile> = {}): CharacterVoiceProfile {
  return { ...defaultVoiceProfile(), ...over };
}

describe("角色声音：压缩成自然语言", () => {
  it("压成一句话，读起来像在描述一个人", () => {
    const text = describeVoice(
      profile({
        sentenceLength: "short",
        directness: "indirect",
        emotionalExpression: "restrained",
        habits: ["紧张时句子更碎"],
        avoidances: ["自己的过去"],
      }),
    );
    expect(text).toBe(
      "平时话短，习惯先回避再回答，情绪收着，不轻易外露，紧张时句子更碎，不会主动提：自己的过去。",
    );
  });

  it("不逐项列清单：输出里没有「句子长度：」这种字段名", () => {
    const text = describeVoice(
      profile({ sentenceLength: "short", directness: "direct", emotionalExpression: "open" }),
    );
    expect(text).not.toContain("sentenceLength");
    expect(text).not.toContain("句子长度");
    expect(text).not.toContain("directness");
    // 三档都是一句人话，不是枚举值
    expect(text).toContain("平时话短");
    expect(text).toContain("问什么答什么");
    expect(text).toContain("情绪摆在脸上");
  });

  it("三种句长各有各的说法", () => {
    expect(describeVoice(profile({ sentenceLength: "short" }))).toContain("平时话短");
    expect(describeVoice(profile({ sentenceLength: "medium" }))).toContain("说话不长不短");
    expect(describeVoice(profile({ sentenceLength: "long" }))).toContain("说话成段");
  });

  it("常用词和避讳写成两段，不混在一起", () => {
    const text = describeVoice(
      profile({ vocabulary: ["哼", "少废话"], avoidances: ["家里的事"] }),
    );
    expect(text).toContain("常挂嘴边的词：哼、少废话");
    expect(text).toContain("不会主动提：家里的事");
  });

  it("示例台词说清是「参考」，不是照抄", () => {
    const text = describeVoice(profile({ sampleLines: ["……你又没事干了？", "书，没看过。"] }));
    expect(text).toContain("参考她的说法");
    expect(text).toContain("「……你又没事干了？」");
    expect(text).toContain("「书，没看过。」");
  });

  it("停顿习惯并进第一句，不单独占一句", () => {
    const text = describeVoice(profile({ sentenceLength: "short", habits: ["说话常停顿"] }));
    expect(text.startsWith("平时话短，常停顿")).toBe(true);
  });

  it("什么都没有时不产出空话", () => {
    // 默认档案：三个维度都在中位，没有习惯、没有示例
    const text = describeVoice(defaultVoiceProfile());
    expect(text).toBe("说话不长不短，问什么答什么，情绪摆在脸上。");
  });
});

describe("角色声音：具体控制项", () => {
  it("是非题开关落成习惯句子", () => {
    const next = applyToggles(profile(), {
      omitsSubject: true,
      pausesOften: true,
      usesHonorifics: true,
    });
    expect(next.habits).toContain("习惯省略主语");
    expect(next.habits).toContain("说话常停顿");
    expect(next.habits).toContain("用敬语");
    expect(describeVoice(next)).toContain("习惯省略主语");
  });

  it("answersDirectly 同时改习惯和 directness，两处不会打架", () => {
    const indirect = applyToggles(profile(), { answersDirectly: false });
    expect(indirect.directness).toBe("indirect");
    expect(describeVoice(indirect)).toContain("先回避再回答");

    const direct = applyToggles(indirect, { answersDirectly: true });
    expect(direct.directness).toBe("direct");
    expect(describeVoice(direct)).toContain("问什么答什么");
    // 旧的「先回避」不该还留着
    expect(direct.habits).not.toContain("先回避再回答");
  });

  it("紧张时的变化写进习惯", () => {
    expect(applyToggles(profile(), { stressShift: "shorter" }).habits).toContain("紧张时句子更碎");
    expect(applyToggles(profile(), { stressShift: "longer" }).habits).toContain("紧张时话反而变多");
    expect(applyToggles(profile(), { stressShift: "unchanged" }).habits).toContain("紧张时句长不变");
  });

  it("口头禅进常用词，回避话题进避讳", () => {
    const next = applyToggles(profile(), {
      catchphrases: ["少废话"],
      avoidsTopics: ["自己的过去", "家里的事"],
    });
    expect(next.vocabulary).toContain("少废话");
    expect(next.avoidances).toEqual(["自己的过去", "家里的事"]);
  });

  it("重复调用不会把同一条加两遍", () => {
    const once = applyToggles(profile(), { catchphrases: ["哼"], avoidsTopics: ["过去"] });
    const twice = applyToggles(once, { catchphrases: ["哼"], avoidsTopics: ["过去"] });
    expect(twice.vocabulary.filter((word) => word === "哼")).toHaveLength(1);
    expect(twice.avoidances.filter((topic) => topic === "过去")).toHaveLength(1);
  });

  it("条目数有上限，不会无限堆", () => {
    const many = applyToggles(profile(), {
      catchphrases: Array.from({ length: 20 }, (_, i) => `词${i}`),
    });
    expect(many.vocabulary.length).toBeLessThanOrEqual(8);
  });
});

describe("角色声音：外部输入收干净", () => {
  it("缺字段按默认值补", () => {
    const next = normalizeVoiceProfile({ sentenceLength: "short" });
    expect(next).toMatchObject({
      sentenceLength: "short",
      directness: "direct",
      emotionalExpression: "open",
    });
  });

  it("坏值丢掉，不影响其它字段", () => {
    const next = normalizeVoiceProfile({
      sentenceLength: "乱写",
      directness: "indirect",
      vocabulary: ["哼", 42, "  ", "少废话"],
    });
    expect(next?.sentenceLength).toBe("medium");
    expect(next?.directness).toBe("indirect");
    expect(next?.vocabulary).toEqual(["哼", "少废话"]);
  });

  it("完全是默认值的档案当成没写，返回 undefined", () => {
    expect(normalizeVoiceProfile({})).toBeUndefined();
    expect(normalizeVoiceProfile({ sentenceLength: "medium" })).toBeUndefined();
    expect(normalizeVoiceProfile("不是对象")).toBeUndefined();
    expect(normalizeVoiceProfile(null)).toBeUndefined();
  });

  it("有实质内容就保留", () => {
    expect(normalizeVoiceProfile({ habits: ["爱停顿"] })).toBeDefined();
    expect(normalizeVoiceProfile({ sentenceLength: "short" })).toBeDefined();
    expect(normalizeVoiceProfile({ sampleLines: ["嗯。"] })).toBeDefined();
  });

  it("单条内容过长会截断", () => {
    const next = normalizeVoiceProfile({ habits: ["很长的习惯".repeat(20)] });
    expect(next?.habits[0].length).toBeLessThanOrEqual(24);
  });

  it("三个枚举值各有判定函数", () => {
    expect(isSentenceLength("short")).toBe(true);
    expect(isSentenceLength("tiny")).toBe(false);
    expect(isDirectness("indirect")).toBe(true);
    expect(isDirectness("maybe")).toBe(false);
    expect(isEmotionalExpression("restrained")).toBe(true);
    expect(isEmotionalExpression("loud")).toBe(false);
  });
});

describe("角色声音：检查生成的对白", () => {
  it("没有档案就不检查，不产生误报", () => {
    expect(checkVoice(["随便一句话"], undefined)).toEqual([]);
  });

  it("对白里出现禁用表达就是违规", () => {
    const violations = checkVoice(["我妈以前也这样。"], profile({ avoidances: ["我妈"] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("avoidance");
    expect(violations[0].detail).toContain("我妈");
  });

  it("说了很多句却一次没用常用词，算声音没带上", () => {
    const long = profile({ vocabulary: ["哼"] });
    expect(checkVoice(["一", "二", "三"], long)).toEqual([]);
    const many = checkVoice(["一", "二", "三", "四"], long);
    expect(many).toHaveLength(1);
    expect(many[0].kind).toBe("vocabulary");
  });

  it("用到了常用词就不算违规", () => {
    expect(checkVoice(["哼。", "二", "三", "四"], profile({ vocabulary: ["哼"] }))).toEqual([]);
  });

  it("设定是话短，但每句都很长，才算违规", () => {
    const short = profile({ sentenceLength: "short" });
    const longLine = "这".repeat(50);
    expect(checkVoice([longLine, longLine], short)).toHaveLength(1);
    // 只有一句长、一句短，不判定
    expect(checkVoice([longLine, "嗯。"], short)).toEqual([]);
  });

  it("话多的人不检查句长", () => {
    const long = profile({ sentenceLength: "long" });
    const longLine = "这".repeat(50);
    expect(checkVoice([longLine, longLine], long)).toEqual([]);
  });

  it("空对白不检查", () => {
    expect(checkVoice([], profile({ avoidances: ["过去"] }))).toEqual([]);
    expect(checkVoice(["   "], profile({ avoidances: ["过去"] }))).toEqual([]);
  });

  it("只查明确的禁令，不查风格倾向", () => {
    // 「情绪收着」这种倾向没法可靠判定，不该产生任何违规
    const restrained = profile({ emotionalExpression: "restrained" });
    expect(checkVoice(["我真的很开心！", "太好了！"], restrained)).toEqual([]);
  });
});
