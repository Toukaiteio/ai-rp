import { translateCharacterCard, translationLanguages, type CharacterCard, type CardTranslationCheckpoint, type CardTranslationProgress } from "@/lib/cards";
import { hasMessage, type MessageKey } from "@/lib/i18n";
import { withImage } from "@/lib/providers/settings";
import { addImportedCard } from "@/lib/storage/cards";
import { getProviderConfigSnapshot } from "@/lib/storage/settings";

export type TranslationProgress = CardTranslationProgress;

export interface TranslationSession {
  checkpoint: CardTranslationCheckpoint;
  binding?: string;
  translated?: CharacterCard;
}

export function clearTranslationSession(session: TranslationSession): void {
  session.checkpoint = { translations: {} };
  delete session.binding;
  delete session.translated;
}

/** 送进提示词的语言名 → 界面显示名。常见语言走文案表，自定义语言原样显示。 */
export function translationLanguageLabel(language: string, t: (key: MessageKey) => string): string {
  for (const [code, name] of Object.entries(translationLanguages())) {
    if (name !== language) continue;
    const key = `card.lang.${code}`;
    if (hasMessage(key)) return t(key);
  }
  return language;
}

function translationBinding(card: CharacterCard, targetLanguage: string, config: unknown): string {
  const configuration = JSON.stringify(config, (key, value) => key === "apiKey" ? undefined : value);
  return JSON.stringify([card, targetLanguage, configuration]);
}

const fields: Record<string, MessageKey> = {
  name: "card.translationFieldName",
  description: "card.translationFieldDescription", personality: "card.translationFieldPersonality",
  scenario: "card.translationFieldScenario", first_mes: "card.translationFieldGreeting",
  mes_example: "card.translationFieldExamples", system_prompt: "card.translationFieldSystem",
  post_history_instructions: "card.translationFieldHistory", author_note: "card.translationFieldNote",
  alternate_greetings: "card.translationFieldGreetings", character_book: "card.translationFieldBook",
  voice: "card.translationFieldVoice",
};

/** 字段名 → 界面文案；认不出的字段返回 null，界面直接不显示这一行。 */
export function translationFieldKey(field: unknown): MessageKey | null {
  return typeof field === "string" && Object.hasOwn(fields, field) ? fields[field] : null;
}

const reasons: Record<string, MessageKey> = {
  output_limit: "card.translationReasonLimit", content_filter: "card.translationReasonFilter",
  stream_interrupted: "card.translationReasonStream", invalid_json: "card.translationReasonJson",
  json_truncated: "card.translationReasonTruncated", invalid_sse: "card.translationReasonProtocol",
  unexpected_finish_reason: "card.translationReasonFinish", upstream_error: "card.translationReasonUpstream",
  network_error: "card.translationReasonNetwork", invalid_dictionary: "card.translationReasonJson",
  unexpected_fields: "card.translationReasonExtra", invalid_value: "card.translationReasonValue",
  missing_fields: "card.translationReasonMissing", protected_tokens: "card.translationReasonTokens",
  http_error: "card.translationReasonHttp",
};

export interface TranslationDiagnostic {
  reason: MessageKey;
  field: MessageKey | null;
  completed?: number;
  total?: number;
  status?: number;
  receivedCharacters?: number;
}

export function translationDiagnostic(error: unknown): TranslationDiagnostic {
  const details = error && typeof error === "object" && "details" in error ? error.details : null;
  const value = details && typeof details === "object" ? details as Record<string, unknown> : {};
  const count = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : undefined;
  const total = count(value.total);
  const completed = count(value.completed);
  const status = count(value.status);
  return {
    reason: typeof value.reason === "string" && Object.hasOwn(reasons, value.reason) ? reasons[value.reason] : "card.translationReasonUnknown",
    field: translationFieldKey(value.field),
    completed: completed === undefined ? undefined : total === undefined ? completed : Math.min(completed, total),
    total,
    status: status !== undefined && status >= 400 && status <= 599 ? status : undefined,
    receivedCharacters: count(value.receivedCharacters),
  };
}

export function translationPercent(progress?: TranslationProgress, saved = false): number {
  if (saved) return 100;
  if (!progress || !Number.isFinite(progress.totalCharacters) || progress.totalCharacters <= 0 || !Number.isFinite(progress.completedCharacters)) return 0;
  return Math.min(99, Math.max(0, Math.floor(progress.completedCharacters / progress.totalCharacters * 100)));
}

export function translationErrorKey(error: unknown): MessageKey {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  switch (code) {
    case "translation_not_configured": return "card.translationNotConfigured";
    case "translation_invalid_response": return "card.translationInvalid";
    case "translation_incomplete": return "card.translationIncomplete";
    case "translation_save_failed": return "card.translationSaveFailed";
    default: return "card.translationFailed";
  }
}

export async function translateAndSaveCard(
  card: CharacterCard,
  targetLanguage: string,
  signal: AbortSignal,
  options?: {
    onProgress?: (progress: TranslationProgress) => void;
    onSaving?: () => void;
    session?: TranslationSession;
  },
): Promise<void> {
  signal.throwIfAborted();
  const config = withImage(getProviderConfigSnapshot());
  const session = options?.session;
  const binding = translationBinding(card, targetLanguage, config);
  if (session && session.binding !== binding) {
    clearTranslationSession(session);
    session.binding = binding;
  }
  const invalidate = () => { if (session) clearTranslationSession(session); };
  signal.addEventListener("abort", invalidate, { once: true });
  try {
    const translationOptions = { signal, ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
      ...(session ? { checkpoint: session.checkpoint } : {}) };
    const translated = session?.translated ?? await translateCharacterCard(card, targetLanguage, config, translationOptions);
    signal.throwIfAborted();
    if (translationBinding(card, targetLanguage, withImage(getProviderConfigSnapshot())) !== binding) {
      invalidate();
      throw new DOMException("Translation context changed", "AbortError");
    }
    if (session) session.translated = translated;
    options?.onSaving?.();
    signal.throwIfAborted();
    const copy = translated;
    try {
      await addImportedCard(copy, { strict: true, signal });
    } catch (error) {
      signal.throwIfAborted();
      throw Object.assign(new Error("Card translation save failed", { cause: error }), {
        code: "translation_save_failed",
      });
    }
    signal.throwIfAborted();
    if (session) clearTranslationSession(session);
  } finally {
    signal.removeEventListener("abort", invalidate);
  }
}
