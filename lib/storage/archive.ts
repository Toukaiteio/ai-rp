import type { CharacterCard } from "@/lib/cards/types";
import { loadCardMemory, listCardMemories, replaceCardMemories, replaceSessions } from "./local";
import { replaceImportedCards, type ImportedCardRecord } from "./cards";
import type { ChatSession } from "./types";
import { exportArchive, importArchive, VaultError } from "@/lib/vault";

/**
 * 存档导出 / 导入。整包用用户设定的密钥加密，文件里没有明文。
 *
 * 换设备、备份都走这个。密钥不在文件里，也不在任何存储里，
 * 所以忘了密钥就等于数据没了，这一点在界面上必须说清楚。
 */

export interface ArchivePayload {
  sessions: ChatSession[];
  cards: ImportedCardRecord[];
  memories: Array<{
    cardId: string;
    summary: unknown;
    facts: unknown;
    turn: number;
    updatedAt: number;
  }>;
}

const MAX_FILE_BYTES = 32 * 1024 * 1024;

export async function buildArchive(loadSessions: () => Promise<ChatSession[]>): Promise<string> {
  const payload: ArchivePayload = {
    sessions: await loadSessions(),
    cards: [],
    memories: await listCardMemories(),
  };
  return exportArchive(payload);
}

/** 导入时把卡片一起带进来。卡片单独传，避免存档模块反向依赖 UI 状态。 */
export async function buildArchiveWithCards(
  sessions: ChatSession[],
  cards: ImportedCardRecord[],
): Promise<string> {
  return exportArchive({
    sessions,
    cards,
    memories: await listCardMemories(),
  });
}

export async function readArchiveFile(file: File): Promise<{ sessions: number; cards: number }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new VaultError("文件超过 32MB", "bad_passphrase");
  }
  const text = await file.text();
  const { payload } = await importArchive(text);
  const parsed = normalizePayload(payload);
  await replaceSessions(parsed.sessions);
  await replaceImportedCards(parsed.cards);
  await replaceCardMemories(parsed.memories);
  return { sessions: parsed.sessions.length, cards: parsed.cards.length };
}

function normalizePayload(payload: unknown): {
  sessions: ChatSession[];
  cards: ImportedCardRecord[];
  memories: Awaited<ReturnType<typeof listCardMemories>>;
} {
  const source = (payload ?? {}) as Partial<ArchivePayload>;
  const sessions = Array.isArray(source.sessions)
    ? source.sessions.filter(
        (session): session is ChatSession =>
          !!session && typeof session.id === "string" && Array.isArray(session.messages),
      )
    : [];
  const cards = Array.isArray(source.cards)
    ? source.cards.filter(
        (record): record is ImportedCardRecord =>
          !!record && typeof record.id === "string" && !!record.card,
      )
    : [];
  const memories = Array.isArray(source.memories)
    ? source.memories.filter(
        (memory): memory is Awaited<ReturnType<typeof listCardMemories>>[number] =>
          !!memory && typeof memory.cardId === "string",
      )
    : [];
  return { sessions, cards, memories };
}

export { loadCardMemory };
export type { CharacterCard };
