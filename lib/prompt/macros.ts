export interface MacroVars {
  char: string;
  user: string;
}

/**
 * 替换 {{char}} / {{user}}。只认这两个宏，其余原样保留。
 * 用函数式 replace，避免角色名里的 $& 之类被当成替换模式。
 */
export function applyMacros(text: string, vars: MacroVars): string {
  if (!text) return "";
  return text.replace(/\{\{\s*(char|user)\s*\}\}/gi, (_match, key: string) =>
    key.toLowerCase() === "char" ? vars.char : vars.user,
  );
}
