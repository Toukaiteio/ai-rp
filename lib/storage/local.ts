import type { KeyFacts, RollingSummary } from "@/lib/prompt/types";
import type { ChatSession, SessionStore } from "./types";
import { registerVaultData } from "@/lib/vault/registry";
import { listSlots, readSlot, removeSlot, writeSlot } from "@/lib/vault";

/**
 * 会话存储：聊天记录落 IndexedDB（不支持时回退 localStorage），加密。
 *
 * 内容一律是密文，后端自己看不懂。解锁后整批读进内存，
 * 读写都走内存镜像，写操作再异步落盘——界面不会等磁盘。
 */

const PREFIX = "session:";

const sessions = new Map<string, ChatSession>();
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const rows = await listSlots<ChatSession>("data", PREFIX);
    sessions.clear();
    for (const row of rows) {
      if (row.value?.id === row.id.slice(PREFIX.length)) {
        sessions.set(row.value.id, row.value);
      }
    }
    loaded = true;
  } catch {
    sessions.clear();
    loaded = true;
  } finally {
    loading = false;
  }
  notify();
}

registerVaultData(load, () => {
  sessions.clear();
  loaded = false;
  notify();
});

function sorted(): ChatSession[] {
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function ensureLoaded(): Promise<void> {
  if (!loaded && !loading) await load();
}

export function createLocalSessionStore(): SessionStore {
  return {
    async list() {
      await ensureLoaded();
      return sorted();
    },

    async get(id) {
      await ensureLoaded();
      return sessions.get(id) ?? null;
    },

    async save(session) {
      sessions.set(session.id, session);
      notify();
      try {
        await writeSlot("data", `${PREFIX}${session.id}`, session);
      } catch {
        // 未解锁时只留在内存
      }
    },

    async remove(id) {
      sessions.delete(id);
      notify();
      try {
        await removeSlot("data", `${PREFIX}${id}`);
      } catch {
        // 同上
      }
    },

    async clear() {
      sessions.clear();
      notify();
      try {
        await clearSessions();
      } catch {
        // 同上
      }
    },
  };
}

/** 存档导入用：直接写入，不经过 store。 */
export async function replaceSessions(list: ChatSession[]): Promise<void> {
  for (const session of list) {
    await writeSlot("data", `${PREFIX}${session.id}`, session);
  }
  await load();
}

async function clearSessions(): Promise<void> {
  const { clearSlots } = await import("@/lib/vault");
  await clearSlots("data", PREFIX);
}

/* ---------------------------------------------------------------- 每张卡的长期记忆 */

/**
 * 一张卡在这台设备上的长期状态：滚动摘要、关键事实、轮次。
 *
 * 单独存而不挂在会话上：换会话、重开页面都得接着上次的记忆走，
 * 丢了就等于五十轮之后的剧情全忘。
 */
export interface CardMemory {
  cardId: string;
  summary: RollingSummary | null;
  facts: KeyFacts;
  turn: number;
  updatedAt: number;
}

const MEMORY_PREFIX = "memory:";

export function emptyCardMemory(cardId: string): CardMemory {
  return { cardId, summary: null, facts: { characters: {}, places: {}, flags: {} }, turn: 0, updatedAt: 0 };
}

export async function loadCardMemory(cardId: string): Promise<CardMemory> {
  try {
    const stored = await readSlot<CardMemory>("data", `${MEMORY_PREFIX}${cardId}`);
    if (!stored || stored.cardId !== cardId) return emptyCardMemory(cardId);
    return {
      cardId,
      summary: stored.summary ?? null,
      facts: stored.facts ?? { characters: {}, places: {}, flags: {} },
      turn: typeof stored.turn === "number" ? stored.turn : 0,
      updatedAt: stored.updatedAt ?? 0,
    };
  } catch {
    return emptyCardMemory(cardId);
  }
}

export async function saveCardMemory(memory: CardMemory): Promise<void> {
  try {
    await writeSlot("data", `${MEMORY_PREFIX}${memory.cardId}`, {
      ...memory,
      updatedAt: Date.now(),
    });
  } catch {
    // 未解锁时只留在内存
  }
}

export async function removeCardMemory(cardId: string): Promise<void> {
  try {
    await removeSlot("data", `${MEMORY_PREFIX}${cardId}`);
  } catch {
    // 同上
  }
}

/** 存档导出用：把全部记忆读出来。 */
export async function listCardMemories(): Promise<CardMemory[]> {
  try {
    const rows = await listSlots<CardMemory>("data", MEMORY_PREFIX);
    return rows.map((row) => row.value).filter((item) => !!item?.cardId);
  } catch {
    return [];
  }
}

export async function replaceCardMemories(list: CardMemory[]): Promise<void> {
  for (const memory of list) {
    await writeSlot("data", `${MEMORY_PREFIX}${memory.cardId}`, memory);
  }
}
