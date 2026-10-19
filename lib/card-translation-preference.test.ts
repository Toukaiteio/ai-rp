import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmCardTranslation, shouldConfirmCardTranslation } from "./card-translation-preference";

describe("card translation reminder", () => {
  let saved: Map<string, string>;
  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("prompts on first use and after closing without confirmation", () => {
    expect(shouldConfirmCardTranslation()).toBe(true);
    expect(shouldConfirmCardTranslation()).toBe(true);
    expect(saved.size).toBe(0);
  });
  it("keeps prompting when confirmation was not checked", () => {
    confirmCardTranslation(false);
    expect(shouldConfirmCardTranslation()).toBe(true);
    expect(saved.size).toBe(0);
  });
  it("persists an explicitly confirmed skip preference", () => {
    confirmCardTranslation(true);
    expect(saved.size).toBe(1);
    expect(shouldConfirmCardTranslation()).toBe(false);
  });
  it("continues prompting when storage is unavailable or malformed", () => {
    vi.stubGlobal("localStorage", { getItem: () => "invalid", setItem: () => { throw new Error("blocked"); } });
    confirmCardTranslation(true);
    expect(shouldConfirmCardTranslation()).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(shouldConfirmCardTranslation()).toBe(true);
  });
});
