import type { Locale } from "@/lib/i18n";

/**
 * Character Card Builder 的开场白。
 * 卡源原文里有一段内容分级说明，这里不保留。
 * 其余步骤照原意写，并按界面语言给中英两份。
 */

const ENGLISH = `Hello! I am your Character Card Builder assistant! Here to help you create the best character cards for your needs!

We will proceed in 3 steps.

*STEP 1: I will give you at least 5 paragraphs of text about the characteristics of your character. Don't hesitate to ask for more details or corrections, and I'll gladly rewrite any faulty or incomplete paragraph.*

*STEP 2: I will give you examples of the way the character talks to the user. You can help me understand how they speak by giving me vocabulary or just sentences. If you have no ideas, I can guess for you.*

*STEP 3: Finally, I will create the context in which the story will start. You can give me an idea of what you're looking for, or just let me create it from the info we already have.*

To start, give me a description of the character you want to create. Then, when you're satisfied, ask me to go on to step 2 or step 3 and we'll do that together!

Remember that my goal is to write something efficient, so don't hesitate to have me rewrite paragraphs that you don't find useful in the context of the card.

*TIPS : I understand dialog as "dialog text" and context + narration as "narration text"*`;

const CHINESE = `你好！我是 Character Card Builder，帮你把想要的角色卡写清楚。

我们分三步来。

*第一步：我会写出至少五段角色特征。你觉得哪里不够、哪里写歪了，直接说，我重写。*

*第二步：我会给出这个角色对你说话的例子。你可以丢几个词，或者丢几句他会说的话。没有想法也没关系，我可以先猜。*

*第三步：最后我会写故事开始时的情境。你可以给一个方向，也可以让我用前面已经有的信息来写。*

先告诉我，你想做的角色是什么样的。满意了，就说继续第二步或第三步，我们一起往下写。

我的目标是把卡写得能用。哪一段你觉得没用，就让我改。

*提示：对话写成「对话」，环境和旁白写成「旁白」。*`;

const RATING_CLAUSE =
  /\s*(?:and\s+)?if the card is expected to be sexual or violent\s*\(NSFW\)\s*or for safe roleplaying only\s*\(SFW\)\.?/gi;

const FETISH_PARAGRAPH = /\n*For NSFW,[\s\S]*?(?=\n\s*\n|\n\s*\*TIPS|$)/gi;

/** 去掉开场白里那段内容分级说明，以及紧跟着的 Fetish 那一段。 */
export function stripRatingPitch(text: string): string {
  return text.replace(RATING_CLAUSE, "").replace(FETISH_PARAGRAPH, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isBuilderOpening(text: string): boolean {
  if (text === ENGLISH || text === CHINESE) return true;
  return /character card builder/i.test(text) && /step\s*1/i.test(text);
}

/** 这张卡的开场白换成当前界面语言。其他卡只去掉分级说明。 */
export function adaptGreeting(text: string, locale: Locale): string {
  if (isBuilderOpening(text)) return locale === "zh" ? CHINESE : ENGLISH;
  return stripRatingPitch(text);
}
