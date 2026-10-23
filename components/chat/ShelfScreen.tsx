"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Languages, PenLine, Plus, Undo2, Upload } from "lucide-react";
import {
  CharacterCard,
  Dialog,
  IconButton,
  ScreenHead,
  Tag,
} from "@/components/ui";
import { IconBack, IconDownload, IconEdit, IconGear, IconImage, IconTrash } from "@/components/icons";
import {
  downloadCard,
  downloadCardPng,
  isPlayableCard,
  readCardFile,
  type CardEntry,
} from "@/lib/cards";
import {
  cardPortraitUrl,
  isChubRegionRestriction,
  onlineSearchUrl,
} from "@/lib/cards/online";
import { addImportedCard, removeImportedCard } from "@/lib/storage/cards";
import { useI18n } from "@/lib/i18n/use-i18n";
import { AnnouncementBell, AnnouncementDialog } from "./Announcements";
import { AndroidStatus } from "./AndroidStatus";
import { OnlineCards } from "./OnlineCards";
import { Avatar } from "./Avatar";
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";
import { CardTranslation } from "./CardTranslation";
import {
  getTranslationTasksServerSnapshot,
  getTranslationTasksSnapshot,
  setTranslationTray,
  subscribeTranslationTasks,
} from "./CardTranslationTasks";
import { CardTranslationTray } from "./CardTranslationTray";
import { applyMacros } from "@/lib/prompt";
import { hasNativeFilePicker, isAndroidApp, pickNativeFile } from "@/lib/storage/native";

/** 简介只在悬停面板里出现，留得下一段完整的设定开头。 */
function firstSentence(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").replace(/【[^】]*】/g, "").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit)}…`;
}

