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
import { rememberLastCardId } from "@/lib/last-card";
import { resolveStartupCardId } from "@/lib/startup-card";
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
import { isBackupDue } from "@/lib/storage/backup";
import { useI18n } from "@/lib/i18n/use-i18n";
import { configureAndroidStorage } from "@/lib/storage/native";
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
  const [settingsReturnScreen, setSettingsReturnScreen] = useState<"chat" | "shelf">("chat");
  /** 没有默认卡：进来先进角色架，挑一张或在线拉一张再开聊 */
  const [cardId, setCardId] = useState<string | null>(null);
  /** 启动时那一次「上次是哪张卡」判完没有。判完之前不挂任何一屏，见下面的 useEffect */
  const [resolved, setResolved] = useState(false);
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
    configureAndroidStorage();
    loadLocale();
    loadTheme();
    loadUnfiltered();
    void probeVault();
  }, []);

  useEffect(() => {
    if (vault.status !== "unlocked") return;
    return watchRememberedSession(() => lockVault());
  }, [vault.status]);

  /**
   * 解锁后先判定这次该进哪个角色：上次打开的那张，退而求其次最近聊过的那张。
   *
   * 以前这里什么都不做，`current` 就落到 cards[0]，也就是最近导入的那张，
   * 于是每次刷新都跑进第一个角色的对话。
   */
  useEffect(() => {
    if (vault.status !== "unlocked" || resolved) return;
    let cancelled = false;

    void (async () => {
      try {
        const chosen = await resolveStartupCardId();
        if (!cancelled && chosen) setCardId(chosen);
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vault.status, resolved]);

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
    // 先归一化再落盘：自定义提供商条目在这里跟着顶层字段同步
    const merged = withImage(next);
    setEdited(merged);
    void saveProviderConfig(merged);
  }, []);

  const handleVaultSetup = useCallback((userName: string) => {
    updateConfig({ ...config, userName });
  }, [config, updateConfig]);

  /** 导出 / 导入走的是一个加密整包，密钥就是解锁用的那个。 */
  const exportArchive = useCallback(async (automatic: boolean) => {
    setArchiveBusy(true);
    setArchiveMessage(null);
    try {
        const store = getSessionStore();
        const sessions = await store.list();
        const text = await buildArchiveWithCards(sessions, imported);
        const archiveName = `ai-rp-archive-${new Date().toISOString().slice(0, 10)}.json`;
        downloadText(text, archiveName);
        const kdf = getVaultKdfParams();
        if (kdf) {
          const sidecarName = kdfSidecarName(archiveName);
          window.setTimeout(() => downloadText(buildKdfSidecar(kdf), sidecarName), 250);
          setArchiveNote(t("shell.exportedWithKdf", { file: sidecarName, salt: kdf.salt, iterations: kdf.iterations }));
        }
        if (automatic) {
          const next = { ...config, autoBackup: { ...config.autoBackup, lastBackupAt: Date.now() } };
          setEdited(next);
          void saveProviderConfig(next);
        }
    } catch (caught) {
      setArchiveMessage(explainError(caught, t));
    } finally {
      setArchiveBusy(false);
    }
  }, [config, imported, t]);

  const handleExport = useCallback(() => {
    void exportArchive(false);
  }, [exportArchive]);

  useEffect(() => {
    if (vault.status !== "unlocked" || !config.autoBackup.enabled) return;
    const check = () => {
      if (document.visibilityState !== "visible" || archiveBusy || !isBackupDue(config.autoBackup)) return;
      void exportArchive(true);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [archiveBusy, config.autoBackup, exportArchive, vault.status]);

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
              onSetupComplete={handleVaultSetup}
            />
        </div>
      </div>
    );
  }

  // 角色还没判定完就先别画：先画角色架会闪一下，先画第一张卡又会把
  // 别人的对话挂上去，等这一下换来的就是「回到上次那张卡」。
  if (!resolved) {
    return (
      <div className="grid h-dvh place-items-center bg-background px-6 text-[14px] text-ink-2">
        {t("shell.loading")}
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
          // 之前一张卡都没有时，新建的这张就是当前角色，一起记下来
          if (!cardId) {
            setCardId(id);
            rememberLastCardId(id);
          }
          setEditingCardId(null);
          setScreen("shelf");
        }}
      />
    );
  }

  // 一张卡都没有时没有对话可显示，只能留在角色架。
  // 玩家正在挑卡，所以新卡到位后也留在角色架，想聊就点卡片上的「开始」。
  if (!current && screen !== "settings") {
    return (
      <ShelfScreen
        cards={cards}
        currentCardId=""
        userName={config.userName}
        onOpenSettings={() => {
          setSettingsReturnScreen("shelf");
          setScreen("settings");
        }}
        onSelect={(id) => {
          setCardId(id);
          rememberLastCardId(id);
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
      {current ? <div className={screen === "chat" ? undefined : "hidden"}>
        {/* key 用卡 id：换角色即重新挂载，开场白、会话、输入框提示一起换掉 */}
        <ChatScreen
          key={current.id}
          cardId={current.id}
          card={current.card.data}
          config={config}
          userName={config.userName}
          onUserNameChange={(next) => updateConfig({ ...config, userName: next })}
          onOpenSettings={() => {
            setSettingsReturnScreen("chat");
            setScreen("settings");
          }}
          onOpenShelf={() => setScreen("shelf")}
        />
      </div> : null}

      {screen === "shelf" && current ? (
        <ShelfScreen
          cards={cards}
          currentCardId={current.id}
          userName={config.userName}
          onOpenSettings={() => {
            setSettingsReturnScreen("shelf");
            setScreen("settings");
          }}
        onSelect={(id) => {
          setCardId(id);
          rememberLastCardId(id);
          setScreen("chat");
        }}
        onBack={() => setScreen("chat")}
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
          onBack={() => setScreen(settingsReturnScreen)}
          backLabel={settingsReturnScreen === "chat" ? t("settings.backToChat") : t("settings.backToShelf")}
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
