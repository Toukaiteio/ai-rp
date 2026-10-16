import { beforeEach, describe, expect, it } from "vitest";
import { setupVault, wipeVaultData } from "@/lib/vault";
import { createMemoryBackend, configureBackends } from "./backend";
import { getImportedCardsSnapshot, replaceImportedCards, type ImportedCardRecord } from "./cards";
import { replaceSessions } from "./local";
import { getSessionStore } from "./index";
import type { ChatSession } from "./types";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  configureBackends(createMemoryBackend(), createMemoryBackend());
  await wipeVaultData();
  await setupVault("correct horse battery", "correct horse battery");
});

describe("存档导入后的内存缓存", () => {
  it("导入角色卡后立即更新角色架，不需要刷新页面", async () => {
    const record = {
      id: "card-1",
      importedAt: 1,
      card: { data: { name: "测试角色" } },
    } as ImportedCardRecord;

    await replaceImportedCards([record]);

    expect(getImportedCardsSnapshot()).toEqual([record]);
  });

  it("导入会话后立即更新会话存储，不需要刷新页面", async () => {
    const session = {
      id: "session-1",
      cardId: "card-1",
      cardName: "测试角色",
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    } as ChatSession;

    await replaceSessions([session]);

    expect(await getSessionStore().list()).toEqual([session]);
  });
});
