import type { CharacterCard } from "@/lib/cards/types";
import { createId } from "./types";
import { registerVaultData } from "@/lib/vault/registry";
import { listSlots, readSlot, removeSlot, writeSlot } from "@/lib/vault";

/**
 * 导入的角色卡。存在 IndexedDB（回退 localStorage），加密。
 * 角色卡是用户自己的东西，不加密等于把设定和人设明文摊在磁盘上。
 */

export interface ImportedCardRecord {
  id: string;
  card: CharacterCard;
  importedAt: number;
}

const PREFIX = "card:";
/** SSR 与首次 hydrate 用的稳定空数组，引用不能每次新建。 */
const EMPTY: ImportedCardRecord[] = [];

let cached: ImportedCardRecord[] | null = null;
let loading = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeImportedCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getImportedCardsSnapshot(): ImportedCardRecord[] {
  return cached ?? EMPTY;
}

export function getImportedCardsServerSnapshot(): ImportedCardRecord[] {
  return EMPTY;
}

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const rows = await listSlots<ImportedCardRecord>("data", PREFIX);
    cached = rows
      .map((row) => row.value)
      .filter((record): record is ImportedCardRecord => !!record?.card?.data?.name)
      .sort((a, b) => b.importedAt - a.importedAt);
  } catch {
    cached = null;
  } finally {
    loading = false;
  }
  notify();
}

registerVaultData(load, () => {
  cached = null;
  notify();
});

export async function addImportedCard(card: CharacterCard): Promise<ImportedCardRecord> {
  const record: ImportedCardRecord = {
    id: createId(),
    card,
    importedAt: Date.now(),
  };
  const next = [record, ...getImportedCardsSnapshot()];
  cached = next;
  notify();
  try {
    await writeSlot("data", `${PREFIX}${record.id}`, record);
  } catch {
    // 未解锁时写不进去
  }
  return record;
}

export async function updateImportedCard(record: ImportedCardRecord): Promise<void> {
  cached = getImportedCardsSnapshot().map((item) =>
    item.id === record.id ? record : item,
  );
  notify();
  try {
    await writeSlot("data", `${PREFIX}${record.id}`, record);
  } catch {
    // 同上
  }
}

export async function removeImportedCard(id: string): Promise<void> {
  cached = getImportedCardsSnapshot().filter((record) => record.id !== id);
  notify();
  try {
    await removeSlot("data", `${PREFIX}${id}`);
  } catch {
    // 同上
  }
}

/** 存档导入用：把一批卡直接写进去，按 id 去重。 */
export async function replaceImportedCards(records: ImportedCardRecord[]): Promise<void> {
  for (const record of records) {
    await writeSlot("data", `${PREFIX}${record.id}`, record);
  }
  await load();
}

export { readSlot as readCardSlot };
