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
});
