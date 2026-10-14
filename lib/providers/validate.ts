import { findProvider } from "./config";

export type BaseURLResult = { baseURL: string } | { error: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * 挡掉本机与内网地址。
 *
 * 为什么需要：自定义 Base URL 是浏览器传上来的，服务端会照着它发请求。
 * 不校验的话，任何人都能拿这个接口当跳板去探测 Vercel 函数所在网络里的内部服务（SSRF）。
 * 这里按主机名做黑名单，够挡住常见目标；真要更严就得解析 DNS 再比对 IP，
 * 但那样每次请求都要多一次解析，对 BYOK 场景不划算。
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // 链路本地，云元数据常见地址
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // 组播与保留段
  }

  // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  return false;
}

/**
 * 定出这次请求该用哪个 Base URL。
 * 请求里带了就用请求的（支持自定义），否则用 providers.json 里预设的。
 */
export function resolveBaseURL(
  providerId: string,
  requested?: string,
): BaseURLResult {
  const preset = findProvider(providerId);
  const candidate = requested?.trim() || preset?.baseURL?.trim() || "";

  if (!candidate) {
    return { error: "这个提供商需要填 Base URL" };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: "Base URL 不是合法地址" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "Base URL 只支持 http 或 https" };
  }

  if (isBlockedHost(url.hostname)) {
    return { error: "Base URL 不能指向本机或内网地址" };
  }

  // 去掉结尾斜杠，SDK 拼接 /chat/completions 时不会出现双斜杠
  return { baseURL: candidate.replace(/\/+$/, "") };
}

/** http 会把 Key 明文发出去，界面上要给出提醒。 */
export function isInsecureBaseURL(baseURL: string): boolean {
  return baseURL.trim().toLowerCase().startsWith("http://");
}
