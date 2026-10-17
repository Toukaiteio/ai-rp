import type { CharacterCard } from "@/lib/cards/types";
import { normalizeJournal } from "@/lib/memory/journal";
import { loadCardMemory, listCardMemories, replaceCardMemories, replaceSessions, type CardMemory } from "./local";
import { replaceImportedCards, type ImportedCardRecord } from "./cards";
import type { ChatSession } from "./types";
import { exportArchive, importArchive, importArchiveWithPassphrase, VaultError, type VaultKdfParams } from "@/lib/vault";

/**
 * 存档导出 / 导入。整包用用户设定的密钥加密，文件里没有明文。
 *
 * 换设备、备份都走这个。密钥不在文件里，也不在任何存储里，
 * 所以忘了密钥就等于数据没了，这一点在界面上必须说清楚。
 */

export interface ArchivePayload {
  sessions: ChatSession[];
  cards: ImportedCardRecord[];
  /**
   * 每张卡的长期记忆。journal 里有人物、地点、事件和生成的头像。
   * 头像是 data URL，只存在这里，不进提示词。
   */
  memories: CardMemory[];
}

/** 导出前把记忆收成稳定形状，旧字段和新头像都留住。 */
export function packMemories(list: CardMemory[]): CardMemory[] {
  return list.map((memory) => ({
    ...memory,
    journal: normalizeJournal(memory.journal),
  }));
}

const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 恢复参数旁文件的后缀。存档整包是密文，里面不带盐和迭代次数，
 * 换设备时没有这两个值就解不开，所以导出时另发一份明文。
 * 盐和迭代次数都不是秘密：盐是随机字节，迭代次数是公开参数，
 * 两者都拿不到密钥，也推不出密钥。
 */
export const KDF_SIDECAR_SUFFIX = ".kdf.json";

/** 旁文件和存档同名，只换后缀。 */
export function kdfSidecarName(archiveName: string): string {
  const stem = archiveName.toLowerCase().endsWith(".json")
    ? archiveName.slice(0, -".json".length)
    : archiveName;
  return `${stem}${KDF_SIDECAR_SUFFIX}`;
}

/** 旁文件内容：只有盐和迭代次数，不带任何密钥材料。 */
export function buildKdfSidecar(params: VaultKdfParams): string {
  return `${JSON.stringify({ salt: params.salt, iterations: params.iterations }, null, 2)}\n`;
}

export async function buildArchive(loadSessions: () => Promise<ChatSession[]>): Promise<string> {
  const payload: ArchivePayload = {
    sessions: await loadSessions(),
    cards: [],
    memories: packMemories(await listCardMemories()),
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
    memories: packMemories(await listCardMemories()),
  });
}

export async function readArchiveFile(file: File): Promise<{ sessions: number; cards: number }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new VaultError("文件超过 32MB", "bad_passphrase", "archive_too_big");
  }
  const text = await file.text();
  const { payload } = await importArchive(text);
  return restoreArchivePayload(payload);
}

export async function readArchiveFileWithPassphrase(
  file: File,
  passphrase: string,
  params: import("@/lib/vault").VaultKdfParams,
): Promise<{ sessions: number; cards: number }> {
  const payload = await readArchivePayloadWithPassphrase(file, passphrase, params);
  return restoreArchivePayload(payload);
}

export async function readArchivePayloadWithPassphrase(
  file: File,
  passphrase: string,
  params: import("@/lib/vault").VaultKdfParams,
): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES) {
    throw new VaultError("文件超过 32MB", "bad_passphrase", "archive_too_big");
  }
  const text = await file.text();
  const { payload } = await importArchiveWithPassphrase(text, passphrase, params);
  return payload;
}

export async function restoreArchivePayload(payload: unknown): Promise<{ sessions: number; cards: number }> {
  const parsed = normalizePayload(payload);
  await Promise.all([
    replaceSessions(parsed.sessions),
    replaceImportedCards(parsed.cards),
    replaceCardMemories(parsed.memories),
  ]);
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
    ? packMemories(
        source.memories.filter(
          (memory): memory is CardMemory => !!memory && typeof memory.cardId === "string",
        ),
      )
    : [];
  return { sessions, cards, memories };
}

export { loadCardMemory };
export type { CharacterCard };
