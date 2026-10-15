import raw from "@/data/announcements.json";

/**
 * 公告。
 *
 * 内容放在 data/announcements.json，改公告就是改那个文件，不用碰代码。
 * 关过的公告按 id 记在本机 localStorage。公告是公开信息，不进加密槽位。
 */

export interface Announcement {
  id: string;
  title: string;
  /** 纯文本，换行由界面保留 */
  body: string;
  level: "info" | "warn";
  /** 发布日期，只用来显示 */
  date?: string;
}

const STORAGE_KEY = "ai-rp:announcements-dismissed:v1";
const EMPTY: string[] = [];

function asText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/** 文件写错了不能让整个页面挂掉，坏条目跳过，好条目照常显示。 */
function sanitize(list: unknown): Announcement[] {
  if (!Array.isArray(list)) return [];
  const items: Announcement[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = asText(record.id, 60);
    const title = asText(record.title, 40);
    const body = asText(record.body, 2000);
    if (!id || !title || !body) continue;
    items.push({
      id,
      title,
      body,
      level: record.level === "warn" ? "warn" : "info",
      ...(asText(record.date, 20) ? { date: asText(record.date, 20) } : {}),
    });
  }
  return items;
}

export const ANNOUNCEMENTS: Announcement[] = sanitize(
  (raw as { items?: unknown })?.items,
);

/** 还没关过的公告。入参是已关闭的 id 列表，纯函数，方便测。 */
export function visibleAnnouncements(dismissed: readonly string[]): Announcement[] {
  return ANNOUNCEMENTS.filter((item) => !dismissed.includes(item.id));
}

const listeners = new Set<() => void>();
let dismissed: string[] | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function readStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDismissedSnapshot(): string[] {
  return dismissed ?? EMPTY;
}

/** SSR 与首次 hydrate 用同一个空数组，引用稳定，内容也一致。 */
export function getDismissedServerSnapshot(): string[] {
  return EMPTY;
}

/** 首次进页面时读一次本机记录。放在 effect 里，避免 hydrate 不一致。 */
export function loadDismissed(): void {
  if (dismissed !== null) return;
  dismissed = readStored();
  notify();
}

export function dismissAnnouncement(id: string): void {
  const current = dismissed ?? readStored();
  if (current.includes(id)) return;
  const next = [...current, id];
  dismissed = next;
  notify();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 写不进去也只是一次会话内反复出现，不影响别的东西
  }
}
