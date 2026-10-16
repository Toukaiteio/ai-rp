import { describe, expect, it } from "vitest";
import {
  ONLINE_SOURCE,
  avatarProxyUrl,
  avatarTarget,
  cardPortraitUrl,
  normalizeOnlineCard,
  normalizeOnlineSearchResponse,
  isChubRegionRestriction,
  onlineCardPageUrl,
  onlineCardPngUrl,
  onlineSearchUrl,
} from "./online";
import type { CharacterCardData } from "./types";

const NODE = {
  id: 109444,
  name: "Adventure Awaits",
  fullPath: "ratlover/adventure-awaits",
  tagline: "Play out an exciting adventure.",
  topics: ["Fantasy", "RPG"],
  starCount: 2836,
  avatar_url: "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/avatar.webp",
  is_public: true,
};

describe("在线卡源归一化", () => {
  it("只把带明确地区限制文案的 403 识别为 Chub 地区不可用", () => {
    expect(isChubRegionRestriction(403, "This service is not available in your country.")).toBe(
      true,
    );
    expect(isChubRegionRestriction(403, "This service is not available in your region.")).toBe(
      true,
    );
    expect(isChubRegionRestriction(403, "Forbidden")).toBe(false);
    expect(isChubRegionRestriction(200, "not available in your country")).toBe(false);
    expect(isChubRegionRestriction(500, "not available in your region")).toBe(false);
  });

  it("搜索 URL 固定指向 Chub 并保留搜索参数", () => {
    const url = new URL(onlineSearchUrl("魔法", 2, true, ["Fantasy", "RPG"]));
    expect(url.origin + url.pathname).toBe("https://api.chub.ai/search");
    expect(url.searchParams.get("namespace")).toBe("characters");
    expect(url.searchParams.get("first")).toBe("24");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("nsfw")).toBe("true");
    expect(url.searchParams.get("search")).toBe("魔法");
    expect(url.searchParams.getAll("tags")).toEqual(["Fantasy", "RPG"]);
    expect(new URL(onlineSearchUrl("", 1, false, [], 1)).searchParams.get("first")).toBe("1");
  });

  it("搜索响应先用 normalizeOnlineCard 清洗节点", () => {
    const payload = normalizeOnlineSearchResponse(
      { data: { count: 2, nodes: [NODE, { ...NODE, fullPath: "../越权" }] } },
      "",
      1,
    );
    expect(payload.total).toBe(2);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.path).toBe(NODE.fullPath);
  });

  it("搜索响应缺少节点数组时报告格式异常", () => {
    expect(() => normalizeOnlineSearchResponse({ data: {} }, "", 1)).toThrow(
      "invalid_search_response",
    );
  });

  it("节点收敛成列表项", () => {
    const item = normalizeOnlineCard(NODE);
    expect(item).not.toBeNull();
    expect(item?.name).toBe("Adventure Awaits");
    expect(item?.path).toBe("ratlover/adventure-awaits");
    expect(item?.stars).toBe(2836);
    expect(item?.topics).toEqual(["Fantasy", "RPG"]);
    expect(item?.pageUrl).toBe(
      `${ONLINE_SOURCE.siteUrl}characters/ratlover/adventure-awaits`,
    );
  });

  it("卡源的内容分级标记不回显，其余标签照常显示", () => {
    const item = normalizeOnlineCard({
      ...NODE,
      topics: ["Fantasy", "NSFW", "RPG", "sfw", "R18", "OC"],
    });
    expect(item?.topics).toEqual(["Fantasy", "RPG", "OC"]);
  });

  it("收藏数不是数字时记 0", () => {
    expect(normalizeOnlineCard({ ...NODE, starCount: "很多" })?.stars).toBe(0);
  });

  it("缺 name 或缺 path 的节点跳过", () => {
    expect(normalizeOnlineCard({ ...NODE, name: "" })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, fullPath: "" })).toBeNull();
    expect(normalizeOnlineCard(null)).toBeNull();
    expect(normalizeOnlineCard("nope")).toBeNull();
  });

  it("私有与未列出条目不出现", () => {
    expect(normalizeOnlineCard({ ...NODE, is_public: false })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, is_unlisted: true })).toBeNull();
  });

  it("带大写的作者名也认，卡源上很常见", () => {
    const item = normalizeOnlineCard({ ...NODE, fullPath: "NetCables/Makima" });
    expect(item?.path).toBe("NetCables/Makima");
    expect(onlineCardPngUrl("NetCables/Makima")).toBe(
      "https://avatars.charhub.io/avatars/NetCables/Makima/chara_card_v2.png",
    );
  });

  it("path 形状不对就跳过：这个字段要进 URL", () => {
    expect(normalizeOnlineCard({ ...NODE, fullPath: "../../etc/passwd" })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, fullPath: "/etc/passwd" })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, fullPath: "a/b/c" })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, fullPath: ".hidden/name" })).toBeNull();
    expect(normalizeOnlineCard({ ...NODE, fullPath: "creator/Awesome Card" })).toBeNull();
  });

  it("外来主机上的头像地址被换回固定地址", () => {
    const item = normalizeOnlineCard({ ...NODE, avatar_url: "https://evil.example/x.png" });
    expect(item?.avatarUrl).toBe(
      "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/chara_card_v2.png",
    );
  });

  it("http 的头像地址也不认", () => {
    const item = normalizeOnlineCard({
      ...NODE,
      avatar_url: "http://avatars.charhub.io/avatars/ratlover/adventure-awaits/avatar.webp",
    });
    expect(item?.avatarUrl).toBe(
      "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/chara_card_v2.png",
    );
  });

  it("tagline 过长会被截断", () => {
    const item = normalizeOnlineCard({ ...NODE, tagline: "啊".repeat(500) });
    expect(item?.tagline.length).toBeLessThanOrEqual(120);
  });

  it("下载与原文地址只对合规 path 生效", () => {
    expect(onlineCardPngUrl("ratlover/adventure-awaits")).toBe(
      "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/chara_card_v2.png",
    );
    expect(onlineCardPageUrl("ratlover/adventure-awaits")).toBe(
      `${ONLINE_SOURCE.siteUrl}characters/ratlover/adventure-awaits`,
    );
    expect(onlineCardPngUrl("../etc")).toBeNull();
    expect(onlineCardPngUrl("")).toBeNull();
    expect(onlineCardPageUrl("https://evil.example/x")).toBeNull();
  });
});

