import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, translateCharacterCard } from "@/lib/cards";
import { addImportedCard } from "@/lib/storage/cards";
import { getProviderConfigSnapshot } from "@/lib/storage/settings";
import { defaultProviderConfig, withImage } from "@/lib/providers/settings";
import { clearTranslationSession, translateAndSaveCard, translationDiagnostic, translationErrorKey, translationPercent, type TranslationProgress, type TranslationSession } from "./CardTranslationFlow";

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

  it.each(["Simplified Chinese", "English"])("uses the current config and saves a separate %s card", async (language) => {
    const card = createEmptyCard();
    card.data.name = "Original";
    const result = structuredClone(card);
    result.data.name = "Translated";
    vi.mocked(translateCharacterCard).mockResolvedValue(result);
    const controller = new AbortController();
    await translateAndSaveCard(card, language, controller.signal);
    expect(translateCharacterCard).toHaveBeenCalledWith(card, language, withImage(getProviderConfigSnapshot()), { signal: controller.signal });
    expect(addImportedCard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "Translated" }),
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
    await expect(translateAndSaveCard(createEmptyCard(), "Simplified Chinese", controller.signal)).rejects.toThrow();
    expect(addImportedCard).not.toHaveBeenCalled();
  });

  it("does not invoke the model for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateAndSaveCard(createEmptyCard(), "English", controller.signal)).rejects.toThrow();
    expect(translateCharacterCard).not.toHaveBeenCalled();
  });

  it("reports persistence failure rather than success", async () => {
    vi.mocked(translateCharacterCard).mockResolvedValue(createEmptyCard());
    vi.mocked(addImportedCard).mockRejectedValue(new Error("disk full"));
    await expect(translateAndSaveCard(createEmptyCard(), "English", new AbortController().signal))
      .rejects.toMatchObject({ code: "translation_save_failed" });
  });

  it("reuses completed segments after a failed stream", async () => {
    const session: TranslationSession = { checkpoint: { translations: {} } };
    const card = createEmptyCard();
    vi.mocked(translateCharacterCard).mockImplementationOnce(async (_card, _locale, _config, options) => {
      const checkpoint = (options as { checkpoint: TranslationSession["checkpoint"] }).checkpoint;
      checkpoint.translations.s0 = "Completed";
      throw { code: "translation_incomplete", details: { reason: "stream_interrupted", completed: 1, total: 2 } };
    }).mockResolvedValueOnce(createEmptyCard());
    await expect(translateAndSaveCard(card, "English", new AbortController().signal, { session })).rejects.toMatchObject({ code: "translation_incomplete" });
    expect(session.checkpoint.translations).toEqual({ s0: "Completed" });
    const checkpoint = session.checkpoint;
    await translateAndSaveCard(card, "English", new AbortController().signal, { session });
    expect(vi.mocked(translateCharacterCard).mock.calls[1][3]).toMatchObject({ checkpoint });
    expect(session).toEqual({ checkpoint: { translations: {} } });
  });

  it("retries persistence using the complete cached card without invoking the model", async () => {
    const session: TranslationSession = { checkpoint: { translations: {} } };
    const card = createEmptyCard();
    const translated = createEmptyCard();
    vi.mocked(translateCharacterCard).mockResolvedValue(translated);
    vi.mocked(addImportedCard).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce({ id: "saved", card: translated, importedAt: 0 });
    await expect(translateAndSaveCard(card, "English", new AbortController().signal, { session })).rejects.toMatchObject({ code: "translation_save_failed" });
    expect(session.translated).toBe(translated);
    await translateAndSaveCard(card, "English", new AbortController().signal, { session });
    expect(translateCharacterCard).toHaveBeenCalledTimes(1);
    expect(addImportedCard).toHaveBeenCalledTimes(2);
  });

  it.each(["source", "language", "provider", "model", "baseURL", "temperature"])("invalidates the complete cache when %s changes", async (changed) => {
    const session: TranslationSession = { checkpoint: { translations: {} } };
    const card = createEmptyCard();
    vi.mocked(translateCharacterCard).mockResolvedValue(createEmptyCard());
    vi.mocked(addImportedCard).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce({ id: "saved", card, importedAt: 0 });
    await expect(translateAndSaveCard(card, "English", new AbortController().signal, { session })).rejects.toThrow();
    if (changed === "source") card.data.description = "new source";
    const config = defaultProviderConfig();
    config.apiKey = "private-key";
    if (changed === "provider") config.providerId = "changed-provider";
    if (changed === "model") config.model = "changed-model";
    if (changed === "baseURL") config.baseURL = "https://example.com/v1";
    if (changed === "temperature") config.temperature = 0.3;
    vi.mocked(getProviderConfigSnapshot).mockReturnValue(config);
    await translateAndSaveCard(card, changed === "language" ? "Simplified Chinese" : "English", new AbortController().signal, { session });
    expect(translateCharacterCard).toHaveBeenCalledTimes(2);
  });

  it("keeps credentials out of cache bindings", async () => {
    const config = defaultProviderConfig();
    config.apiKey = "secret-text-key";
    config.image.apiKey = "secret-image-key";
    vi.mocked(getProviderConfigSnapshot).mockReturnValue(config);
    const session: TranslationSession = { checkpoint: { translations: {} } };
    vi.mocked(translateCharacterCard).mockResolvedValue(createEmptyCard());
    vi.mocked(addImportedCard).mockRejectedValue(new Error("disk full"));
    await expect(translateAndSaveCard(createEmptyCard(), "English", new AbortController().signal, { session })).rejects.toThrow();
    expect(session.binding).not.toContain("secret-");
    clearTranslationSession(session);
    expect(session).toEqual({ checkpoint: { translations: {} } });
  });

  it("forwards actual progress and only announces saving after translation completes", async () => {
    const events: string[] = [];
    const onProgress = vi.fn(() => { events.push("progress"); });
    vi.mocked(translateCharacterCard).mockImplementation(async (_card, _locale, _config, options) => {
      options?.onProgress?.(progress);
      events.push("translated");
      return createEmptyCard();
    });
    vi.mocked(addImportedCard).mockImplementation(async (card) => {
      events.push("saved");
      return { id: "saved", card, importedAt: 0 };
    });
    await translateAndSaveCard(createEmptyCard(), "English", new AbortController().signal, {
      onProgress, onSaving: () => { events.push("saving"); },
    });
    expect(onProgress).toHaveBeenCalledWith(progress);
    expect(events).toEqual(["progress", "translated", "saving", "saved"]);
  });

  it("rejects a late translated card when configuration changed during generation", async () => {
    const session: TranslationSession = { checkpoint: { translations: {} } };
    vi.mocked(translateCharacterCard).mockImplementation(async () => {
      vi.mocked(getProviderConfigSnapshot).mockReturnValue({ ...defaultProviderConfig(), model: "new-model" });
      return createEmptyCard();
    });
    await expect(translateAndSaveCard(createEmptyCard(), "English", new AbortController().signal, { session })).rejects.toMatchObject({ name: "AbortError" });
    expect(addImportedCard).not.toHaveBeenCalled();
    expect(session).toEqual({ checkpoint: { translations: {} } });
  });

  it("clears checkpoint on cancellation and refuses a late save", async () => {
    const session: TranslationSession = { checkpoint: { translations: {} } };
    const controller = new AbortController();
    vi.mocked(translateCharacterCard).mockImplementation(async () => {
      session.checkpoint.translations.s0 = "temporary";
      controller.abort();
      return createEmptyCard();
    });
    await expect(translateAndSaveCard(createEmptyCard(), "English", controller.signal, { session })).rejects.toThrow();
    expect(session).toEqual({ checkpoint: { translations: {} } });
    expect(addImportedCard).not.toHaveBeenCalled();
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

const progress: TranslationProgress = {
  phase: "translating", completed: 2, total: 4, field: "description",
  receivedCharacters: 37, completedCharacters: 200, totalCharacters: 800,
};

describe("translation progress and safe diagnostics", () => {
  it("never claims 100% before persistence succeeds", () => {
    const complete = { ...progress, phase: "complete" as const, completedCharacters: 800 };
    expect(translationPercent(complete)).toBe(99);
    expect(translationPercent(undefined)).toBe(0);
    expect(translationPercent({ ...progress, completedCharacters: NaN })).toBe(0);
    expect(translationPercent(complete, true)).toBe(100);
  });

  it.each(["output_limit", "content_filter", "stream_interrupted", "invalid_json", "json_truncated", "invalid_sse", "unexpected_finish_reason", "upstream_error", "network_error", "unexpected_fields", "invalid_value", "invalid_dictionary", "missing_fields", "protected_tokens", "http_error"])("maps %s to a safe diagnostic", (reason) => {
    const diagnostic = translationDiagnostic({ message: "private payload", details: { reason, field: "character_book", completed: 2, total: 4, status: 429, payload: "secret" } });
    expect(diagnostic.reason).not.toBe("card.translationReasonUnknown");
    expect(diagnostic.field).toBe("card.translationFieldBook");
    expect(diagnostic.completed).toBe(2);
    expect(diagnostic.total).toBe(4);
    expect(diagnostic.status).toBe(429);
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });

  it("whitelists unknown reasons, fields, and numeric status", () => {
    const diagnostic = translationDiagnostic({ details: { reason: "secret payload", field: "secret field", status: "secret status", completed: -1, total: Infinity } });
    expect(diagnostic).toEqual({ reason: "card.translationReasonUnknown", field: null, completed: undefined, total: undefined, status: undefined, receivedCharacters: undefined });
    expect(translationDiagnostic({ details: { reason: "__proto__", field: "constructor" } }).reason).toBe("card.translationReasonUnknown");
  });
});
