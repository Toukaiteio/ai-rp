import { parseBlocks, blocksToPlainText } from "@/lib/blocks";
import type { ChatMessage } from "@/lib/prompt/types";
import { stylePrompt } from "./style";

/** 从角色卡描述里抽出外貌。没有【外貌】段就用描述开头，每次出图都得带上。 */
export function extractAppearance(description: string): string {
  const marked = description.match(/【外貌】([\s\S]*?)(?=\n【|$)/);
  const text = (marked?.[1] ?? description).replace(/\s+/g, " ").trim();
  return text.slice(0, 500);
}

/** 当前场景的可读文本：场景块优先，否则旁白，再不行就整段去标记。 */
export function sceneText(raw: string): string {
  const blocks = parseBlocks(raw);
  const scene = blocks.find((block) => block.kind === "scene")?.text;
  if (scene) return scene;
  const narr = blocks
    .filter((block) => block.kind === "narr")
    .map((block) => block.text)
    .join("");
  if (narr) return narr.slice(0, 400);
  return blocksToPlainText(blocks, { quoteDialogue: false }).slice(0, 400);
}

/**
 * 相似场景的指纹。只取场景的前一段，对话措辞变了不算新场景。
 * 空文本给空串，调用方不要把它当成“和任何场景都相似”。
 */
export function sceneKey(raw: string): string {
  return sceneText(raw).replace(/\s+/g, "").slice(0, 48);
}

export function isSimilarScene(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 8 && longer.includes(shorter);
}

export function buildPromptWriterMessages(input: {
  name: string;
  appearance: string;
  scene: string;
  styleId?: string;
  /** 角色头像：只要头肩和一张干净底，不要带场景。 */
  portrait?: boolean;
}): ChatMessage[] {
  const style = stylePrompt(input.styleId);
  if (input.portrait) {
    return [
      {
        role: "system",
        content: [
          "You write one English image prompt for a single character portrait.",
          "Head and shoulders, facing the viewer, plain muted background.",
          "Include the appearance exactly as given and the fixed art style.",
          "Do not invent a different face, age, or outfit.",
          "No speech bubbles, no captions, no text, no extra people.",
          "Output only the prompt, one paragraph, under 500 characters.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Character: ${input.name}`,
          `Appearance (must be reflected): ${input.appearance || "not specified"}`,
          `Art style (use this, do not replace it): ${style}`,
        ].join("\n"),
      },
    ];
  }
  return [
    {
      role: "system",
      content: [
        "You write one English image prompt for a single illustration.",
        "Include the character's appearance exactly as given, the fixed art style, and the current scene.",
        "Do not invent a different face, age, or outfit than the appearance describes.",
        "No speech bubbles, no captions, no text in the image.",
        "Output only the prompt, one paragraph, under 700 characters.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Character: ${input.name}`,
        `Appearance (must be reflected): ${input.appearance || "not specified"}`,
        `Art style (use this, do not replace it): ${style}`,
        `Scene: ${input.scene || "a quiet moment"}`,
      ].join("\n"),
    },
  ];
}

/** 模型有时会加引号或前缀，收成一段能直接送给生图接口的提示词。 */
export function parseImagePrompt(text: string): string {
  const line = text
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/g, "")
    .replace(/^(prompt|image prompt)\s*[:：]\s*/i, "")
    .trim()
    .replace(/^["“]|["”]$/g, "");
  return line.slice(0, 900);
}

export function buildScoreMessages(scene: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你给一段角色扮演场景打分，决定值不值得配一张插图。",
        "值得（7 到 10）：场景切换、新地点、新角色登场、情绪高潮。",
        "不值得（0 到 4）：寒暄、重复同一间屋子里的小动作、没有新信息。",
        "只输出一个 0 到 10 的整数，不要解释。",
      ].join("\n"),
    },
    { role: "user", content: scene || "（没有场景）" },
  ];
}

export function parseScore(text: string): number | null {
  const match = text.match(/\d{1,2}/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(10, value));
}
