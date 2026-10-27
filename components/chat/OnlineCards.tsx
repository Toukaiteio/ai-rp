"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconCheck, IconGlobe, IconSearch, IconX } from "@/components/icons";
import { CharacterCard, Dialog, Field, FieldAction, FieldInput, PillButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { parseCharacterCard } from "@/lib/cards";
import {
  normalizeOnlineSearchResponse,
  onlineSearchUrl,
  ONLINE_SOURCE,
  ONLINE_PAGE_SIZE,
  type OnlineCardsPayload,
  type OnlineCardItem,
} from "@/lib/cards/online";
import {
  getUnfiltered,
  getUnfilteredServerSnapshot,
  subscribeUnfiltered,
} from "@/lib/cards/unfiltered";
import { useI18n } from "@/lib/i18n/use-i18n";
import { addImportedCard } from "@/lib/storage/cards";
import { Avatar } from "./Avatar";
import { resolveOnlineCardStartAction } from "./online-card-action";

/**
 * 在线角色卡。
 *
 * 默认收起，展开才去问卡源；本机留一份 5 小时的结果，反复开关不重复请求。
 * 内容全部来自第三方站点，界面必须把「不审核、不负责」写在明面上。
 */

const CLIENT_CACHE_KEY = "ai-rp:online-cards:v1";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 60 * 1000;
/**
 * 网络 tab 的信息流单独一份缓存。
 *
 * 切到本地再切回来，组件会重新挂载，没有这份缓存就每次都过一遍卡源。
 * TTL 比搜索列表短：信息流的第一屏看得多，两小时后该看到新卡了。
 */
const FEED_CACHE_KEY = "ai-rp:online-cards-feed:v1";
const FEED_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TAGS = 8;

/** 聚焦搜索框时先给这些常见标签。分级词不放进来。 */
const HIDDEN_TOPICS = new Set(["nsfw", "sfw", "r18", "18+", "adult", "mature"]);

const TAG_SUGGESTIONS = [
  "Fantasy",
  "RPG",
  "Adventure",
  "Romance",
  "Anime",
  "OC",
  "Scenario",
  "Isekai",
  "Slice of Life",
  "Female",
  "Male",
  "Human",
  "Roleplay",
];

const onlineCardAddsInFlight = new Set<string>();

function cleanTag(raw: string): string {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
}

function listKey(text: string, tags: string[], includeAdult: boolean): string {
  return `${text}#${tags.join(",")}#${includeAdult ? "1" : "0"}#1`;
}

type Status = "idle" | "loading" | "ready" | "error";

interface CacheRecord {
  at: number;
  key: string;
  payload: OnlineCardsPayload;
}

function readCache(key: string, storageKey: string, ttlMs: number): OnlineCardsPayload | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const record = JSON.parse(stored) as CacheRecord;
    if (record.key !== key || Date.now() - record.at > ttlMs) return null;
    return record.payload;
  } catch {
    return null;
  }
}

function writeCache(key: string, payload: OnlineCardsPayload, storageKey: string): void {
  try {
    const record: CacheRecord = { at: Date.now(), key, payload };
    window.localStorage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // 存不下就每次展开都重新从浏览器请求卡源
  }
}

