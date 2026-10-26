import { describe, expect, it } from "vitest";
import { cardPortraitUrl, parseCharacterCard } from "@/lib/cards";

describe("imported card portraits", () => {
  it("maps common JSON avatar fields to the renderable portrait URL", () => {
    const result = parseCharacterCard({ name: "Test", avatar_url: "https://example.com/avatar.webp" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(cardPortraitUrl(result.card.data)).toBe("https://example.com/avatar.webp");
  });

  it("does not promote insecure or invalid avatar values", () => {
    const result = parseCharacterCard({ name: "Test", avatar: "http://example.com/avatar.png" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(cardPortraitUrl(result.card.data)).toBeNull();
  });

  it("accepts a V3 card shell and maps its icon asset to the portrait", () => {
    const result = parseCharacterCard({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "三号",
        nickname: "小三",
        assets: [{ type: "icon", uri: "https://example.com/icon.webp", name: "head" }],
        group_only_greetings: ["群聊开场"],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.name).toBe("三号");
    expect(cardPortraitUrl(result.card.data)).toBe("https://example.com/icon.webp");
    // V3 独有字段原样进 unmapped，导出时带回去，不丢
    const unmapped = (result.card.data.extensions?._unmapped ?? {}) as Record<string, unknown>;
    expect(Array.isArray(unmapped.assets)).toBe(true);
    expect(Array.isArray(unmapped.group_only_greetings)).toBe(true);
  });
});
