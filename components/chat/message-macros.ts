import { parseBlocks, type MessageBlock } from "@/lib/blocks";
import { applyMacros, type MacroVars } from "@/lib/prompt";

export function resolveMessageBlocks(content: string, vars: MacroVars): MessageBlock[] {
  return resolveBlockMacros(parseBlocks(content), vars);
}

export function resolveBlockMacros(blocks: readonly MessageBlock[], vars: MacroVars): MessageBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: applyMacros(block.text, vars),
    ...(block.who === undefined ? {} : { who: applyMacros(block.who, vars) }),
  }));
}
