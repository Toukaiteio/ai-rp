"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CharacterCard,
  IconButton,
  ImportCard,
  ScreenHead,
  Tag,
} from "@/components/ui";
import { CreateCard } from "@/components/ui/CharacterCard";
import { IconBack, IconDownload, IconEdit, IconImage, IconTrash } from "@/components/icons";
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
import { OnlineCards } from "./OnlineCards";
import { Avatar } from "./Avatar";
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";

/** 简介只在悬停面板里出现，留得下一段完整的设定开头。 */
function firstSentence(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").replace(/【[^】]*】/g, "").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit)}…`;
}

export function ShelfScreen({
  cards,
  currentCardId,
  onSelect,
  onBack,
  onCardsChanged,
  onCreate,
  onEdit,
}: {
  cards: CardEntry[];
  currentCardId: string;
  onSelect: (cardId: string) => void;
  onBack?: () => void;
  /** 新卡到位。用来把「本来没有卡、被迫留在角色架」的状态续上 */
  onCardsChanged?: () => void;
  onCreate?: () => void;
  onEdit?: (cardId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [chubRegionRestricted, setChubRegionRestricted] = useState(false);
  const [chubAvailabilityChecked, setChubAvailabilityChecked] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const { t } = useI18n();

  const tags = useMemo(
    () => Array.from(new Set(cards.flatMap((entry) => entry.card.data.tags ?? []))).sort(),
    [cards],
  );
  const filteredCards = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return cards.filter((entry) => {
      const data = entry.card.data;
      const matchesSearch =
        !keyword ||
        [data.name, data.description, ...(data.tags ?? [])].some((value) =>
          value.toLocaleLowerCase().includes(keyword),
        );
      const matchesTag = !activeTag || data.tags?.includes(activeTag);
      return matchesSearch && matchesTag;
    });
  }, [activeTag, cards, search]);

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

  /* 外层只负责定位，不滚动：公告抽屉挂在它上面，才不会跟着内容一起滚。
     里层才是真正滚动的那一屏。 */
  return (
    <div className="relative h-dvh">
      <div className="h-dvh overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
          <ScreenHead
            title={
              <span className="flex items-baseline gap-2">
                {t("shelf.title")}
                <span className="font-sans text-[13px] font-medium text-ink-2">
                  {t("shelf.count", { count: cards.length })}
                </span>
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
                <AnnouncementBell onClick={() => setAnnounceOpen(true)} />
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

          {cards.length === 0 ? (
            <p className="m-0 mb-5 text-[13.5px] leading-[1.75] text-ink-2">
              {t("shelf.empty")}
            </p>
          ) : null}

        {cards.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2.5 sm:flex-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("shelf.searchPlaceholder")}
              aria-label={t("shelf.searchPlaceholder")}
              className="min-w-0 flex-1 rounded-pill border border-line bg-surface px-4 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
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
              {tags.map((tag) => (
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
            </div>
          </div>
        ) : null}

        {filteredCards.length === 0 && cards.length > 0 ? (
          <p className="mb-4 rounded-md border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
            {t("shelf.noMatch")}
          </p>
        ) : null}

        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCards.map((entry) => {
            const playable = isPlayableCard(entry.card.data);
            return (
              <CharacterCard
                key={entry.id}
                portrait={<Avatar name={entry.card.data.name} src={cardPortraitUrl(entry.card.data)} />}
                name={entry.card.data.name}
                description={firstSentence(entry.card.data.description)}
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

        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 lg:grid-cols-3 xl:grid-cols-4">
          <ImportCard label={t("card.import")} onClick={() => fileRef.current?.click()} />
          {onCreate ? <CreateCard label={t("card.create")} onClick={onCreate} /> : null}
        </div>

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

        {chubAvailabilityChecked && !chubRegionRestricted ? (
          <OnlineCards onAdded={onCardsChanged} />
        ) : null}
      </div>
      </div>

      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
    </div>
  );
}
