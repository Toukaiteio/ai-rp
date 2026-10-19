import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, translateCharacterCard } from "@/lib/cards";
import { addImportedCard } from "@/lib/storage/cards";
import { getProviderConfigSnapshot } from "@/lib/storage/settings";
import { defaultProviderConfig, withImage } from "@/lib/providers/settings";
import { translateAndSaveCard, translationErrorKey } from "./CardTranslationFlow";

vi.mock("@/lib/cards", async (importOriginal) => ({
  ...await importOriginal<object>(), translateCharacterCard: vi.fn(),
}));
vi.mock("@/lib/storage/cards", () => ({ addImportedCard: vi.fn() }));
vi.mock("@/lib/storage/settings", () => ({ getProviderConfigSnapshot: vi.fn() }));

describe("card translation save flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getProviderConfigSnapshot).mockReturnValue(defaultProviderConfig());
  });

  it.each(["zh", "en"] as const)("uses the current config and saves a separate %s card", async (locale) => {
    const card = createEmptyCard();
    card.data.name = "Original";
    const result = structuredClone(card);
    result.data.name = "Translated";
    vi.mocked(translateCharacterCard).mockResolvedValue(result);
    const controller = new AbortController();
    await translateAndSaveCard(card, locale, controller.signal);
    expect(translateCharacterCard).toHaveBeenCalledWith(card, locale, withImage(getProviderConfigSnapshot()), { signal: controller.signal });
    expect(addImportedCard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: locale === "zh" ? "Translated（中文译本）" : "Translated (English translation)" }),
    }), { strict: true, signal: controller.signal });
    expect(card.data.name).toBe("Original");
    expect(result.data.name).toBe("Translated");
  });

  it("does not save a late result after cancellation even if the model ignores abort", async () => {
    const controller = new AbortController();
    vi.mocked(translateCharacterCard).mockImplementation(async () => {
      controller.abort();
      return createEmptyCard();
    });
    await expect(translateAndSaveCard(createEmptyCard(), "zh", controller.signal)).rejects.toThrow();
    expect(addImportedCard).not.toHaveBeenCalled();
  });

  it("does not invoke the model for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateAndSaveCard(createEmptyCard(), "en", controller.signal)).rejects.toThrow();
    expect(translateCharacterCard).not.toHaveBeenCalled();
  });

  it("reports persistence failure rather than success", async () => {
    vi.mocked(translateCharacterCard).mockResolvedValue(createEmptyCard());
    vi.mocked(addImportedCard).mockRejectedValue(new Error("disk full"));
    await expect(translateAndSaveCard(createEmptyCard(), "en", new AbortController().signal))
      .rejects.toMatchObject({ code: "translation_save_failed" });
  });

  it.each([
    ["translation_not_configured", "card.translationNotConfigured"],
    ["translation_invalid_response", "card.translationInvalid"],
    ["translation_incomplete", "card.translationIncomplete"],
    ["translation_save_failed", "card.translationSaveFailed"],
    ["raw secret model response", "card.translationFailed"],
  ])("maps %s to safe UI copy", (code, key) => {
    expect(translationErrorKey({ code, message: "private card response" })).toBe(key);
  });
});