export function ShelfScreen({
  cards,
  currentCardId,
  userName = "你",
  onSelect,
  onBack,
  onCardsChanged,
  onCreate,
  onEdit,
  onOpenSettings,
}: {
  cards: CardEntry[];
  currentCardId: string;
  userName?: string;
  onSelect: (cardId: string) => void;
  onBack?: () => void;
  /** 新卡到位。用来把「本来没有卡、被迫留在角色架」的状态续上 */
  onCardsChanged?: () => void;
  onCreate?: () => void;
  onEdit?: (cardId: string) => void;
  onOpenSettings?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [chubRegionRestricted, setChubRegionRestricted] = useState(false);
  const [chubAvailabilityChecked, setChubAvailabilityChecked] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [shelfTab, setShelfTab] = useState<"network" | "local">("network");
  const [scrollAction, setScrollAction] = useState<"top" | "return" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const returnScrollTopRef = useRef(0);
  const jumpingRef = useRef(false);
  const { t } = useI18n();
  const androidApp = useSyncExternalStore(() => () => {}, isAndroidApp, () => false);
  const translationTasks = useSyncExternalStore(
    subscribeTranslationTasks, getTranslationTasksSnapshot, getTranslationTasksServerSnapshot);
  const hasLiveTranslations = translationTasks.some((task) =>
    task.status === "running" || task.status === "saving" || task.status === "failed");

  const tags = useMemo(
    () => {
      const unique = new Map<string, string>();
      for (const entry of cards) {
        for (const rawTag of entry.card.data.tags ?? []) {
          const tag = rawTag.trim();
          if (tag && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag);
        }
      }
      return [...unique.values()].sort((left, right) => left.localeCompare(right));
    },
    [cards],
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of cards) {
      for (const rawTag of entry.card.data.tags ?? []) {
        const tag = rawTag.trim();
        if (tag) counts.set(tag.toLocaleLowerCase(), (counts.get(tag.toLocaleLowerCase()) ?? 0) + 1);
      }
    }
    return counts;
  }, [cards]);
  const visibleTags = tags.slice(0, 8);
  const filteredCards = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return cards.filter((entry) => {
      const data = entry.card.data;
      const matchesSearch =
        !keyword ||
        [data.name, data.description, ...(data.tags ?? [])].some((value) =>
          value.toLocaleLowerCase().includes(keyword),
        );
      const matchesTag =
        !activeTag ||
        (data.tags ?? []).some((tag) => tag.trim().toLocaleLowerCase() === activeTag.toLocaleLowerCase());
      return matchesSearch && matchesTag;
    });
  }, [activeTag, cards, search]);

  function selectShelfTab(next: "network" | "local"): void {
    setShelfTab(next);
    setScrollAction(null);
    returnScrollTopRef.current = 0;
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }

  function handleScroll(): void {
    const element = scrollRef.current;
    if (!element || shelfTab !== "network" || jumpingRef.current) return;
    const top = element.scrollTop;
    if (scrollAction === "return") {
      if (top > 72) setScrollAction(null);
      return;
    }
    setScrollAction(top > 180 ? "top" : null);
  }

  function jumpToSavedPosition(): void {
    const element = scrollRef.current;
    if (!element) return;
    const target = scrollAction === "top" ? 0 : returnScrollTopRef.current;
    if (scrollAction === "top") returnScrollTopRef.current = element.scrollTop;
    jumpingRef.current = true;
    element.scrollTo({ top: target, behavior: "auto" });
    if (scrollAction === "top") {
      setScrollAction("return");
    } else {
      setScrollAction(element.scrollTop > 180 ? "top" : null);
    }
    window.setTimeout(() => {
      jumpingRef.current = false;
    }, 0);
  }

  function toggleTagFromSearch(): void {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return;
    const matchedTag = tags.find((tag) => tag.toLocaleLowerCase() === keyword);
    if (!matchedTag) return;
    setActiveTag((current) =>
      current?.toLocaleLowerCase() === matchedTag.toLocaleLowerCase() ? null : matchedTag,
    );
    setSearch("");
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetch(onlineSearchUrl("", 1, false, [], 1), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const responseText = await response.text();
        if (active) {
          setChubRegionRestricted(isChubRegionRestriction(response.status, responseText));
          setChubAvailabilityChecked(true);
        }
      })
      .catch(() => {
        // 探测失败不等于地区限制，在线入口仍照常显示。
        if (active) setChubAvailabilityChecked(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const result = await readCardFile(file);
    if (!result.ok) {
      setError(t("shelf.importFail", { error: result.error }));
      return;
    }
    await addImportedCard(result.card);
    onCardsChanged?.();
  }

  async function chooseCardFile() {
    if (isAndroidApp()) {
      if (!hasNativeFilePicker()) {
        setError(t("native.filePickerUnavailable"));
        return;
      }
      try {
        await handleFile((await pickNativeFile("application/json,.json,image/png,.png")) ?? undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("shelf.importFail", { error: "文件读取失败" }));
      }
      return;
    }
    fileRef.current?.click();
  }

  /* 外层只负责定位，不滚动：公告抽屉挂在它上面，才不会跟着内容一起滚。
     里层才是真正滚动的那一屏。 */
  return (
    <div className="relative h-dvh">
      <div ref={scrollRef} onScroll={handleScroll} className="scrollbar-hidden h-dvh overflow-y-auto bg-background">
        {androidApp ? (
          <div className="shelf-device-status">
            <AndroidStatus enabled={androidApp} />
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
          <ScreenHead
            title={
              <span className="flex items-baseline gap-2 whitespace-nowrap">
                {shelfTab === "network" ? t("shelf.networkTitle") : t("shelf.title")}
                {shelfTab === "local" ? (
                  <span className="font-sans text-[13px] font-medium text-ink-2">
                    {t("shelf.count", { count: cards.length })}
                  </span>
                ) : null}
              </span>
            }
            before={
              onBack ? (
                <IconButton aria-label={t("shelf.back")} title={t("shelf.back")} onClick={onBack}>
                  <IconBack />
                </IconButton>
              ) : undefined
            }
            action={
              <div className="flex items-center gap-2">
                <PwaInstallButton />
                <IconButton
                  aria-label={t("card.translationTasks")}
                  title={t("card.translationTasks")}
                  className="relative"
                  onClick={() => setTranslationTray("open")}
                >
                  <Languages className="size-[18px]" aria-hidden="true" />
                  {hasLiveTranslations ? (
                    <span aria-hidden="true" className="absolute top-2 right-2 size-[7px] rounded-pill bg-accent" />
                  ) : null}
                </IconButton>
                <AnnouncementBell onClick={() => setAnnounceOpen(true)} />
                {onOpenSettings ? (
                  <IconButton aria-label={t("settings.title")} title={t("settings.title")} onClick={onOpenSettings}>
                    <IconGear />
                  </IconButton>
                ) : null}
              </div>
            }
          />

          {error ? (
            <div className="mb-4 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          ) : null}

          {chubRegionRestricted ? (
            <div className="mb-4 rounded-md bg-yellow-300 px-4 py-2.5 text-[13px] text-yellow-950">
              {t("shelf.chubRegionUnavailable")}
            </div>
          ) : null}

          <div className={`shelf-tabs-sticky${androidApp ? " shelf-tabs-sticky-android" : ""} isolate z-20 mb-5`}>
            <div className="flex gap-1 rounded-pill border border-line bg-surface p-1 shadow-raised">
              <button
                type="button"
                onClick={() => selectShelfTab("network")}
                className={`flex-1 rounded-pill px-4 py-2 text-[13px] transition-colors ${shelfTab === "network" ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-3"}`}
              >
                {t("shelf.tabNetwork")}
              </button>
              <button
                type="button"
                onClick={() => selectShelfTab("local")}
                className={`flex-1 rounded-pill px-4 py-2 text-[13px] transition-colors ${shelfTab === "local" ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-3"}`}
              >
                {t("shelf.tabLocal")}
              </button>
            </div>
          </div>

          {shelfTab === "network" && chubAvailabilityChecked && !chubRegionRestricted ? (
            <OnlineCards feed onAdded={onCardsChanged} localCards={cards} onSelectLocal={onSelect} />
          ) : null}

          {shelfTab === "local" && cards.length === 0 ? (
            <p className="m-0 mt-5 mb-5 text-[13.5px] leading-[1.75] text-ink-2">
              {t("shelf.empty")}
            </p>
          ) : null}

        {shelfTab === "local" && cards.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2.5">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  toggleTagFromSearch();
                }
              }}
              placeholder={t("shelf.searchPlaceholder")}
              aria-label={t("shelf.searchPlaceholder")}
              className="min-w-0 flex-1 rounded-pill border border-line bg-surface px-4 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
            <div className="scrollbar-hidden flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setActiveTag(null)}
                className={`shrink-0 rounded-pill border px-3 py-1.5 text-[12px] transition-colors ${
                  activeTag === null
                    ? "border-selected-line bg-selected text-selected-ink"
                    : "border-line bg-surface text-ink-2 hover:border-line-strong"
                }`}
              >
                {t("shelf.allTags")}
              </button>
              {visibleTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
                  className={`shrink-0 rounded-pill border px-3 py-1.5 text-[12px] transition-colors ${
                    activeTag === tag
                      ? "border-selected-line bg-selected text-selected-ink"
                      : "border-line bg-surface text-ink-2 hover:border-line-strong"
                  }`}
                >
                  {tag}
                </button>
              ))}
              {tags.length > visibleTags.length ? (
                <button
                  type="button"
                  onClick={() => setTagDialogOpen(true)}
                  className="shrink-0 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-2 hover:border-line-strong"
                >
                  {t("shelf.moreTags", { count: tags.length - visibleTags.length })}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {shelfTab === "local" && filteredCards.length === 0 && cards.length > 0 ? (
          <p className="mb-4 rounded-md border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
            {t("shelf.noMatch")}
          </p>
        ) : null}

        {shelfTab === "local" ? <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {filteredCards.map((entry) => {
            const playable = isPlayableCard(entry.card.data);
            return (
              <CharacterCard
                key={entry.id}
                portrait={<Avatar name={entry.card.data.name} src={cardPortraitUrl(entry.card.data)} />}
                name={entry.card.data.name}
                description={firstSentence(applyMacros(entry.card.data.description, { char: entry.card.data.name, user: userName, card: entry.card.data }))}
                tags={
                  <>
                    {entry.source === "imported" ? <Tag>{t("shelf.imported")}</Tag> : null}
                    {entry.card.data.tags?.slice(0, 3).map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </>
                }
                current={entry.id === currentCardId}
                currentLabel={t("common.current")}
                startLabel={t("common.start")}
                startAccessory={<CardTranslation card={entry.card} onCardsChanged={onCardsChanged} />}
                onStart={playable ? () => onSelect(entry.id) : undefined}
                onReturn={entry.id === currentCardId ? onBack : undefined}
                returnLabel={t("shelf.returnToChat", { name: entry.card.data.name })}
                actions={
                  <>
                    <IconButton
                      aria-label={t("shelf.exportCard", { name: entry.card.data.name })}
                      className="size-8 bg-surface-2/85 backdrop-blur-sm"
                      onClick={() => downloadCard(entry.card)}
                    >
                      <IconDownload className="size-4" />
                    </IconButton>
                    <IconButton
                      aria-label={t("shelf.exportPng", { name: entry.card.data.name })}
                      className="size-8 bg-surface-2/85 backdrop-blur-sm"
                      onClick={() => void downloadCardPng(entry.card)}
                    >
                      <IconImage className="size-4" />
                    </IconButton>
                    {entry.source === "imported" ? (
                      <IconButton
                        aria-label={t("card.editCard", { name: entry.card.data.name })}
                        className="size-8 bg-surface-2/85 backdrop-blur-sm"
                        onClick={() => onEdit?.(entry.id)}
                      >
                        <IconEdit className="size-4" />
                      </IconButton>
                    ) : null}
                    {entry.source === "imported" ? (
                      <IconButton
                        aria-label={t("shelf.deleteCard", { name: entry.card.data.name })}
                        className="size-8 bg-surface-2/85 text-danger backdrop-blur-sm hover:text-danger-hover"
                        onClick={() => void removeImportedCard(entry.id)}
                      >
                        <IconTrash className="size-4" />
                      </IconButton>
                    ) : null}
                  </>
                }
              />
            );
          })}

        </div> : null}

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,image/png,.png"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            // 清空，同一个文件连选两次也要能触发
            event.target.value = "";
          }}
        />

      </div>
      </div>

      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
      <CardTranslationTray onSaved={onCardsChanged} onOpenSettings={onOpenSettings} />
      <div className="fixed right-5 bottom-5 z-30 flex flex-col items-end gap-2 sm:right-8 sm:bottom-8">
        {shelfTab === "network" && scrollAction ? (
          <button
            type="button"
            aria-label={scrollAction === "top" ? t("shelf.scrollToTop") : t("shelf.returnToPosition")}
            title={scrollAction === "top" ? t("shelf.scrollToTop") : t("shelf.returnToPosition")}
            onClick={jumpToSavedPosition}
            className="grid size-12 place-items-center rounded-pill border border-line bg-surface text-ink shadow-pop transition-colors hover:border-line-strong"
          >
            {scrollAction === "top" ? <ArrowUp className="size-5" aria-hidden="true" /> : <Undo2 className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
        {quickMenuOpen ? (
          <div className="flex flex-col items-end gap-2 rounded-card border border-line bg-surface p-2 shadow-pop">
         <button type="button" onClick={() => { setQuickMenuOpen(false); void chooseCardFile(); }} className="flex items-center gap-2 rounded-pill px-3 py-2 text-[13px] text-ink hover:bg-surface-2">
              <Upload className="size-4" aria-hidden="true" />
              {t("card.import")}
            </button>
            {onCreate ? (
              <button type="button" onClick={() => { setQuickMenuOpen(false); onCreate(); }} className="flex items-center gap-2 rounded-pill px-3 py-2 text-[13px] text-ink hover:bg-surface-2">
                <PenLine className="size-4" aria-hidden="true" />
                {t("card.create")}
              </button>
            ) : null}
          </div>
        ) : null}
        <button type="button" aria-expanded={quickMenuOpen} aria-label={quickMenuOpen ? t("shelf.closeQuickMenu") : t("shelf.openQuickMenu")} onClick={() => setQuickMenuOpen((open) => !open)} className="grid size-14 place-items-center rounded-pill bg-accent text-accent-ink shadow-pop transition-transform hover:scale-105">
          <Plus className={`size-7 transition-transform duration-300 ease-out motion-reduce:transition-none ${quickMenuOpen ? "rotate-45" : "rotate-0"}`} aria-hidden="true" />
        </button>
      </div>
      <Dialog
        open={tagDialogOpen}
        onClose={() => setTagDialogOpen(false)}
        closeLabel={t("common.close")}
        title={t("shelf.chooseTag")}
        className="max-w-[440px]"
      >
        <div className="grid grid-cols-2 gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => {
                setActiveTag((current) => (current === tag ? null : tag));
                setTagDialogOpen(false);
              }}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-[12.5px] ${
                activeTag === tag
                  ? "border-selected-line bg-selected text-selected-ink"
                  : "border-line bg-surface-2 text-ink hover:border-line-strong"
              }`}
            >
              <span className="truncate">{tag}</span>
              <span className="ml-2 shrink-0 text-[11px] opacity-70">{tagCounts.get(tag.toLocaleLowerCase()) ?? 0}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
