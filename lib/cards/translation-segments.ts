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

function lastBoundary(positions: number[], start: number, end: number): number | undefined {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (positions[mid] <= end) low = mid + 1;
    else high = mid;
  }
  const found = positions[low - 1];
  return found > start ? found : undefined;
}

export function splitTranslationText(text: string, limit = settings.segmentCharacters): string[] {
  const safe = [0];
  let offset = 0;
  for (const token of text.match(/\{\{[\s\S]*?\}\}|<[^>]*>|[^]/gu) ?? []) {
    offset += token.length;
    safe.push(offset);
  }
  const safeSet = new Set(safe);
  const boundaries = [ /\r?\n[ \t]*\r?\n[\s]*/g, /[.!?。！？]["'”’」』)]*\s*/g, /\s+/g ]
    .map((pattern) => Array.from(text.matchAll(pattern), (match) => match.index + match[0].length)
      .filter((position) => safeSet.has(position)));
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    const end = Math.min(text.length, start + Math.max(1, limit));
    const stop = end === text.length ? end : boundaries.map((positions) => lastBoundary(positions, start, end))
      .find((position) => position !== undefined) ?? lastBoundary(safe, start, end) ?? safe.find((position) => position > start)!;
    parts.push(text.slice(start, stop));
    start = stop;
  }
  return parts;
}

export function collectTranslationSegments(card: CharacterCard): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  function add(text: string | undefined, field: CardTranslationField, write: (text: string) => void) {
    if (!text?.trim()) return;
    const parts = splitTranslationText(text);
    const translated = [...parts];
    let remaining = parts.filter((part) => part.trim()).length;
    parts.forEach((part, index) => {
      if (!part.trim()) return;
      const prefix = part.match(/^\s*/u)![0];
      const suffix = part.match(/\s*$/u)![0];
      segments.push({ key: `s${segments.length}`, field, text: part.trim(), characters: part.length, write: (value) => {
        translated[index] = prefix + value.trim() + suffix;
        remaining--;
        if (!remaining) write(translated.join(""));
      } });
    });
  }
  const data = card.data;
  for (const field of settings.fields as (keyof Pick<typeof data,
    "description" | "personality" | "scenario" | "first_mes" | "mes_example" |
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
