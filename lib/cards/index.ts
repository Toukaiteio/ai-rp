export * from "./types";
export {
  parseCharacterCard,
  serializeCard,
  toWireCard,
  cardFileName,
  createEmptyCard,
} from "./validate";
export type { ParseResult } from "./validate";
export { downloadCard, downloadCardPng, encodeCardPng, readCardFile } from "./io";
export { extractCardJson } from "./png";
export { translateCharacterCard, translationLanguages, CardTranslationError } from "./translate";
export type { CardTranslationErrorCode, CardTranslationErrorDetails, CardTranslationProgress, CardTranslationCheckpoint } from "./translate";
export type { OnlineCardItem, OnlineCardSource } from "./online";
export {
  ONLINE_SOURCE,
  normalizeOnlineCard,
  onlineCardPageUrl,
  onlineCardPngUrl,
  cardPortraitUrl,
} from "./online";

import type { CharacterCardData } from "./types";

/** 卡上有没有可用内容。空卡不该被当成能玩的角色。 */
export function isPlayableCard(data: CharacterCardData): boolean {
  return data.first_mes.trim().length > 0;
}
