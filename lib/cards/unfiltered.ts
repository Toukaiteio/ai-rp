/**
 * 在线角色卡列表的「无过滤内容」开关。
 *
 * 这个偏好不是秘密，解锁前的画面也要用，所以和语言一样直接写在 localStorage，
 * 不进加密存储。切换后立刻落盘，下次打开还是同一个状态。
 */

const STORAGE_KEY = "ai-rp:unfiltered:v1";

let unfiltered = false;
const listeners = new Set<() => void>();

export function getUnfiltered(): boolean {
  return unfiltered;
}

/** 服务端和第一次客户端渲染都按关闭来，避免和水合结果打架。 */
export function getUnfilteredServerSnapshot(): boolean {
  return false;
}

export function subscribeUnfiltered(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: boolean): void {
  unfiltered = next;
  for (const listener of listeners) listener();
}

export function setUnfiltered(next: boolean): void {
  if (next === unfiltered) return;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // 存不下就只在这一页生效
  }
  publish(next);
}

/** 挂载后读一次。读不到就按关闭处理。 */
export function loadUnfiltered(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1" || saved === "0") {
      const next = saved === "1";
      if (next !== unfiltered) publish(next);
    }
  } catch {
    // 隐私模式下读不了，保持关闭
  }
}
