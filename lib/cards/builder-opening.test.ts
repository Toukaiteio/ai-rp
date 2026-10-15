import { describe, expect, it } from "vitest";
import { adaptGreeting, isBuilderOpening, stripRatingPitch } from "./builder-opening";

const ORIGINAL = `To start, give me a description about the character you want to create and if the card is expected to be sexual or violent (NSFW) or for safe roleplaying only (SFW). Then, when you're satisfied.

For NSFW, if you have certain fetishes in mind, please precise all of them so that I can build the card with those in mind. Remember that my goal is to write something efficient.

*TIPS : I understand dialog as "dialog text"*`;

describe("开场白里的分级说明", () => {
  it("去掉 NSFW 与 SFW 那句，也去掉紧跟着的 Fetish 段", () => {
    const cleaned = stripRatingPitch(ORIGINAL);
    expect(cleaned).not.toMatch(/NSFW|SFW|fetish/i);
    expect(cleaned).toContain("give me a description");
    expect(cleaned).toContain("TIPS");
  });

  it("Character Card Builder 的开场白按界面语言整段替换", () => {
    const source = `Hello! I am your Character Card Builder assistant!\n\n*STEP 1: traits.*\n\n${ORIGINAL}`;
    expect(isBuilderOpening(source)).toBe(true);
    const zh = adaptGreeting(source, "zh");
    const en = adaptGreeting(source, "en");
    expect(zh).toContain("第一步");
    expect(en).toContain("STEP 1");
    expect(zh).not.toMatch(/NSFW|SFW/);
    expect(en).not.toMatch(/NSFW|SFW/);
    expect(adaptGreeting(zh, "en")).toBe(en);
  });

  it("普通开场白只删说明，不整段换掉", () => {
    const text = "夜色很安静。";
    expect(adaptGreeting(text, "en")).toBe(text);
  });
});
