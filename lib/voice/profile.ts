/**
 * 角色声音（Phase 9）。
 *
 * 问题：角色卡里的 `personality` 是一段散文，控制不住说话风格——
 * 同一张卡，模型这一轮让她话短，下一轮就让她长篇大论。
 *
 * 做法：把「她怎么说话」拆成几个明确的维度，再**压缩成一句自然语言**
 * 放进提示词。不逐项列给模型看——列成清单它会当成待办事项逐条执行，
 * 写出来的对白反而僵。一句话它当人物设定读，效果更像人。
 *
 * 这个模块只做三件事：把结构化档案压成一句话、把外部输入收干净、
 * 检查生成的对白有没有明显违背已经声明的习惯。
 */

/** 句子长度。紧张时的变化用 `stressShift` 表示，不在这里混着写。 */
export type SentenceLength = "short" | "medium" | "long";

/** 直接程度。direct = 问什么答什么；indirect = 先回避、反问、绕开。 */
export type Directness = "direct" | "indirect";

/** 情绪外露程度。open = 摆在脸上；restrained = 收着。 */
export type EmotionalExpression = "open" | "restrained";

export interface CharacterVoiceProfile {
  sentenceLength: SentenceLength;
  directness: Directness;
  emotionalExpression: EmotionalExpression;
  /** 常用词、口头禅 */
  vocabulary: string[];
  /** 说话习惯：省略主语、爱停顿、用敬语…… */
  habits: string[];
  /** 禁用表达：这个人不会说的话 */
  avoidances: string[];
  /** 示例台词。是范本，不是必须照搬的模板 */
  sampleLines: string[];
}

/** 具体控制项。它们是开关，最后都要落到那句话里。 */
export interface VoiceToggles {
  /** 是否习惯省略主语 */
  omitsSubject?: boolean;
  /** 是否直接回答问题 */
  answersDirectly?: boolean;
  /** 是否经常停顿 */
  pausesOften?: boolean;
  /** 是否使用敬语 */
  usesHonorifics?: boolean;
  /** 回避的话题类型 */
  avoidsTopics?: string[];
  /** 口头禅 */
  catchphrases?: string[];
  /** 紧张时句子会变长还是变短 */
  stressShift?: "longer" | "shorter" | "unchanged";
}

export const SENTENCE_LENGTHS: readonly SentenceLength[] = ["short", "medium", "long"];
export const DIRECTNESSES: readonly Directness[] = ["direct", "indirect"];
export const EMOTIONAL_EXPRESSIONS: readonly EmotionalExpression[] = ["open", "restrained"];

const MAX_ITEM_CHARS = 24;
const MAX_SAMPLE_CHARS = 60;

/** 常用词 / 口头禅 / 习惯 / 禁用 各自最多几条。 */
export const MAX_VOCABULARY = 8;
export const MAX_HABITS = 6;
export const MAX_AVOIDANCES = 6;
export const MAX_SAMPLES = 3;

export function isSentenceLength(value: unknown): value is SentenceLength {
  return typeof value === "string" && (SENTENCE_LENGTHS as readonly string[]).includes(value);
}

export function isDirectness(value: unknown): value is Directness {
  return typeof value === "string" && (DIRECTNESSES as readonly string[]).includes(value);
}

export function isEmotionalExpression(value: unknown): value is EmotionalExpression {
  return typeof value === "string" && (EMOTIONAL_EXPRESSIONS as readonly string[]).includes(value);
}

/**
 * 把结构化档案压成一句自然语言。
 *
 * 顺序有意这样排：先说句子长短（最外在的特征），再说怎么应对问题
 * （directness），然后情绪外露程度，最后是习惯和避讳。
 * 读起来像在描述一个人，而不是在念一份规格表。
 *
 * 没有任何内容可写时返回空串——调用方据此决定要不要往提示词里加这一段。
 */
