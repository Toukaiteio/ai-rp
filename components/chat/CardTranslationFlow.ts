import { translateCharacterCard, type CharacterCard } from "@/lib/cards";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";
import { withImage } from "@/lib/providers/settings";
import { addImportedCard } from "@/lib/storage/cards";
import { getProviderConfigSnapshot } from "@/lib/storage/settings";

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
  locale: Locale,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const translated = await translateCharacterCard(
    card, locale, withImage(getProviderConfigSnapshot()), { signal },
  );
  signal.throwIfAborted();
  const copy = {
    ...translated,
    data: { ...translated.data, name: `${translated.data.name}${translate(locale, "card.translationSuffix")}` },
  };
  try {
    await addImportedCard(copy, { strict: true, signal });
  } catch (error) {
    signal.throwIfAborted();
    throw Object.assign(new Error("Card translation save failed", { cause: error }), {
      code: "translation_save_failed",
    });
  }
  signal.throwIfAborted();
}
