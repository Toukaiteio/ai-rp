import { describe, expect, it } from "vitest";
import {
  ONLINE_SOURCE,
  normalizeOnlineCard,
  onlineCardPageUrl,
  onlineCardPngUrl,
} from "./online";

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
