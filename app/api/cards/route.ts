import {
  ONLINE_SOURCE,
  normalizeOnlineCard,
  type OnlineCardItem,
} from "@/lib/cards/online";

/**
 * 在线角色卡列表。
 *
 * 代码里不放别人的卡：这里只负责去卡源问一页热门，把答案收敛成界面要的几项。
 * 缓存 5 小时，服务端函数实例活着就一直复用，玩家反复开关这个列表不会反复打上游。
 */

/** 缓存时长：5 小时 */
const CACHE_TTL_MS = 5 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 9_000;
const PAGE_SIZE = 24;
const MAX_PAGE = 20;
/** 缓存条目上限，避免长跑实例把内存吃满 */
const MAX_CACHE_ENTRIES = 40;

/** Chub 的 Cloudflare 规则会拒绝非浏览器 User-Agent（比如默认的 ai-rp）。 */
const UPSTREAM_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://chub.ai/",
  Origin: "https://chub.ai",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};

interface CardsPayload {
  source: { id: string; name: string; siteUrl: string };
  query: string;
  page: number;
  total: number;
  fetchedAt: number;
  items: OnlineCardItem[];
}

const cache = new Map<string, { at: number; payload: CardsPayload }>();

function readPage(raw: string | null): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, MAX_PAGE);
}

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { status, code, message } }, { status });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const page = readPage(url.searchParams.get("page"));
  const includeAdult = url.searchParams.get("adult") === "1";
  const tags = (url.searchParams.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim().slice(0, 24))
    .filter((tag) => tag.length > 0)
    .slice(0, 8);
  const key = `${query}#${tags.join(",")}#${includeAdult ? "1" : "0"}#${page}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Response.json(hit.payload, { headers: { "X-Cache": "hit" } });
  }

  const upstream = new URL(ONLINE_SOURCE.searchUrl);
  upstream.searchParams.set("namespace", "characters");
  upstream.searchParams.set("first", String(PAGE_SIZE));
  upstream.searchParams.set("page", String(page));
  upstream.searchParams.set("nsfw", includeAdult ? "true" : "false");
  if (query) upstream.searchParams.set("search", query);
  for (const tag of tags) upstream.searchParams.append("tags", tag);

  let payload: CardsPayload;
  try {
    const response = await fetch(upstream, {
      headers: UPSTREAM_HEADERS,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      return fail(502, "upstream_error", `卡源无响应（HTTP ${response.status}），请稍后重试`);
    }
    const body = (await response.json()) as { data?: { nodes?: unknown[]; count?: unknown } };
    const nodes = Array.isArray(body?.data?.nodes) ? body.data.nodes : [];
    const items = nodes
      .map(normalizeOnlineCard)
      .filter((item): item is OnlineCardItem => item !== null);

    payload = {
      source: {
        id: ONLINE_SOURCE.id,
        name: ONLINE_SOURCE.name,
        siteUrl: ONLINE_SOURCE.siteUrl,
      },
      query,
      page,
      total: typeof body?.data?.count === "number" ? body.data.count : items.length,
      fetchedAt: Date.now(),
      items,
    };
  } catch {
    return fail(502, "upstream_unreachable", "无法连接卡源，请检查网络后重试");
  }

  cache.set(key, { at: Date.now(), payload });
  const oldest = cache.keys().next();
  if (cache.size > MAX_CACHE_ENTRIES && !oldest.done) cache.delete(oldest.value);

  return Response.json(payload, { headers: { "X-Cache": "miss" } });
}
