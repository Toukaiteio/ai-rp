"use client";

import { useSyncExternalStore } from "react";
import {
  getTheme,
  getThemeServerSnapshot,
  setTheme,
  subscribeTheme,
  type Theme,
} from "./theme";

/** 当前主题和切换函数。主题存在本机，不进加密存储。 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);
  return { theme, setTheme };
}

export type { Theme };
