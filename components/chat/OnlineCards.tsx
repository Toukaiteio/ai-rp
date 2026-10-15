"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { IconCheck, IconGlobe, IconSearch, IconX } from "@/components/icons";
import { Field, FieldAction, FieldInput, PillButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { parseCharacterCard } from "@/lib/cards";
import { ONLINE_SOURCE, type OnlineCardItem } from "@/lib/cards/online";
import {
  getUnfiltered,
  getUnfilteredServerSnapshot,
  setUnfiltered,
  subscribeUnfiltered,
} from "@/lib/cards/unfiltered";
import { useI18n } from "@/lib/i18n/use-i18n";
import { addImportedCard } from "@/lib/storage/cards";
import { Avatar } from "./Avatar";

/**
 * 在线角色卡。
 *
 * 默认收起，展开才去问卡源；本机留一份 5 小时的结果，反复开关不重复请求。
 * 内容全部来自第三方站点，界面必须把「不审核、不负责」写在明面上。
 */

const CLIENT_CACHE_KEY = "ai-rp:online-cards:v1";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 60 * 1000;
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

function cleanTag(raw: string): string {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
}

function listKey(text: string, tags: string[], includeAdult: boolean): string {
  return `${text}#${tags.join(",")}#${includeAdult ? "1" : "0"}#1`;
}

interface CardsPayload {
  source: { id: string; name: string; siteUrl: string };
  query: string;
  page: number;
  total: number;
  fetchedAt: number;
  items: OnlineCardItem[];
}

type Status = "idle" | "loading" | "ready" | "error";

interface CacheRecord {
  at: number;
  key: string;
  payload: CardsPayload;
}

function readCache(key: string): CardsPayload | null {
  try {
    const stored = window.localStorage.getItem(CLIENT_CACHE_KEY);
    if (!stored) return null;
    const record = JSON.parse(stored) as CacheRecord;
    if (record.key !== key || Date.now() - record.at > CLIENT_CACHE_TTL_MS) return null;
    return record.payload;
  } catch {
    return null;
  }
}

function writeCache(key: string, payload: CardsPayload): void {
  try {
    const record: CacheRecord = { at: Date.now(), key, payload };
    window.localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(record));
  } catch {
    // 存不下就每次展开都问一次服务端，服务端那边还有 5 小时缓存兜着
  }
}

/** 远端头像加载失败就退回按名字生成的首字母头像。 */
function RemoteAvatar({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Avatar name={name} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "size-[18px] transition-transform duration-200 motion-reduce:transition-none",
        open && "rotate-180",
      )}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function OnlineCards({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CardsPayload | null>(null);
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
  const loadedKeyRef = useRef<string | null>(null);
  const { t } = useI18n();

  async function load(nextQuery: string, nextTags: string[], adult: boolean, force: boolean) {
    const key = listKey(nextQuery, nextTags, adult);
    if (!force) {
      const cached = readCache(key);
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
    const params = new URLSearchParams({ q: nextQuery, page: "1" });
    if (nextTags.length > 0) params.set("tags", nextTags.join(","));
    if (adult) params.set("adult", "1");
    try {
      const response = await fetch(`/api/cards?${params.toString()}`);
      const body = (await response.json()) as CardsPayload & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? t("online.fetchFail"));
      }
      loadedKeyRef.current = key;
      writeCache(key, body);
      setPayload(body);
      setStatus("ready");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : t("online.fetchFail"));
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // 只在第一次展开、或者换过关键词时自动拉；其余时候本机缓存够用
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
      setAdding(null);
    }
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
    <section className="mt-7">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-line-strong"
      >
        <span className="grid size-[38px] shrink-0 place-items-center rounded-pill bg-surface-2 text-ink">
          <IconGlobe className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-ink">{t("online.title")}</span>
          <span className="block text-[12.5px] text-ink-2">{t("online.disclaimerShort")}</span>
        </span>
        <span className="shrink-0 text-ink-2">
          <Chevron open={open} />
        </span>
      </button>

      {open ? (
        <div className="mt-2.5 rounded-card border border-line bg-surface px-4 pb-4 pt-3.5">
          <p className="m-0 mb-3 text-[12.5px] leading-[1.7] text-ink-3">
            {t("online.disclaimer", { source: sourceName })}
          </p>

          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-2">{t("online.includeAdult")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={includeAdult}
              onClick={() => {
                const next = !includeAdult;
                setUnfiltered(next);
                void load(applied, tags, next, true);
              }}
              className={cn(
                "flex h-[22px] w-10 shrink-0 items-center justify-start rounded-pill p-0.5",
                "transition-colors duration-200 ease-out motion-reduce:transition-none",
                includeAdult ? "bg-accent" : "bg-surface-3",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-4 rounded-pill transition-transform duration-200 ease-out motion-reduce:transition-none",
                  includeAdult ? "bg-accent-ink" : "bg-ink",
                )}
                style={{ transform: includeAdult ? "translateX(20px)" : "translateX(0)" }}
              />
            </button>
          </div>

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
                        <RemoteAvatar src={item.avatarUrl} name={item.name} />
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
      ) : null}
    </section>
  );
}
