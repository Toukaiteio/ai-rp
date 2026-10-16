"use client";

import { useEffect, useRef, useState } from "react";
import {
  CharacterCard,
  IconButton,
  ImportCard,
  ScreenHead,
  Tag,
} from "@/components/ui";
import { IconBack, IconDownload, IconTrash } from "@/components/icons";
import {
  downloadCard,
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
}: {
  cards: CardEntry[];
  currentCardId: string;
  onSelect: (cardId: string) => void;
  onBack?: () => void;
  /** 新卡到位。用来把「本来没有卡、被迫留在角色架」的状态续上 */
  onCardsChanged?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [chubRegionRestricted, setChubRegionRestricted] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetch(onlineSearchUrl("", 1, false, [], 1), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const responseText = await response.text();
        if (active && isChubRegionRestriction(response.status, responseText)) {
          setChubRegionRestricted(true);
        }
      })
      .catch(() => {
        // 探测失败不等于地区限制，在线入口仍照常显示。
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
        <div className="mx-auto max-w-[980px] px-6 py-8">
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
            action={<AnnouncementBell onClick={() => setAnnounceOpen(true)} />}
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

        {error ? (
          <div className="mb-4 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((entry) => {
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

          <ImportCard label={t("card.import")} onClick={() => fileRef.current?.click()} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            // 清空，同一个文件连选两次也要能触发
            event.target.value = "";
          }}
        />

        {!chubRegionRestricted ? <OnlineCards onAdded={onCardsChanged} /> : null}
      </div>
      </div>

      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
    </div>
  );
}
