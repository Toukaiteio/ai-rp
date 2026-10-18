/**
 * 上次打开的角色。
 *
 * 刷新之后要回到上一次那张卡，而不是角色架上的第一张。角色 id 不是秘密
 * （角色卡在磁盘上的键本来就是明文 id），解锁前也不用读它，所以和主题、
 * 语言一样直接写在 localStorage，不进加密存储：读盘是同步的，启动时
 * 不必为了它多等一次解密。
 */

export const LAST_CARD_STORAGE_KEY = "ai-rp:last-card:v1";

export function readLastCardId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const saved = localStorage.getItem(LAST_CARD_STORAGE_KEY);
    return saved && saved.trim() ? saved : null;
  } catch {
    // 隐私模式下读不了，按没有存过处理
    return null;
  }
}

export function rememberLastCardId(id: string): void {
  if (!id) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_CARD_STORAGE_KEY, id);
  } catch {
    // 存不下就只在这一页生效
  }
}

export function forgetLastCardId(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(LAST_CARD_STORAGE_KEY);
  } catch {
    // 同上
  }
}

/**
 * 启动时该进哪张卡。
 *
 * 先认上次打开的那张；它不在了（删掉了、换了设备、导入的存档换了 id）
 * 就退到最近一次有对话的那张，那才是玩家心里的「上一次」。两个都没有
 * 就返回 null，由调用方退回角色架的第一张。
 */
export function pickInitialCardId(input: {
  remembered: string | null;
  /** 按最近一次更新排好序的会话所属卡 id */
  recent: readonly string[];
  /** 本机现有的卡 id */
  available: readonly string[];
}): string | null {
  const known = new Set(input.available);
  for (const id of [input.remembered, ...input.recent]) {
    if (id && known.has(id)) return id;
  }
  return null;
}
