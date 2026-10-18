import { beforeEach, describe, expect, it } from "vitest";
import { setupVault, wipeVaultData } from "@/lib/vault";
import { createMemoryBackend, configureBackends } from "@/lib/storage/backend";
import { replaceImportedCards, type ImportedCardRecord } from "@/lib/storage/cards";
import { replaceSessions } from "@/lib/storage/local";
import { rememberLastCardId, readLastCardId } from "./last-card";
import { resolveStartupCardId } from "./startup-card";
import type { ChatSession } from "@/lib/storage/types";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

/** 模块按浏览器全局取 localStorage，这里把全局装上替身。 */
function installStorage(): void {
  const fake = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: fake };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: fake,
  });
}

function card(id: string, importedAt: number): ImportedCardRecord {
  return { id, importedAt, card: { data: { name: id } } } as ImportedCardRecord;
}

function session(cardId: string, updatedAt: number): ChatSession {
  return {
    id: `session-${cardId}`,
    cardId,
    cardName: cardId,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

beforeEach(async () => {
  installStorage();
  configureBackends(createMemoryBackend(), createMemoryBackend());
  await wipeVaultData();
  await setupVault("correct horse battery", "correct horse battery");
});

describe("启动时进哪个角色", () => {
  it("回到上次打开的那张卡，而不是最近导入的那张", async () => {
    // 最近导入的是 card-new，上次聊的是 card-old
    await replaceImportedCards([card("card-new", 3), card("card-old", 1)]);
    await replaceSessions([session("card-old", 10), session("card-new", 20)]);
    rememberLastCardId("card-old");

    expect(await resolveStartupCardId()).toBe("card-old");
  });

  it("没记过时退到最近聊过的那张卡", async () => {
    await replaceImportedCards([card("card-new", 3), card("card-old", 1)]);
    await replaceSessions([session("card-old", 10), session("card-new", 20)]);

    expect(await resolveStartupCardId()).toBe("card-new");
  });

  it("记下的那张已经删了，改用最近聊过的，并把废 id 清掉", async () => {
    await replaceImportedCards([card("card-a", 1), card("card-b", 2)]);
    await replaceSessions([session("card-a", 10)]);
    rememberLastCardId("card-deleted");

    expect(await resolveStartupCardId()).toBe("card-a");
    expect(readLastCardId()).toBe("card-a");
  });

  it("判定结果写回本机，下次启动还是同一张", async () => {
    await replaceImportedCards([card("card-new", 3), card("card-old", 1)]);
    await replaceSessions([session("card-old", 10)]);

    expect(await resolveStartupCardId()).toBe("card-old");
    expect(readLastCardId()).toBe("card-old");
  });

  it("一张卡都没有时返回 null，由调用方退回角色架", async () => {
    expect(await resolveStartupCardId()).toBeNull();
  });
});