export function describeVoice(profile: CharacterVoiceProfile): string {
  const sentences: string[] = [];

  // 1. 句子长短 + 停顿习惯
  const lengthText: Record<SentenceLength, string> = {
    short: "平时话短",
    medium: "说话不长不短",
    long: "说话成段，爱把话说完",
  };
  const head = [lengthText[profile.sentenceLength]];
  if (profile.habits.some((habit) => /停顿|顿/.test(habit))) head.push("常停顿");
  sentences.push(head.join("，"));

  // 2. 怎么应对问题
  sentences.push(
    profile.directness === "indirect" ? "习惯先回避再回答" : "问什么答什么",
  );

  // 3. 情绪外露
  sentences.push(
    profile.emotionalExpression === "restrained" ? "情绪收着，不轻易外露" : "情绪摆在脸上",
  );

  // 4. 习惯与口头禅
  const habits = profile.habits.filter((habit) => !/停顿|顿/.test(habit));
  if (habits.length > 0) sentences.push(habits.join("，"));
  if (profile.vocabulary.length > 0) {
    sentences.push(`常挂嘴边的词：${profile.vocabulary.join("、")}`);
  }

  // 5. 避讳
  if (profile.avoidances.length > 0) {
    sentences.push(`不会主动提：${profile.avoidances.join("、")}`);
  }

  const body = sentences.filter(Boolean).join("，");

  // 示例台词单独成句：它是范本，措辞上要说清「参考」而不是「照抄」
  if (profile.sampleLines.length > 0) {
    const samples = profile.sampleLines.map((line) => `「${line}」`).join("");
    return `${body}。参考她的说法：${samples}。`;
  }
  return body ? `${body}。` : "";
}

/**
 * 把具体控制项并进档案。
 *
 * 开关和 habits / vocabulary 是两种写法，这里统一收成一种：
 * 「是否省略主语」这种是非题写成 habit 句子，「口头禅」写进 vocabulary。
 * 分开保存会让 describeVoice 要读两处，早晚会漏一处。
 */
export function applyToggles(
  profile: CharacterVoiceProfile,
  toggles: VoiceToggles,
): CharacterVoiceProfile {
  const habits = [...profile.habits];
  const vocabulary = [...profile.vocabulary];
  const avoidances = [...profile.avoidances];

  const addHabit = (text: string) => {
    if (!habits.some((habit) => habit.includes(text))) habits.push(text);
  };
  /** 替换一类互斥的习惯：说了「问什么答什么」就不该还留着「先回避再回答」。 */
  const swapHabit = (pattern: RegExp, text: string) => {
    for (let i = habits.length - 1; i >= 0; i -= 1) {
      if (pattern.test(habits[i])) habits.splice(i, 1);
    }
    habits.push(text);
  };

  if (toggles.omitsSubject) addHabit("习惯省略主语");
  if (toggles.answersDirectly === true) swapHabit(/问什么答什么|先回避再回答/, "问什么答什么");
  if (toggles.answersDirectly === false) swapHabit(/问什么答什么|先回避再回答/, "先回避再回答");
  if (toggles.pausesOften) addHabit("说话常停顿");
  if (toggles.usesHonorifics) addHabit("用敬语");

  if (toggles.stressShift === "shorter") addHabit("紧张时句子更碎");
  if (toggles.stressShift === "longer") addHabit("紧张时话反而变多");
  if (toggles.stressShift === "unchanged") addHabit("紧张时句长不变");

  for (const phrase of toggles.catchphrases ?? []) {
    const clean = clip(phrase, MAX_ITEM_CHARS);
    if (clean && !vocabulary.includes(clean)) vocabulary.push(clean);
  }
  for (const topic of toggles.avoidsTopics ?? []) {
    const clean = clip(topic, MAX_ITEM_CHARS);
    if (clean && !avoidances.includes(clean)) avoidances.push(clean);
  }

  // directness / emotionalExpression 也受开关影响，保持一致
  const next: CharacterVoiceProfile = {
    ...profile,
    habits: habits.slice(0, MAX_HABITS),
    vocabulary: vocabulary.slice(0, MAX_VOCABULARY),
    avoidances: avoidances.slice(0, MAX_AVOIDANCES),
  };
  if (toggles.answersDirectly === true) next.directness = "direct";
  if (toggles.answersDirectly === false) next.directness = "indirect";
  return next;
}

