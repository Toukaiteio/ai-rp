import { parseBlocks, type MessageBlock } from "@/lib/blocks";
import { applyMacros, expandMacroSegments, type MacroSegment, type MacroVars } from "@/lib/prompt";

export interface ResolvedMessageBlock extends MessageBlock {
  macroSegments: MacroSegment[];
}

export interface MacroMarkdownMarker {
  text: string;
  name: string;
  source: string;
}

export interface MarkedMacroText {
  text: string;
  markers: Record<string, MacroMarkdownMarker>;
}

export function resolveMessageBlocks(content: string, vars: MacroVars): MessageBlock[] {
  return resolveBlockMacros(parseBlocks(content), vars);
}

export function resolveBlockMacros(blocks: readonly MessageBlock[], vars: MacroVars): MessageBlock[] {
  return blocks.flatMap((block) => {
    const text = expandMacroSegments(block.text, vars).map((segment) => segment.text).join("").trim();
    if (!text) return [];
    return [{
      ...block,
      text,
      ...(block.who === undefined ? {} : { who: applyMacros(block.who, vars) }),
    }];
  });
}

export function resolveBlockMacroSegments(
  blocks: readonly MessageBlock[],
  vars: MacroVars,
): ResolvedMessageBlock[] {
  return blocks.flatMap((block) => {
    const macroSegments = expandMacroSegments(block.text, vars);
    const text = macroSegments.map((segment) => segment.text).join("").trim();
    if (!text) return [];
    return [{
      ...block,
      text,
      macroSegments,
      ...(block.who === undefined ? {} : { who: applyMacros(block.who, vars) }),
    }];
  });
}

function escapeMarkdownLabel(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1").replace(/\r?\n/g, " ");
}

export function markMacroText(segments: readonly MacroSegment[]): MarkedMacroText {
  const markers: Record<string, MacroMarkdownMarker> = {};
  let index = 0;
  const text = segments.map((segment) => {
    if (!segment.name || !segment.source) return segment.text;
    const id = String(index++);
    markers[id] = {
      text: segment.text,
      name: segment.name,
      source: segment.source,
    };
    return `[${escapeMarkdownLabel(segment.text)}](macro:${id})`;
  }).join("");
  return { text, markers };
}