export function OnlineCards({ onAdded, compact = false, feed = false, localCards, onSelectLocal }: { onAdded?: () => void; compact?: boolean; feed?: boolean; localCards?: Array<{ id: string; card: { data: { name: string } } }>; onSelectLocal?: (cardId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OnlineCardsPayload | null>(null);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  /* 开关落在本机，刷新和下次打开都还在 */
  const includeAdult = useSyncExternalStore(
    subscribeUnfiltered,
    getUnfiltered,
    getUnfilteredServerSnapshot,
  );
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<OnlineCardItem[]>([]);
  const [feedQuery, setFeedQuery] = useState("");
  const [feedApplied, setFeedApplied] = useState("");
  const [feedPage, setFeedPage] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const feedLoadingRef = useRef(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!feed) return;
    const cacheKey = `feed#${feedApplied}#${includeAdult ? "1" : "0"}#1`;
    // 两小时内切回网络 tab：直接用缓存的第一屏，不过卡源
    const cached = readCache(cacheKey, FEED_CACHE_KEY, FEED_CACHE_TTL_MS);
    const controller = new AbortController();
    let active = true;
    feedLoadingRef.current = true;
    void (cached
      ? Promise.resolve(cached)
      : fetch(onlineSearchUrl(feedApplied, 1, includeAdult, []), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`${t("online.fetchFail")}（HTTP ${response.status}）`);
          return normalizeOnlineSearchResponse(await response.json(), feedApplied, 1);
        }))
      .then((payload) => {
        if (!active) return;
        if (!cached) writeCache(cacheKey, payload, FEED_CACHE_KEY);
        setFeedItems(payload.items);
        setFeedPage(1);
        setFeedHasMore(payload.items.length > 0 && payload.items.length < payload.total);
      })
      .catch(() => {
        if (active) setFeedHasMore(false);
      })
      .finally(() => {
        feedLoadingRef.current = false;
        if (active) setFeedLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [feed, feedApplied, includeAdult, t]);

  useEffect(() => {
    if (!feed || !feedEndRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && feedHasMore && !feedLoading && !feedLoadingRef.current) {
          const nextPage = feedPage + 1;
          feedLoadingRef.current = true;
          setFeedLoading(true);
          void fetch(onlineSearchUrl(feedApplied, nextPage, includeAdult, []))
            .then(async (response) => {
              if (!response.ok) return null;
              return normalizeOnlineSearchResponse(await response.json(), feedApplied, nextPage);
            })
            .then((nextPayload) => {
              if (!nextPayload) {
                setFeedHasMore(false);
                return;
              }
              setFeedItems((current) => {
                const seen = new Set(current.map((item) => item.id));
                return [...current, ...nextPayload.items.filter((item) => !seen.has(item.id))];
              });
              setFeedPage(nextPage);
              setFeedHasMore(nextPayload.items.length > 0 && nextPage * ONLINE_PAGE_SIZE < nextPayload.total);
            })
            .catch(() => setFeedHasMore(false))
            .finally(() => {
              feedLoadingRef.current = false;
              setFeedLoading(false);
            });
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(feedEndRef.current);
    return () => observer.disconnect();
  }, [feed, feedApplied, feedHasMore, feedLoading, feedPage, includeAdult]);

  async function load(nextQuery: string, nextTags: string[], adult: boolean, force: boolean) {
    const key = listKey(nextQuery, nextTags, adult);
    if (!force) {
      const cached = readCache(key, CLIENT_CACHE_KEY, CLIENT_CACHE_TTL_MS);
      if (cached) {
        loadedKeyRef.current = key;
        setPayload(cached);
        setStatus("ready");
        setError(null);
        return;
      }
    }

    setStatus("loading");
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch(onlineSearchUrl(nextQuery, 1, adult, nextTags));
      } catch {
        throw new Error(`${t("online.fetchFail")}：网络连接失败`);
      }
      if (!response.ok) {
        throw new Error(`${t("online.fetchFail")}（HTTP ${response.status}）`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(`${t("online.fetchFail")}：卡源返回格式异常`);
      }
      let nextPayload: OnlineCardsPayload;
      try {
        nextPayload = normalizeOnlineSearchResponse(body, nextQuery, 1);
      } catch {
        throw new Error(`${t("online.fetchFail")}：卡源返回格式异常`);
      }
      loadedKeyRef.current = key;
      writeCache(key, nextPayload, CLIENT_CACHE_KEY);
      setPayload(nextPayload);
      setStatus("ready");
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : `${t("online.fetchFail")}：网络连接失败`,
      );
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // 只在第一次打开、或者换过关键词时自动拉；其余时候本机缓存够用
    if (next && loadedKeyRef.current !== listKey(applied, tags, includeAdult)) {
      void load(applied, tags, includeAdult, false);
    }
  }

  function search(text: string, nextTags = tags) {
    const next = text.trim();
    setApplied(next);
    setSuggestOpen(false);
    void load(next, nextTags, includeAdult, true);
  }

  function addTag(raw: string) {
    const tag = cleanTag(raw);
    if (!tag) return;
    const exists = tags.some((item) => item.toLowerCase() === tag.toLowerCase());
    const nextTags = exists ? tags : [...tags, tag].slice(0, MAX_TAGS);
    setTags(nextTags);
    setQuery("");
    setSuggestOpen(false);
    void load(applied, nextTags, includeAdult, true);
  }

  function removeTag(tag: string) {
    const nextTags = tags.filter((item) => item !== tag);
    setTags(nextTags);
    void load(applied, nextTags, includeAdult, true);
  }

  async function add(item: OnlineCardItem) {
    if (onlineCardAddsInFlight.has(item.path)) return;
    onlineCardAddsInFlight.add(item.path);
    setAdding(item.path);
    setError(null);
    try {
      const response = await fetch(
        `/api/cards/card?path=${encodeURIComponent(item.path)}`,
      );
      const body = (await response.json()) as { card?: unknown; error?: { message?: string } };
      if (!response.ok || body.card === undefined) {
        throw new Error(body.error?.message ?? t("online.downloadFail"));
      }
      const parsed = parseCharacterCard(body.card);
      if (!parsed.ok) throw new Error(parsed.error);
      await addImportedCard(parsed.card);
      setAdded(item.path);
      onAdded?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("online.addFail"));
    } finally {
      onlineCardAddsInFlight.delete(item.path);
      setAdding(null);
    }
  }

  if (feed) {
    return (
      <section className="mt-1">
        <form
          className="mb-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            feedLoadingRef.current = true;
            setFeedItems([]);
            setFeedPage(0);
            setFeedHasMore(true);
            setFeedApplied(feedQuery.trim());
          }}
        >
          <Field className="min-w-0 flex-1">
            <FieldInput
              value={feedQuery}
              onChange={(event) => setFeedQuery(event.target.value)}
              placeholder={t("online.searchPlaceholder")}
              aria-label={t("online.searchPlaceholder")}
              maxLength={40}
            />
            <FieldAction type="submit" aria-label={t("online.search")}>
              <IconSearch className="size-4" />
            </FieldAction>
          </Field>
        </form>
        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {feedItems.map((item) => {
            const local = localCards?.find((entry) => entry.card.data.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase());
            const busy = adding === item.path;
            const done = Boolean(local) || added === item.path;
            return (
              <CharacterCard
                key={item.id}
                portrait={<Avatar name={item.name} src={item.avatarUrl} />}
                name={item.name}
                description={item.tagline || item.topics.join(" · ")}
                tags={item.topics.slice(0, 3).map((topic) => <span key={topic}>{topic}</span>)}
                startLabel={done ? (local ? t("online.downloaded") : t("online.added")) : busy ? t("online.downloading") : t("online.add")}
                startDisabled={busy}
                onStart={resolveOnlineCardStartAction({
                  localId: local?.id,
                  done,
                  onSelectLocal,
                  onAdd: () => void add(item),
                })}
                current={false}
                currentLabel={t("online.added")}
                onCardClick={local && onSelectLocal ? () => onSelectLocal(local.id) : undefined}
                cardClickLabel={t("online.openDownloaded")}
              />
            );
          })}
        </div>
        <div ref={feedEndRef} className="min-h-12 py-4 text-center text-[12px] text-ink-3" aria-live="polite">
          {feedLoading ? t("online.loading") : feedHasMore ? "" : t("online.empty")}
        </div>
      </section>
    );
  }

  const items = payload?.items ?? [];
  const sourceName = payload?.source.name ?? ONLINE_SOURCE.name;
  const selected = new Set(tags.map((tag) => tag.toLowerCase()));
  const typed = query.trim().toLowerCase();
  const suggestions: string[] = [];
  const seenSuggestions = new Set<string>();
  for (const tag of [...TAG_SUGGESTIONS, ...items.flatMap((item) => item.topics)]) {
    const key = tag.trim().toLowerCase();
    if (!key || seenSuggestions.has(key) || selected.has(key) || HIDDEN_TOPICS.has(key)) continue;
    if (typed && !key.includes(typed)) continue;
    seenSuggestions.add(key);
    suggestions.push(tag.trim());
    if (suggestions.length >= 8) break;
  }
  const typedTag = cleanTag(query);
  const canAddTyped =
    typedTag.length > 0 &&
    !selected.has(typedTag.toLowerCase()) &&
    !suggestions.some((tag) => tag.toLowerCase() === typedTag.toLowerCase());

  return (
    <section className={compact ? "contents" : "mt-7"}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={toggle}
        className={cn(
          "w-full rounded-card border border-line bg-surface transition-colors hover:border-line-strong",
          compact
            ? "card-tile flex flex-col items-center justify-center gap-2 p-3 text-center text-[13px] text-ink md:gap-3 md:p-5 md:text-[14.5px]"
            : "flex items-center gap-3 px-4 py-3.5 text-left",
        )}
      >
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-pill bg-surface-2 text-ink",
            compact ? "size-9 md:size-[52px]" : "size-[38px]",
          )}
        >
          <IconGlobe className={compact ? "size-[18px] md:size-[26px]" : "size-[18px]"} />
        </span>
        {compact ? (
          <>
            <span className="block text-[13px] md:text-[14.5px]">{t("online.importCard")}</span>
            <span className="block text-[11.5px] text-ink-3">{t("online.disclaimerShort")}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-ink">{t("online.title")}</span>
            <span className="block text-[12.5px] text-ink-2">{t("online.disclaimerShort")}</span>
          </span>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("online.title")}
        className="max-w-[680px]"
      >
        <div className="pb-1">
          <p className="m-0 mb-3 text-[12.5px] leading-[1.7] text-ink-3">
            {t("online.disclaimer", { source: sourceName })}
          </p>

          {tags.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-label={t("online.removeTag", { tag })}
                  onClick={() => removeTag(tag)}
                  className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface-2 py-1 pr-1.5 pl-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong"
                >
                  {tag}
                  <IconX className="size-3 text-ink-2" />
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="relative mb-3"
            onSubmit={(event) => {
              event.preventDefault();
              search(query);
            }}
          >
            <Field>
              <FieldInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => setSuggestOpen(false)}
                placeholder={t("online.searchPlaceholder")}
                maxLength={40}
              />
              <FieldAction type="submit" aria-label={t("online.search")}>
                <IconSearch className="size-4" />
              </FieldAction>
            </Field>
            {suggestOpen && (suggestions.length > 0 || canAddTyped) ? (
              <ul className="absolute inset-x-0 top-full z-10 m-0 mt-1 list-none overflow-hidden rounded-md border border-line bg-surface p-1 shadow-pop">
                {canAddTyped ? (
                  <li>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTag(typedTag)}
                      className="w-full rounded-sm px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-2"
                    >
                      {t("online.addTag", { tag: typedTag })}
                    </button>
                  </li>
                ) : null}
                {suggestions.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTag(tag)}
                      className="w-full rounded-sm px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-2"
                    >
                      {tag}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>

          {status === "loading" ? (
            <p className="m-0 py-6 text-center text-[13px] text-ink-2">{t("online.loading")}</p>
          ) : null}

          {status === "error" ? (
            <div className="flex flex-col items-start gap-2.5 py-2">
              <p className="m-0 text-[13px] text-danger">{error}</p>
              <PillButton size="sm" onClick={() => void load(applied, tags, includeAdult, true)}>
                {t("common.retry")}
              </PillButton>
            </div>
          ) : null}

          {status === "ready" && items.length === 0 ? (
            <p className="m-0 py-6 text-center text-[13px] text-ink-2">
              {t("online.empty")}
            </p>
          ) : null}

          {items.length > 0 ? (
            <>
              <p className="m-0 mb-2 text-[11.5px] text-ink-3">
                {t("online.total", { total: payload?.total ?? items.length, shown: items.length })}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((item) => {
                  const busy = adding === item.path;
                  const done = added === item.path;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5"
                    >
                      <span className="size-11 shrink-0 overflow-hidden rounded-md bg-surface-3">
                        <Avatar name={item.name} src={item.avatarUrl} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-bold text-ink">
                          {item.name}
                        </span>
                        <span className="block truncate text-[12.5px] text-ink-2">
                          {item.tagline || item.path}
                        </span>
                        {item.topics.length > 0 ? (
                          <span className="mt-1 block truncate text-[11.5px] text-ink-3">
                            {item.topics.join(" · ")}
                            {item.stars > 0 ? ` · ${t("online.stars", { count: item.stars })}` : ""}
                          </span>
                        ) : null}
                      </span>
                      <PillButton
                        size="sm"
                        variant={done ? "ghost" : "primary"}
                        disabled={busy || done}
                        onClick={() => void add(item)}
                        className="shrink-0"
                      >
                        {done ? (
                          <>
                            <IconCheck className="size-3.5" />
                            {t("online.added")}
                          </>
                        ) : busy ? (
                          t("online.downloading")
                        ) : (
                          t("online.add")
                        )}
                      </PillButton>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
