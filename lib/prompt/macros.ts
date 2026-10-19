import type { CharacterCardData } from "@/lib/cards/types";
import { expandMacros } from "./macro-engine";

export interface MacroVars {
  char: string;
  user: string;
  card?: Partial<CharacterCardData>;
  persona?: string;
  history?: readonly { role: string; content: string }[];
  summary?: string;
  authorsNote?: string;
  original?: string;
  input?: string;
  group?: readonly { name: string; muted?: boolean }[];
  /** Already formatted by the caller's instruct-mode template. */
  mesExamples?: string;
}

export function applyMacros(text: string, vars: MacroVars): string {
  return expandMacros(text, vars);
}
