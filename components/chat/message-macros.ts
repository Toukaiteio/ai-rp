import { parseBlocks, type MessageBlock } from "@/lib/blocks";
import { applyMacros, type MacroVars } from "@/lib/prompt";

export function resolveMessageBlocks(content: string, vars: MacroVars): MessageBlock[] {
  return resolveBlockMacros(parseBlocks(content), vars);
}

export function resolveBlockMacros(blocks: readonly MessageBlock[], vars: MacroVars): MessageBlock[] {
  return blocks.flatMap((block) => {
    const text = applyMacros(block.text, vars).trim();
    if (!text) return [];
    return [{
      ...block,
      text,
      ...(block.who === undefined ? {} : { who: applyMacros(block.who, vars) }),
    }];
  });
}
