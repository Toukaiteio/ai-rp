import settings from "@/data/card-translation.json";
import type { CharacterCard } from "./types";
import type { CardTranslationField } from "./translation-types";

export interface TranslationSegment {
  key: string;
  field: CardTranslationField;
  text: string;
  characters: number;
  write: (text: string) => void;
}

export function collectTranslationSegments(card: CharacterCard): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  function add(text: string | undefined, field: CardTranslationField, write: (text: string) => void) {
    if (!text?.trim()) return;
    const prefix = text.match(/^\s*/u)![0];
    const suffix = text.match(/\s*$/u)![0];
    segments.push({
      key: `s${segments.length}`,
      field,
      text: text.trim(),
      characters: text.length,
      write: (value) => {
        write(prefix + value.trim() + suffix);
      },
    });
  }
  const data = card.data;
  for (const field of settings.fields as (keyof Pick<typeof data,
    "name" | "description" | "personality" | "scenario" | "first_mes" | "mes_example" |
    "system_prompt" | "post_history_instructions" | "author_note">)[]) {
    add(data[field], field, (text) => { data[field] = text; });
  }
  data.alternate_greetings?.forEach((text, index) => add(text, "alternate_greetings", (value) => { data.alternate_greetings![index] = value; }));
  if (data.voice) {
    const voice = data.voice;
    for (const field of settings.voiceFields as ("vocabulary" | "habits" | "avoidances" | "sampleLines")[]) {
      voice[field].forEach((text, index) => add(text, "voice", (value) => { voice[field][index] = value; }));
    }
  }
  const book = data.character_book;
  if (book) {
    add(book.name, "character_book", (text) => { book.name = text; });
    for (const entry of book.entries) {
      add(entry.content, "character_book", (text) => { entry.content = text; });
      // Synonyms in an AND list would require both languages to match.
      if (entry.logic !== "and") {
        for (const key of [...entry.keys]) {
          add(key, "character_book", (text) => { if (!entry.keys.includes(text)) entry.keys.push(text); });
        }
      }
    }
  }
  return segments;
}
