/**
 * 在线角色卡列表。
 *
 * 代码里不放任何别人的卡，只放「怎么去问、怎么把答案收敛成界面要的那几项」。
 * 换卡源只改这一个文件：实现 normalize + 两个地址构造函数即可。
 */

export interface OnlineCardSource {
  id: string;
  name: string;
  /** 卡源站点，界面上给原文链接用 */
  siteUrl: string;
  /** 搜索接口 */
  searchUrl: string;
  /** 卡片文件（PNG 内嵌 JSON）允许出现的主机 */
  fileHosts: string[];
}

export const ONLINE_SOURCE: OnlineCardSource = {
  id: "chub",
  name: "Chub.ai",
  siteUrl: "https://www.chub.ai/",
  searchUrl: "https://api.chub.ai/search",
  fileHosts: ["avatars.charhub.io", "avatars.chub.ai"],
};

/** 列表里的一项。不含卡内容，只够画一行、够定位下载地址。 */
export interface OnlineCardItem {
  id: string;
  name: string;
  /** 作者/卡名，下载地址由它拼出来 */
  path: string;
  tagline: string;
  topics: string[];
  stars: number;
  avatarUrl: string;
  pageUrl: string;
}

/**
 * fullPath 直接进 URL，必须卡死形状。
 * 一段「作者/卡名」，卡源上两边都可能带大写，所以允许大小写；
 * 但不允许以点或连字符开头，也不允许出现第二个斜杠，../ 和绝对路径都进不来。
 */
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const MAX_TAGLINE = 120;
const MAX_TOPICS = 6;

/**
 * 卡源自带的内容分级标记。
 * 我们既不提倡也不禁止，所以不替卡源改写任何标签，只是不把这些标记词回显到界面上。
 * 卡照常列出、照常能玩，这里丢掉的只是一个词。
 */
const CONTENT_MARKERS = new Set(["nsfw", "sfw", "r18", "18+", "adult", "mature"]);

function text(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 只有 https 且主机在白名单里的地址才敢用，否则退回按 path 拼的固定地址。 */
function safeFileUrl(candidate: unknown, path: string): string {
  if (typeof candidate === "string") {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && ONLINE_SOURCE.fileHosts.includes(url.hostname)) {
        return url.toString();
      }
    } catch {
      // 不是合法地址就当没给
    }
  }
  return `https://avatars.charhub.io/avatars/${path}/chara_card_v2.png`;
}

/**
 * 卡源节点 → 列表项。字段缺失就填默认值，
 * 一项不合规返回 null，由调用方跳过，不让脏数据整条列表挂掉。
 */
export function normalizeOnlineCard(node: unknown): OnlineCardItem | null {
  if (!isRecord(node)) return null;
  const name = text(node.name, 60);
  const path = text(node.fullPath, 200);
  if (!name || !PATH_PATTERN.test(path)) return null;
  if (node.is_public === false || node.is_unlisted === true) return null;

  const topics = Array.isArray(node.topics)
    ? node.topics
        .filter((topic): topic is string => typeof topic === "string")
        .filter((topic) => !CONTENT_MARKERS.has(topic.trim().toLowerCase()))
        .slice(0, MAX_TOPICS)
    : [];

  return {
    id: String(node.id ?? path),
    name,
    path,
    tagline: text(node.tagline, MAX_TAGLINE),
    topics,
    stars: typeof node.starCount === "number" && node.starCount > 0 ? Math.floor(node.starCount) : 0,
    avatarUrl: safeFileUrl(node.avatar_url, path),
    pageUrl: `${ONLINE_SOURCE.siteUrl}characters/${path}`,
  };
}

/** 下载地址。path 不合规时返回 null，路由据此回 400。 */
export function onlineCardPngUrl(path: string): string | null {
  const trimmed = path.trim();
  if (!PATH_PATTERN.test(trimmed)) return null;
  return `https://avatars.charhub.io/avatars/${trimmed}/chara_card_v2.png`;
}

/** 原文页面地址，界面上「查看出处」用。 */
export function onlineCardPageUrl(path: string): string | null {
  const trimmed = path.trim();
  if (!PATH_PATTERN.test(trimmed)) return null;
  return `${ONLINE_SOURCE.siteUrl}characters/${trimmed}`;
}
