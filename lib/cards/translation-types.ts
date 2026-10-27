import { decodeBlockAttribute, encodeBlockAttribute } from "@/lib/blocks";

export type CardTranslationField =
  | "name" | "description" | "personality" | "scenario" | "first_mes" | "mes_example"
  | "system_prompt" | "post_history_instructions" | "author_note"
  | "alternate_greetings" | "character_book" | "voice";

export interface CardTranslationProgress {
  phase: "preparing" | "translating" | "validating" | "complete";
  completed: number;
  total: number;
  field: string;
  receivedCharacters: number;
  completedCharacters: number;
  totalCharacters: number;
}

export interface CardTranslationCheckpoint {
  signature?: string;
  translations: Record<string, string>;
}

export type CardTranslationErrorCode =
  | "translation_not_configured" | "translation_invalid_response" | "translation_incomplete"
  | "translation_request_failed" | "translation_cancelled";

export interface CardTranslationErrorDetails {
  reason: string;
  field?: string;
  completed?: number;
  total?: number;
  status?: number;
  receivedCharacters?: number;
  /** 校验失败时出问题的那个字典键，调用方用它把 field 定位到具体字段 */
  key?: string;
}

export class CardTranslationError extends Error {
  constructor(public readonly code: CardTranslationErrorCode, public details?: CardTranslationErrorDetails) {
    super(code);
    this.name = "CardTranslationError";
  }
}

export function checkTranslationAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CardTranslationError("translation_cancelled", { reason: "cancelled" });
}

export function synchronizeTranslationSpeakers(text: string, originalName: string, translatedName: string): string {
  if (!originalName || originalName === translatedName) return text;
  const escaped = encodeBlockAttribute(translatedName);
  return text.replace(/\{\{[\s\S]*?\}\}|<(?:"[^"]*"|'[^']*'|[^'">])*>/g, (tag) => {
    const opening = tag.match(/^<(?:dlg|act)(?=\s|\/?>)/);
    if (!opening) return tag;
    return opening[0] + tag.slice(opening[0].length).replace(
      /(\s+)([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g,
      (attribute, space: string, key: string, equals: string, value: string) => {
        const quote = value[0];
        if (key !== "who" || (quote !== '"' && quote !== "'")) return attribute;
        const speaker = value.slice(1, -1);
        if (speaker.includes("{{") || decodeBlockAttribute(speaker) !== originalName) return attribute;
        return `${space}${key}${equals}${quote}${escaped}${quote}`;
      },
    );
  });
}

function isTruncatedJson(text: string): boolean {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (const char of text.trim()) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) return false;
    }
  }
  return stack.length > 0 || quoted;
}

export function parseTranslationDictionary(text: string, source: Record<string, string>): Record<string, string> {
  const fenced = text.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const json = fenced ? fenced[1] : text;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new CardTranslationError("translation_invalid_response", { reason: isTruncatedJson(json) ? "json_truncated" : "invalid_json" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CardTranslationError("translation_invalid_response", { reason: "invalid_dictionary" });
  }
  const result = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.some((key) => !Object.hasOwn(result, key))) {
    throw new CardTranslationError("translation_invalid_response", { reason: "missing_fields" });
  }
  if (Object.keys(result).length !== keys.length) {
    throw new CardTranslationError("translation_invalid_response", { reason: "unexpected_fields" });
  }
  for (const key of keys) {
    const translated = result[key];
    if (typeof translated !== "string" || !translated.trim()) {
      throw new CardTranslationError("translation_invalid_response", { reason: "invalid_value", key });
    }
  }
  return result as Record<string, string>;
}
