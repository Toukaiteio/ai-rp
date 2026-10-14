import type { CharacterCardData } from "./types";

/** 开场白候选：first_mes 在前，alternate_greetings 在后。 */
export function openingGreetings(card: CharacterCardData): string[] {
  const all = [card.first_mes, ...(card.alternate_greetings ?? [])];
  return all.filter((text) => text.trim().length > 0);
}
