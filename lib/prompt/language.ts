import type { ChatMessage } from "./types";

/**
 * 找到玩家最近一次真正输入的主要语言，给最终讲述者一个明确的语言锚点。
 * 不尝试翻译或重写内容，只处理最常见的中、日、韩、英场景。
 */
export function dialogueLanguageInstruction(history: ChatMessage[]): string {
  const latest = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const text = latest.replace(/<\/?player\b[^>]*>/gi, "");
  const counts = {
    zh: (text.match(/[\u4e00-\u9fff]/g) ?? []).length,
    ja: (text.match(/[\u3040-\u30ff]/g) ?? []).length,
    ko: (text.match(/[\uac00-\ud7af]/g) ?? []).length,
    latin: (text.match(/[A-Za-z]/g) ?? []).length,
  };
  const language = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const label = language?.[1] ? languageLabel(language[0]) : "玩家最近使用的语言";

  return [
    `对白语言锁定：${label}。`,
    "角色对白、旁白和动作描述都优先使用这次对话的语言。不要因为角色卡、角色名字、示例对话或原作语言不同而切换语言。",
    "只有玩家明确使用另一种语言，或明确要求翻译时，才切换语言。专有名词可以保留原文，但不要把整句对白换成另一种语言。",
  ].join("\n");
}

function languageLabel(language: string): string {
  switch (language) {
    case "zh":
      return "简体中文";
    case "ja":
      return "日语";
    case "ko":
      return "韩语";
    case "latin":
      return "英语或其他拉丁字母语言";
    default:
      return "玩家最近使用的语言";
  }
}