describe("立绘地址与中转", () => {
  it("卡里带出处就拼得出卡源立绘地址", () => {
    const url = cardPortraitUrl({
      name: "Fuka",
      extensions: { chub: { full_path: "shyzombie/fuka-shikuzaki-f2cea3d2" } },
    } as unknown as CharacterCardData);
    expect(url).toBe(
      "https://avatars.charhub.io/avatars/shyzombie/fuka-shikuzaki-f2cea3d2/avatar.webp",
    );
  });

  it("不是卡源来的卡拼不出立绘，路径不合规也不拼", () => {
    expect(cardPortraitUrl({ name: "本地卡" } as CharacterCardData)).toBeNull();
    expect(
      cardPortraitUrl({
        name: "越权",
        extensions: { chub: { full_path: "../../etc/passwd" } },
      } as unknown as CharacterCardData),
    ).toBeNull();
  });

  it("中转只放行卡源图片主机", () => {
    expect(
      avatarTarget("https://avatars.charhub.io/avatars/a/b/avatar.webp")?.hostname,
    ).toBe("avatars.charhub.io");
    expect(avatarTarget("http://avatars.charhub.io/avatars/a/b/avatar.webp")).toBeNull();
    expect(avatarTarget("https://example.com/steal.png")).toBeNull();
    expect(avatarTarget("https://avatars.charhub.io.evil.com/x.png")).toBeNull();
    expect(avatarTarget("不是地址")).toBeNull();
  });

  it("中转地址带着原始地址，编码后能原样取回", () => {
    const target = "https://avatars.charhub.io/avatars/a/b/avatar.webp";
    const proxied = avatarProxyUrl(target);
    expect(proxied.startsWith("/api/cards/avatar?url=")).toBe(true);
    expect(decodeURIComponent(proxied.split("url=")[1])).toBe(target);
  });
});
