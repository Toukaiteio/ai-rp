import type { MacroVars } from "./macros";
import { argumentsOf, dedent, tokenize } from "./macro-syntax";
import { macroValue } from "./macro-values";

const MAX_LENGTH = 1_048_576;
const MAX_DEPTH = 32;
const MAX_OPERATIONS = 10_000;

function checkLength(length: number): void {
  if (length > MAX_LENGTH) throw new RangeError("Macro text exceeds 1048576 UTF-16 code units");
}

export function expandMacros(text: string, vars: MacroVars): string {
  let operations = 0;
  let processed = 0;
  const path = new Set<string>();

  function render(source: string, depth: number): string {
    checkLength(source.length);
    if (depth >= MAX_DEPTH) return source;
    processed += source.length;
    if (processed > MAX_LENGTH * 32) throw new RangeError("Macro processing size limit exceeded");
    const tokens = tokenize(source);
    const parts: string[] = [];
    let length = 0;
    let cursor = 0;
    let trimNext = false;
    function append(value: string) {
      length += value.length;
      checkLength(length);
      parts.push(value);
    }
    function plain(value: string) {
      if (!value) return;
      if (trimNext) { value = value.replace(/^(?:\r?\n)+/, ""); trimNext = false; }
      let replacedLength = value.length;
      append(value.replace(/\\([{}\\])|<(USER|BOT|CHAR|GROUP|CHARIFNOTGROUP)>/gi, (raw, escaped: string | undefined, legacy: string | undefined) => {
        if (escaped !== undefined) return escaped;
        if (++operations > MAX_OPERATIONS) throw new RangeError("Macro operation limit exceeded");
        const name = legacy!.toLowerCase();
        const replacement = macroValue(name === "bot" ? "char" : name, [], vars)?.text ?? raw;
        replacedLength += replacement.length - raw.length;
        checkLength(replacedLength + length);
        return replacement;
      }));
    }
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i];
      plain(source.slice(cursor, item.start));
      const close = item.scopeEnd === undefined ? undefined : tokens[item.scopeEnd];
      const end = close?.end ?? item.end;
      const raw = source.slice(item.start, end);
      cursor = end;
      if (close) i = item.scopeEnd!;
      if (++operations > MAX_OPERATIONS) throw new RangeError("Macro operation limit exceeded");
      if (item.literal) { append(raw.replace(/\\([{}\\])/g, (_match, brace: string) => brace)); continue; }
      if (item.closing || !item.name) { append(raw); continue; }
      if (item.name === "//") continue;
      const utility = ["reverse", "space", "newline", "noop", "trim"].includes(item.name);
      const rawArgs = argumentsOf(item.tail);
      const supported = utility || macroValue(item.name, [], vars) !== undefined || item.name === "charfirstmessage";
      if (!supported || !rawArgs || (close && item.name !== "reverse")) { append(raw); continue; }
      const args = rawArgs.map((arg) => render(arg, depth + 1));
      if (close) args.push(render(item.preserve ? source.slice(item.end, close.start) : dedent(source.slice(item.end, close.start)), depth + 1));
      if (item.name === "trim" && !args.length) {
        const previous = parts.pop() ?? "";
        length -= previous.length;
        append(previous.replace(/(?:\r?\n)+$/, ""));
        trimNext = true;
      } else if (item.name === "noop" && !args.length) {
        continue;
      } else if (item.name === "reverse" && args.length === 1) {
        append(Array.from(args[0]).reverse().join(""));
      } else if (["space", "newline"].includes(item.name) && args.length <= 1) {
        const count = args.length ? args[0] : "1";
        if (!/^\d+$/.test(count)) { append(raw); continue; }
        checkLength(Number(count));
        append((item.name === "space" ? " " : "\n").repeat(Number(count)));
      } else {
        const value = macroValue(item.name, args, vars);
        const key = `${item.name}:${args.join("::")}`;
        if (!value || path.has(key)) { append(raw); continue; }
        checkLength(value.text.length);
        if (!value.recursive) { append(value.text); continue; }
        path.add(key);
        append(render(value.text, depth + 1));
        path.delete(key);
      }
    }
    plain(source.slice(cursor));
    return parts.join("");
  }

  return render(text, 0);
}
