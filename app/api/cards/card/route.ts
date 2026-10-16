import { extractCardJson } from "@/lib/cards/png";
import { onlineCardPngUrl } from "@/lib/cards/online";

/**
 * 下载一张在线角色卡。
 *
 * 只接受 path（作者/卡名），下载地址由它拼出来并卡死主机，
 * 不接受调用方传任意 URL——否则这个接口就成了开放代理。
 * 返回的是从 PNG 里拆出来的卡 JSON，之后走和本地导入同一条校验。
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
/** 卡片 PNG 上限，挡住异常大的文件把函数内存吃满 */
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 30;

/** Chub 的 Cloudflare 规则会拒绝非浏览器 User-Agent（比如默认的 ai-rp）。 */
const UPSTREAM_HEADERS = {
  Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
  Referer: "https://chub.ai/",
  Origin: "https://chub.ai",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};

const cache = new Map<string, { at: number; card: unknown }>();

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { status, code, message } }, { status });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pngUrl = onlineCardPngUrl(url.searchParams.get("path") ?? "");
  if (!pngUrl) {
    return fail(400, "bad_path", "角色卡地址不合法");
  }

  const hit = cache.get(pngUrl);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Response.json({ card: hit.card }, { headers: { "X-Cache": "hit" } });
  }

  let bytes: Uint8Array;
  try {
    const response = await fetch(pngUrl, {
      headers: UPSTREAM_HEADERS,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      return fail(502, "upstream_error", `角色卡下载失败（HTTP ${response.status}）`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PNG_BYTES) {
      return fail(502, "too_large", "角色卡体积超出限制");
    }
    bytes = new Uint8Array(buffer);
  } catch {
    return fail(502, "upstream_unreachable", "无法下载角色卡，请检查网络后重试");
  }

  const card = extractCardJson(bytes);
  if (card === null) {
    return fail(422, "no_card_data", "文件中未包含角色卡数据");
  }

  cache.set(pngUrl, { at: Date.now(), card });
  const oldest = cache.keys().next();
  if (cache.size > MAX_CACHE_ENTRIES && !oldest.done) cache.delete(oldest.value);

  return Response.json({ card }, { headers: { "X-Cache": "miss" } });
}
