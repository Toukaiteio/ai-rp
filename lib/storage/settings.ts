import type { ProviderConfig } from "@/lib/providers/settings";
import { registerVaultData } from "@/lib/vault/registry";
import { readSlot, removeSlot, writeSlot } from "@/lib/vault";

/**
 * 连接设置的本地记忆。
 *
 * 放在 localStorage 这一层（scope: local）：API Key、Base URL、模型选择
 * 都属于敏感信息，小归小，一定要加密。整包走 AES-256-GCM，
 * 密钥只由用户设定的密钥派生，本机不存密钥。
 */

const SLOT = "settings";

let cached: ProviderConfig | null = null;
/** 进行中的那一次读取。并发调用要等同一个 promise，不能各自提前返回空结果。 */
let loading: Promise<void> | null = null;
/** 每次清空都换一代，迟到的读取结果不许再写回内存。 */
let generation = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeProviderConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** getSnapshot 必须返回稳定引用，否则 React 会以为一直在变而无限重渲染。 */
export function getProviderConfigSnapshot(): ProviderConfig | null {
  return cached;
}

export function getProviderConfigServerSnapshot(): ProviderConfig | null {
  return null;
}

async function load(): Promise<void> {
  if (loading) return loading;

  const gen = generation;
  const task = (async () => {
    try {
      const stored = await readSlot<ProviderConfig>("local", SLOT);
      if (gen !== generation) return;
      cached = stored && typeof stored === "object" ? stored : null;
    } catch {
      // 未解锁时读不了，保持 null
      if (gen !== generation) return;
      cached = null;
    }
  })();

  loading = task;
  try {
    await task;
  } finally {
    if (loading === task) loading = null;
  }
  if (gen === generation) notify();
}

registerVaultData(load, () => {
  generation += 1;
  loading = null;
  cached = null;
  notify();
});

export async function saveProviderConfig(config: ProviderConfig): Promise<void> {
  cached = config;
  notify();
  try {
    await writeSlot("local", SLOT, config);
  } catch {
    // 未解锁时写不进去；内存里这份还在这次会话里有效
  }
}

export async function clearProviderConfig(): Promise<void> {
  cached = null;
  notify();
  try {
    await removeSlot("local", SLOT);
  } catch {
    // 未解锁，本来也没东西可删
  }
}
