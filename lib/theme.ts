/**
 * 界面主题。只有深色与浅色两档，默认深色。
 *
 * 主题不是秘密，解锁前的画面也要用，所以和语言一样存在 localStorage，
 * 不进加密存储。切换只改 <html data-theme>，颜色全部由 globals.css
 * 的令牌层接管，组件里不出现任何字面色值。
 */

export type Theme = "dark" | "light";

export const THEMES: readonly Theme[] = ["dark", "light"];

/** 和 app/layout.tsx 里首帧前那段脚本共用同一个键。 */
export const THEME_STORAGE_KEY = "ai-rp:theme:v1";

let theme: Theme = "dark";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return theme;
}

/** 服务端和第一次客户端渲染都用深色，避免和水合结果打架。 */
export function getThemeServerSnapshot(): Theme {
  return "dark";
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isTheme(value: string): value is Theme {
  return value === "dark" || value === "light";
}

/** 把主题写到 <html> 上。服务端没有 document，直接跳过。 */
export function applyTheme(next: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = next;
  /* 浏览器地址栏 / 安装后的状态栏也跟着换色。
     颜色直接从令牌里读，不在这里再抄一份色值。 */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const background = getComputedStyle(root).getPropertyValue("--background").trim();
    if (background) meta.setAttribute("content", background);
  }
}

export function setTheme(next: Theme): void {
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // 存不下就只在这一页生效
  }
  if (next === theme) return;
  theme = next;
  for (const listener of listeners) listener();
}

function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && isTheme(saved)) return saved;
  } catch {
    // 读不到偏好就保持默认深色
  }
  return theme;
}

/**
 * 挂载后读一次。首帧的 data-theme 已经由 layout 里的内联脚本写好，
 * 这里补的是模块状态和 React 订阅；开发环境 Strict Mode 重挂时
 * 也会靠它把被 React 清掉的属性补回去。
 */
export function loadTheme(): void {
  const next = readStoredTheme();
  applyTheme(next);
  if (next === theme) return;
  theme = next;
  for (const listener of listeners) listener();
}
