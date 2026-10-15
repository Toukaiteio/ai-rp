"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getLocale,
  getLocaleServerSnapshot,
  setLocale,
  subscribeLocale,
  translate,
  type Locale,
  type MessageKey,
  type Vars,
} from "./index";

/** 当前语言和文案函数。语言存在本机，不进加密存储。 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocaleServerSnapshot);
  const t = useCallback(
    (key: MessageKey, vars?: Vars) => translate(locale, key, vars),
    [locale],
  );
  return { locale, setLocale, t };
}

export type { Locale };
