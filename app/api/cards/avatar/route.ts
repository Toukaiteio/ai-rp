import { avatarTarget } from "@/lib/cards/online";

/**
 * 角色卡头像的中转。
 *
 * 浏览器直连卡源的图片主机经常取不到（网络被挡、防盗链），
 * 列表来自服务端、头像却是浏览器直连，就会出现「列表有、头像全是首字母」。
 * 这里由服务端代取一次，浏览器只跟同源说话。
 *
 * 只放行卡源自己的图片主机，不接受任意 URL——否则这个接口就是开放代理。
 */

const UPSTREAM_TIMEOUT_MS = 15_000;
/** 头像都是 200×200 的小图，超过这个量级说明取错了东西 */
const MAX_BYTES = 4 * 1024 * 1024;

function fail(status: number, message: string): Response {
  return new Response(message, { status });
}

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const target = avatarTarget(raw);
  if (!target) {
    return fail(400, "bad url");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      headers: { "User-Agent": "ai-rp" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return fail(502, "upstream unreachable");
  }
  if (!response.ok || !response.body) {
    return fail(502, "upstream error");
  }

  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    return fail(502, "not an image");
  }

  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) {
    return fail(502, "image too large");
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": type,
      // 头像不会变，放长一点，顺带让 CDN 兜住
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
    },
  });
}