/** 一张没有特别设定声音的卡。它描述的是「普通人」，不是「没有声音」。 */
export function defaultVoiceProfile(): CharacterVoiceProfile {
  return {
    sentenceLength: "medium",
    directness: "direct",
    emotionalExpression: "open",
    vocabulary: [],
    habits: [],
    avoidances: [],
    sampleLines: [],
  };
}

/**
 * 收干净一份外部来的档案。
 *
 * 角色卡是玩家自己写的，字段可能缺、可能是别的类型。
 * 缺的按默认值补，坏的丢掉——不要因为一个字段写错就让整份档案失效。
 */
export function normalizeVoiceProfile(value: unknown): CharacterVoiceProfile | undefined {
  if (!isRecord(value)) return undefined;

  const profile: CharacterVoiceProfile = {
    sentenceLength: isSentenceLength(value.sentenceLength) ? value.sentenceLength : "medium",
    directness: isDirectness(value.directness) ? value.directness : "direct",
    emotionalExpression: isEmotionalExpression(value.emotionalExpression)
      ? value.emotionalExpression
      : "open",
    vocabulary: cleanList(value.vocabulary, MAX_VOCABULARY, MAX_ITEM_CHARS),
    habits: cleanList(value.habits, MAX_HABITS, MAX_ITEM_CHARS),
    avoidances: cleanList(value.avoidances, MAX_AVOIDANCES, MAX_ITEM_CHARS),
    sampleLines: cleanList(value.sampleLines, MAX_SAMPLES, MAX_SAMPLE_CHARS),
  };

  // 一句话都没有、也没有示例的档案等于没写，返回 undefined 让调用方走旧路径
  const empty =
    profile.vocabulary.length === 0 &&
    profile.habits.length === 0 &&
    profile.avoidances.length === 0 &&
    profile.sampleLines.length === 0 &&
    profile.sentenceLength === "medium" &&
    profile.directness === "direct" &&
    profile.emotionalExpression === "open";
  return empty ? undefined : profile;
}

/**
 * 检查一段对白有没有明显违背已经声明的习惯。
 *
 * **只查明确的禁令，不查风格倾向。** 「她平时话短」这句话没法可靠地判定——
 * 三句话里两句长算不算违背？判定标准一模糊，就会变成误报机器，
 * 然后把好回复挡在历史外面。所以这里只查三件能确凿判断的事：
 * 说了禁用表达、用了她会回避的话题、口头禅一次都没出现（只在样本足够时查）。
 */
export interface VoiceViolation {
  kind: "avoidance" | "vocabulary" | "length";
  detail: string;
}

/** 对白至少要这么多句，才值得检查「口头禅一次都没出现」。 */
const MIN_LINES_FOR_VOCAB = 4;

export function checkVoice(
  lines: readonly string[],
  profile: CharacterVoiceProfile | undefined,
): VoiceViolation[] {
  if (!profile) return [];
  const text = lines.join("\n");
  if (!text.trim()) return [];

  const violations: VoiceViolation[] = [];

  // 1. 禁用表达：出现在对白里就是明确违规
  for (const avoidance of profile.avoidances) {
    if (avoidance.length >= 2 && text.includes(avoidance)) {
      violations.push({ kind: "avoidance", detail: `对白里出现了「${avoidance}」` });
    }
  }

  // 2. 口头禅：说了很多句却一次都没用到，说明声音没带上
  if (profile.vocabulary.length > 0 && lines.length >= MIN_LINES_FOR_VOCAB) {
    const used = profile.vocabulary.filter((word) => text.includes(word));
    if (used.length === 0) {
      violations.push({
        kind: "vocabulary",
        detail: `${lines.length} 句对白里没出现任何常用词`,
      });
    }
  }

  // 3. 句子长度：只有「短」这一档能可靠判定
  if (profile.sentenceLength === "short" && lines.length >= 2) {
    const long = lines.filter((line) => line.replace(/\s+/g, "").length > 40);
    if (long.length === lines.length) {
      violations.push({
        kind: "length",
        detail: `设定是话短，但 ${lines.length} 句全都很长`,
      });
    }
  }

  return violations;
}

/* ------------------------------------------------------------------ 内部 */

function cleanList(value: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = clip(item, maxChars);
    if (clean && !items.includes(clean)) items.push(clean);
    if (items.length >= max) break;
  }
  return items;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
