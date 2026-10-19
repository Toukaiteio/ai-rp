export interface MacroToken {
  start: number;
  end: number;
  body: string;
  name: string;
  tail: string;
  closing: boolean;
  preserve: boolean;
  literal?: boolean;
  scopeEnd?: number;
}

function token(text: string, start: number, end: number): MacroToken {
  const body = text.slice(start + 2, end - 2).trim();
  const match = /^(#\s*)?(\/\s*)?(\/\/|[a-z][\w-]*(?=\s|:|$))([\s\S]*)$/i.exec(body);
  return { start, end, body, name: match?.[3].toLowerCase() ?? "", tail: match?.[4] ?? "",
    closing: !!match?.[2], preserve: !!match?.[1] };
}

export function tokenize(text: string): MacroToken[] {
  const tokens: MacroToken[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith("\\{\\{", i)) {
      const end = text.indexOf("\\}\\}", i + 4);
      if (end !== -1) {
        if (!stack.length) tokens.push({ start: i, end: end + 4, body: "", name: "", tail: "", closing: false, preserve: false, literal: true });
        i = end + 3;
        continue;
      }
    }
    if (text[i] === "\\" && /[{}\\]/.test(text[i + 1])) { i++; continue; }
    if (text.startsWith("{{", i)) { stack.push(i); i++; }
    else if (text.startsWith("}}", i) && stack.length) {
      const start = stack.pop()!;
      if (!stack.length) tokens.push(token(text, start, i + 2));
      i++;
    }
  }
  if (stack.length) {
    tokens.push({ start: stack[0], end: text.length, body: "", name: "", tail: "", closing: false, preserve: false });
  }
  const scopes = new Map<string, number[]>();
  tokens.forEach((item, index) => {
    if (!item.name) return;
    if (item.closing) {
      const open = scopes.get(item.name)?.pop();
      if (open !== undefined) tokens[open].scopeEnd = index;
    } else {
      const openings = scopes.get(item.name) ?? [];
      // Inline comments do not open a scoped comment block.
      if (item.name !== "//" || !item.tail.trim()) openings.push(index);
      scopes.set(item.name, openings);
    }
  });
  return tokens;
}

export function argumentsOf(tail: string): string[] | undefined {
  if (!tail.trim()) return [];
  if (/^\s*::/.test(tail)) {
    const value = tail.replace(/^\s*::/, "");
    const nested = tokenize(value);
    const args: string[] = [];
    let start = 0;
    let next = 0;
    for (let i = 0; i < value.length; i++) {
      if (nested[next]?.start === i) { i = nested[next++].end - 1; continue; }
      if (value.startsWith("::", i)) {
        args.push(value.slice(start, i).trim());
        start = i + 2;
        i++;
      }
    }
    args.push(value.slice(start).trim());
    return args;
  }
  if (/^\s*:/.test(tail)) return [tail.replace(/^\s*:/, "").trim()];
  return /^\s/.test(tail) ? [tail.trim()] : undefined;
}

export function dedent(text: string): string {
  const lines = text.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
  const indent = lines.find((line) => line.trim())?.match(/^[\t ]*/)?.[0] ?? "";
  return lines.map((line) => line.startsWith(indent) ? line.slice(indent.length) : line).join("\n").trim();
}
