"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CardEntry } from "@/lib/cards";
import {
  describeApiKey,
  withImage,
  type ProviderConfig,
} from "@/lib/providers/settings";
import {
  getImportedCardsServerSnapshot,
  getImportedCardsSnapshot,
  subscribeImportedCards,
} from "@/lib/storage/cards";
import { getSessionStore } from "@/lib/storage";
import {
  buildArchiveWithCards,
  buildKdfSidecar,
  kdfSidecarName,
  readArchiveFile,
  readArchivePayloadWithPassphrase,
  restoreArchivePayload,
} from "@/lib/storage/archive";
import {
  getProviderConfigServerSnapshot,
  getProviderConfigSnapshot,
  saveProviderConfig,
  subscribeProviderConfig,
} from "@/lib/storage/settings";
import {
  getVaultServerSnapshot,
  getVaultSnapshot,
  getVaultKdfParams,
  lockVault,
  probeVault,
  setupVault,
  subscribeVault,
  wipeVaultData,
  type VaultKdfParams,
} from "@/lib/vault";
import { explainError, loadLocale } from "@/lib/i18n";
import { loadTheme } from "@/lib/theme";
import { loadUnfiltered } from "@/lib/cards/unfiltered";
import { watchRememberedSession } from "@/lib/vault/remember";
import { useI18n } from "@/lib/i18n/use-i18n";
import { ChatScreen } from "./ChatScreen";
import { SettingsScreen } from "./SettingsScreen";
import { ShelfScreen } from "./ShelfScreen";
import { CharacterEditor } from "./CharacterEditor";
import { VaultGate } from "./VaultGate";

type Screen = "chat" | "shelf" | "settings" | "editor";

/** 导出成文本文件。纯浏览器行为，不经过服务端。 */
function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会取消掉这次下载，等一拍再释放
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * 应用外壳：管画面切换、当前角色、连接配置，以及解锁状态。
 *
 * 未解锁时整个聊天和设置都不挂载——它们的数据在密文里，
 * 没有密钥读不出来，挂载了也只会显示空壳。
 *
 * 配置整份（含 API Key）加密存 localStorage，密钥由用户设定、不落盘。
 */
