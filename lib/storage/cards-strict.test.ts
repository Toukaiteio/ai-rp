import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "@/lib/cards";
import { writeSlot, removeSlot } from "@/lib/vault";

vi.mock("@/lib/vault", () => ({ writeSlot: vi.fn(), removeSlot: vi.fn(), listSlots: vi.fn(), readSlot: vi.fn() }));
vi.mock("@/lib/vault/registry", () => ({ registerVaultData: vi.fn() }));

describe("strict imported card persistence", () => {
  beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

  it("publishes only after storage succeeds", async () => {
    const { addImportedCard, getImportedCardsSnapshot, subscribeImportedCards } = await import("./cards");
    const notify = vi.fn();
    subscribeImportedCards(notify);
    let finish!: () => void;
    vi.mocked(writeSlot).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const task = addImportedCard(createEmptyCard(), { strict: true });
    expect(getImportedCardsSnapshot()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    finish();
    const record = await task;
    expect(getImportedCardsSnapshot()).toEqual([record]);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("rejects failed writes without adding a phantom card", async () => {
    const { addImportedCard, getImportedCardsSnapshot } = await import("./cards");
    vi.mocked(writeSlot).mockRejectedValue(new Error("disk full"));
    await expect(addImportedCard(createEmptyCard(), { strict: true })).rejects.toThrow("disk full");
    expect(getImportedCardsSnapshot()).toEqual([]);
  });

  it("rolls back a write if cancelled while persisting", async () => {
    const { addImportedCard, getImportedCardsSnapshot } = await import("./cards");
    const controller = new AbortController();
    vi.mocked(writeSlot).mockImplementation(async () => { controller.abort(); });
    await expect(addImportedCard(createEmptyCard(), { strict: true, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(removeSlot).toHaveBeenCalledOnce();
    expect(getImportedCardsSnapshot()).toEqual([]);
  });

  it("preserves default optimistic behavior on failed writes", async () => {
    const { addImportedCard, getImportedCardsSnapshot } = await import("./cards");
    vi.mocked(writeSlot).mockRejectedValue(new Error("disk full"));
    const record = await addImportedCard(createEmptyCard());
    expect(getImportedCardsSnapshot()).toEqual([record]);
  });
});
