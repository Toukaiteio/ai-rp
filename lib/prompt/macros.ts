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

export interface MacroSegment {
  text: string;
  name?: string;
  source?: string;
}

const SIMPLE_MACRO = /\{\{\s*([a-z][\w-]*)\s*\}\}|<([A-Z][A-Z0-9_-]*)>/gi;

/** 展开普通文本，同时保留可识别的简单宏，供界面显示其来源。 */
export function expandMacroSegments(text: string, vars: MacroVars): MacroSegment[] {
  const segments: MacroSegment[] = [];
  let cursor = 0;

  function pushPlain(value: string): void {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous && !previous.name) {
      previous.text += value;
    } else {
      segments.push({ text: value });
    }
  }

  for (const match of text.matchAll(SIMPLE_MACRO)) {
    const source = match[0];
    const start = match.index ?? cursor;
    pushPlain(applyMacros(text.slice(cursor, start), vars));
    const name = (match[1] ?? match[2]).toLowerCase() === "bot"
      ? "char"
      : (match[1] ?? match[2]).toLowerCase();
    const value = applyMacros(source, vars);
    if (value === source) {
      pushPlain(value);
    } else if (value) {
      segments.push({ text: value, name, source });
    }
    cursor = start + source.length;
  }

  pushPlain(applyMacros(text.slice(cursor), vars));
  return segments;
}

export function applyMacros(text: string, vars: MacroVars): string {
  return expandMacros(text, vars);
}