export function AppShell() {
  const [screen, setScreen] = useState<Screen>("chat");
  /** 没有默认卡：进来先进角色架，挑一张或在线拉一张再开聊 */
  const [cardId, setCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [edited, setEdited] = useState<ProviderConfig | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveRestoring, setArchiveRestoring] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [archiveNote, setArchiveNote] = useState<string | null>(null);
  const { t } = useI18n();

  const vault = useSyncExternalStore(
    subscribeVault,
    getVaultSnapshot,
    getVaultServerSnapshot,
  );
  const stored = useSyncExternalStore(
    subscribeProviderConfig,
    getProviderConfigSnapshot,
    getProviderConfigServerSnapshot,
  );
  const imported = useSyncExternalStore(
    subscribeImportedCards,
    getImportedCardsSnapshot,
    getImportedCardsServerSnapshot,
  );

  useEffect(() => {
    loadLocale();
    loadTheme();
    loadUnfiltered();
    void probeVault();
  }, []);

  useEffect(() => {
    if (vault.status !== "unlocked") return;
    return watchRememberedSession(() => lockVault());
  }, [vault.status]);

  /** 角色全部来自本机：在线下载或 JSON 导入，代码里不放别人的卡。 */
  const cards = useMemo<CardEntry[]>(
    () =>
      imported.map((record) => ({
        id: record.id,
        card: record.card,
        source: "imported" as const,
      })),
    [imported],
  );

  const current = cards.find((entry) => entry.id === cardId) ?? cards[0];

  const config = useMemo<ProviderConfig>(() => withImage(edited ?? stored), [edited, stored]);

  const updateConfig = useCallback((next: ProviderConfig) => {
    setEdited(next);
    void saveProviderConfig(next);
  }, []);

  /** 导出 / 导入走的是一个加密整包，密钥就是解锁用的那个。 */
  const handleExport = useCallback(() => {
    setArchiveBusy(true);
    setArchiveMessage(null);
    void (async () => {
      try {
        const store = getSessionStore();
        const sessions = await store.list();
        const text = await buildArchiveWithCards(sessions, imported);
        const archiveName = `ai-rp-archive-${new Date().toISOString().slice(0, 10)}.json`;
        downloadText(text, archiveName);
        const kdf = getVaultKdfParams();
        if (kdf) {
          /* 存档整包是密文，盐和迭代次数不在里面。换设备时没有它们就解不开，
             所以同名再落一个明文旁文件。浏览器会把同一拍里的第二个下载当弹窗
             拦掉，错开一拍再发。 */
          const sidecarName = kdfSidecarName(archiveName);
          window.setTimeout(() => downloadText(buildKdfSidecar(kdf), sidecarName), 250);
          setArchiveNote(
            t("shell.exportedWithKdf", {
              file: sidecarName,
              salt: kdf.salt,
              iterations: kdf.iterations,
            }),
          );
        }
      } catch (caught) {
        setArchiveMessage(explainError(caught, t));
      } finally {
        setArchiveBusy(false);
      }
    })();
  }, [imported, t]);

  const handleImport = useCallback((file: File | undefined) => {
    if (!file) return;
    setArchiveBusy(true);
    setArchiveMessage(null);
    void (async () => {
      try {
        const result = await readArchiveFile(file);
        setArchiveMessage(null);
        setArchiveNote(t("shell.imported", { sessions: result.sessions, cards: result.cards }));
      } catch (caught) {
        setArchiveMessage(explainError(caught, t));
      } finally {
        setArchiveBusy(false);
      }
    })();
  }, [t]);

  const handleInitialArchiveImport = useCallback(
    async (file: File, passphrase: string, params: VaultKdfParams, rememberMs: number) => {
      setArchiveRestoring(true);
      try {
        const payload = await readArchivePayloadWithPassphrase(file, passphrase, params);
        await setupVault(passphrase, passphrase, rememberMs, params);
        return await restoreArchivePayload(payload);
      } finally {
        setArchiveRestoring(false);
      }
    },
    [],
  );

  if (archiveRestoring) {
    return (
      <div className="grid h-dvh place-items-center bg-background px-6 text-[14px] text-ink-2">
        {t("shell.restoringArchive")}
      </div>
    );
  }

  if (vault.status !== "unlocked") {
    return (
      <div className="h-dvh overflow-y-auto bg-background">
        <div className="mx-auto max-w-[520px] px-6 py-10">
            <VaultGate
              status={vault.status}
              attemptsLeft={vault.attemptsLeft}
              notice={vault.notice}
              onImportArchive={handleInitialArchiveImport}
            />
        </div>
      </div>
    );
  }

  if (screen === "editor") {
    const editingRecord = editingCardId ? imported.find((record) => record.id === editingCardId) : undefined;
    return (
      <CharacterEditor
        record={editingRecord}
        onCancel={() => setScreen("shelf")}
        onSaved={(id) => {
          setCardId((currentId) => currentId ?? id);
          setEditingCardId(null);
          setScreen("shelf");
        }}
      />
    );
  }

  // 一张卡都没有时没有对话可显示，只能留在角色架。
  // 玩家正在挑卡，所以新卡到位后也留在角色架，想聊就点卡片上的「开始」。
  if (!current) {
    return (
      <ShelfScreen
        cards={cards}
        currentCardId=""
        onSelect={(id) => {
          setCardId(id);
          setScreen("chat");
        }}
        onCardsChanged={() => setScreen("shelf")}
        onCreate={() => {
          setEditingCardId(null);
          setScreen("editor");
        }}
      />
    );
  }

  return (
    <div className="relative">
      {/* 用 hidden 而不是卸载：切去角色架或设置再回来，对话和流式状态都还在 */}
      <div className={screen === "chat" ? undefined : "hidden"}>
        {/* key 用卡 id：换角色即重新挂载，开场白、会话、输入框提示一起换掉 */}
        <ChatScreen
          key={current.id}
          cardId={current.id}
          card={current.card.data}
          config={config}
          onOpenSettings={() => setScreen("settings")}
          onOpenShelf={() => setScreen("shelf")}
        />
      </div>

      {screen === "shelf" ? (
        <ShelfScreen
          cards={cards}
          currentCardId={current.id}
          onSelect={(id) => {
            setCardId(id);
            setScreen("chat");
          }}
          onBack={() => setScreen("chat")}
          onCardsChanged={() => setScreen("shelf")}
          onCreate={() => {
            setEditingCardId(null);
            setScreen("editor");
          }}
          onEdit={(id) => {
            setEditingCardId(id);
            setScreen("editor");
          }}
        />
      ) : null}

      {screen === "settings" ? (
        <SettingsScreen
          config={config}
          onChange={updateConfig}
          onLock={() => {
            setScreen("chat");
            setEdited(null);
            lockVault();
          }}
          onWipe={async () => {
            setScreen("chat");
            setEdited(null);
            await wipeVaultData();
          }}
          onExport={handleExport}
          onImport={handleImport}
          archiveBusy={archiveBusy}
          archiveMessage={archiveMessage ?? archiveNote}
          onBack={() => setScreen("chat")}
        />
      ) : null}
    </div>
  );
}

/** 顶栏显示用的 Key 摘要，别处不要直接读 ProviderConfig.apiKey 去拼字符串。 */
export function describeKey(key: string): string {
  return describeApiKey(key);
}

export { getSessionStore };
