import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type { MessageKey } from "./zh";

/** 界面语言。聊天内容、角色卡、给模型的提示词不在这里。 */
export type Locale = "zh" | "en";

export const LOCALES: readonly Locale[] = ["zh", "en"];

/** 语言偏好不是秘密，解锁前的画面也要用，所以不进加密存储。 */
const STORAGE_KEY = "ai-rp:locale:v1";

export type Vars = Record<string, string | number>;

let locale: Locale = "zh";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

/** 服务端和第一次客户端渲染都用中文，避免和水合结果打架。 */
export function getLocaleServerSnapshot(): Locale {
  return "zh";
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: Locale): void {
  locale = next;
  for (const listener of listeners) listener();
}

export function isLocale(value: string): value is Locale {
  return value === "zh" || value === "en";
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存不下就只在这一页生效
  }
  for (const listener of listeners) listener();
}

/**
 * 没有手动选过语言时，跟浏览器语言走。
 * 中文（含地区）用中文界面，其余用英文。手动选过的优先，写在 localStorage 里。
 */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  for (const language of languages ?? []) {
    const base = language.toLowerCase();
    if (base.startsWith("zh")) return "zh";
    if (base) return "en";
  }
  return "zh";
}

/** 挂载后读一次。有手动选择用手动的，否则用浏览器语言。 */
export function loadLocale(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLocale(saved)) {
      if (saved !== locale) publish(saved);
      return;
    }
  } catch {
    // 读不到偏好就看浏览器语言
  }
  const languages =
    typeof navigator === "undefined"
      ? undefined
      : navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : undefined;
  const detected = detectLocale(languages);
  if (detected !== locale) publish(detected);
}

export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(zh, key);
}

export function translate(current: Locale, key: MessageKey, vars?: Vars): string {
  const table = current === "en" ? en : zh;
  let text: string = table[key] ?? zh[key];
  if (!vars) return text;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/**
 * 把带 phrase 的错误翻成当前语言。
 * 加密层抛出的仍是中文 message，给没有界面的调用方兜底；
 * 画面上优先用 phrase 对应的译文。
 */
export function explainError(caught: unknown, t: (key: MessageKey, vars?: Vars) => string): string {
  if (caught && typeof caught === "object" && "phrase" in caught) {
    const phrase = (caught as { phrase?: unknown }).phrase;
    const vars = (caught as { vars?: Vars }).vars;
    if (typeof phrase === "string") {
      const key = `vault.error.${phrase}`;
      if (hasMessage(key)) return t(key, vars);
    }
  }
  if (caught instanceof Error && caught.message) return caught.message;
  return t("common.failed");
}
