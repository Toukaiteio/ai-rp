/**
 * 检查器用的纯文本工具。
 *
 * 这些函数只做字符级统计，不做分词、不调模型：Phase 0 的指标必须是
 * 离线可复现的，否则同一段回复今天记成 2 条问题、明天记成 3 条，
 * 基线就没有意义了。
 */

/** 中日韩统一表意文字。用来判断「这段是不是中文」。 */
const HAN = /[\u4e00-\u9fff]/g;
const KANA = /[\u3040-\u30ff]/g;
const HANGUL = /[\uac00-\ud7af]/g;
const LATIN = /[A-Za-z]/g;

/** 引号里包着的内容。判断第一人称、语言之前要先摘掉引文。 */
const QUOTED = /[「『“"][^」』”"]*[」』”"]/g;

export function stripQuoted(text: string): string {
  return text.replace(QUOTED, "");
}

export function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export function hanCount(text: string): number {
  return countMatches(text, HAN);
}

export function kanaCount(text: string): number {
  return countMatches(text, KANA);
}

export function hangulCount(text: string): number {
  return countMatches(text, HANGUL);
}

export function latinCount(text: string): number {
  return countMatches(text, LATIN);
}

/** 去掉空白和块标记，得到「正文有多少字」。 */
export function visibleLength(text: string): number {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, "").length;
}

/**
 * 判定一段文本的主要语言。
 * 和 lib/prompt/language.ts 的口径一致：谁的字数多算谁，
 * 这样「玩家输入什么语言」和「回复是什么语言」可以直接比。
 */
export function detectLanguage(text: string): "zh" | "ja" | "ko" | "latin" | "unknown" {
  const counts: Array<[string, number]> = [
    ["zh", hanCount(text)],
    ["ja", kanaCount(text)],
    ["ko", hangulCount(text)],
    ["latin", latinCount(text)],
  ];
  const [top] = counts.sort((a, b) => b[1] - a[1]);
  return top && top[1] > 0 ? (top[0] as "zh" | "ja" | "ko" | "latin") : "unknown";
}

/**
 * 按标点切句。act 的「多个动作」和复读判定都用它。
 * 不切分号之后的引号内容——检查前调用方一般已经 stripQuoted 过。
 */
export function splitClauses(text: string): string[] {
  return text
    .split(/[，,。！？!?；;、\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 找出 current 里和 previous 逐字重复的长片段。
 *
 * 用字符 n-gram 而不是句子比对：模型复读时常常改几个字，
 * 整句比对会漏掉，而 n-gram 能把「同一句话换个说法再说一遍」也抓出来。
 *
 * 返回合并后的片段（按出现顺序），长度都 >= minLength。
 */
export function repeatedPhrases(
  current: string,
  previous: string,
  minLength = 8,
  maxPhrases = 8,
): string[] {
  const a = normalizeForCompare(current);
  const b = normalizeForCompare(previous);
  if (a.length < minLength || b.length < minLength) return [];

  const previousGrams = new Set<string>();
  for (let i = 0; i + minLength <= b.length; i += 1) {
    previousGrams.add(b.slice(i, i + minLength));
  }

  // 记下每个命中的 n-gram 起点，再把相邻的起点合并成一段
  const hits: number[] = [];
  for (let i = 0; i + minLength <= a.length; i += 1) {
    if (previousGrams.has(a.slice(i, i + minLength))) hits.push(i);
  }
  if (hits.length === 0) return [];

  const phrases: string[] = [];
  let start = hits[0];
  let end = hits[0] + minLength;
  for (let i = 1; i < hits.length; i += 1) {
    if (hits[i] <= end) {
      end = Math.max(end, hits[i] + minLength);
      continue;
    }
    phrases.push(a.slice(start, end));
    if (phrases.length >= maxPhrases) return phrases;
    start = hits[i];
    end = hits[i] + minLength;
  }
  phrases.push(a.slice(start, end));
  return phrases.slice(0, maxPhrases);
}

/**
 * 比对用的归一化：抹掉块标记、空白、标点和引号。
 * 只留下实义字符，这样「她抬眼。」和「她抬眼」算同一句。
 */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 给报告用的短预览。绝不把整段正文写进报告。 */
export function snippet(text: string, limit = 12): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}…`;
}
