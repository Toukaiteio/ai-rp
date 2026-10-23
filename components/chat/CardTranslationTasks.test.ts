import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, type CharacterCard } from "@/lib/cards";
import { translateAndSaveCard } from "./CardTranslationFlow";
import {
  getTranslationTasksSnapshot,
  getTranslationTraySnapshot,
  removeCardTranslation,
  retryCardTranslation,
  setTranslationTray,
  startCardTranslation,
  subscribeTranslationTasks,
  toggleTranslationTray,
} from "./CardTranslationTasks";

const configListeners = vi.hoisted(() => new Set<() => void>());
vi.mock("@/lib/storage/settings", () => ({
  subscribeProviderConfig: vi.fn((listener: () => void) => {
    configListeners.add(listener);
    return () => configListeners.delete(listener);
  }),
}));

vi.mock("./CardTranslationFlow", async (importOriginal) => ({
  ...await importOriginal<object>(),
  translateAndSaveCard: vi.fn(),
}));

const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

function card(name: string): CharacterCard {
  const result = createEmptyCard();
  result.data.name = name;
  return result;
}

function flushTasks(): void {
  for (const task of [...getTranslationTasksSnapshot()]) removeCardTranslation(task.id);
}

beforeEach(() => {
  vi.mocked(translateAndSaveCard).mockReset();
  flushTasks();
  setTranslationTray("hidden");
});

describe("background translation tasks", () => {
  it("runs as a task that survives on its own and reports completion", async () => {
    vi.mocked(translateAndSaveCard).mockImplementation(async (_card, _language, _signal, options) => {
      await Promise.resolve();
      options?.onProgress?.({
        phase: "translating", completed: 1, total: 2, field: "description",
        receivedCharacters: 10, completedCharacters: 100, totalCharacters: 400,
      });
    });
    const saved = vi.fn();
    expect(startCardTranslation(card("Original"), "English", { onSaved: saved })).toBe(true);

    const running = getTranslationTasksSnapshot();
    expect(running).toHaveLength(1);
    expect(running[0].status).toBe("running");
    expect(running[0].name).toBe("Original");
    expect(getTranslationTraySnapshot()).toBe("open");

    await settle();
    const view = getTranslationTasksSnapshot()[0];
    expect(view.status).toBe("done");
    expect(view.progress?.completedCharacters).toBe(100);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("reports failures through safe UI copy without leaking the cause", async () => {
    vi.mocked(translateAndSaveCard).mockRejectedValue({
      code: "translation_incomplete",
      message: "private payload",
      details: { reason: "stream_interrupted", field: "character_book", completed: 1, total: 3 },
    });
    startCardTranslation(card("Original"), "English");
    await settle();

    const [view] = getTranslationTasksSnapshot();
    expect(view.status).toBe("failed");
    expect(view.error).toBe("card.translationIncomplete");
    expect(view.diagnostic?.reason).toBe("card.translationReasonStream");
    expect(view.diagnostic?.field).toBe("card.translationFieldBook");
    expect(JSON.stringify(view)).not.toContain("private payload");
  });

  it("does not start the same card and language twice, but allows another language", () => {
    vi.mocked(translateAndSaveCard).mockImplementation(() => new Promise(() => undefined));
    const target = card("Original");
    expect(startCardTranslation(target, "English")).toBe(true);
    expect(startCardTranslation(target, "English")).toBe(false);
    expect(getTranslationTasksSnapshot()).toHaveLength(1);
    expect(startCardTranslation(target, "Japanese")).toBe(true);
    expect(getTranslationTasksSnapshot()).toHaveLength(2);
  });

  it("re-opening an active task brings the collapsed tray back", () => {
    vi.mocked(translateAndSaveCard).mockImplementation(() => new Promise(() => undefined));
    const target = card("Original");
    startCardTranslation(target, "English");
    setTranslationTray("collapsed");
    startCardTranslation(target, "English");
    expect(getTranslationTraySnapshot()).toBe("open");
    expect(getTranslationTasksSnapshot()).toHaveLength(1);
  });

  it("removing a task aborts its signal and clears the tray when nothing is left", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(translateAndSaveCard).mockImplementation((_card, _language, taskSignal) => {
      signal = taskSignal;
      return new Promise(() => undefined);
    });
    startCardTranslation(card("Original"), "English");
    const [view] = getTranslationTasksSnapshot();
    removeCardTranslation(view.id);

    expect(signal?.aborted).toBe(true);
    expect(getTranslationTasksSnapshot()).toHaveLength(0);
    expect(getTranslationTraySnapshot()).toBe("hidden");
    await settle();
    expect(getTranslationTasksSnapshot()).toHaveLength(0);
  });

  it("retry continues with the same session checkpoint instead of starting over", async () => {
    vi.mocked(translateAndSaveCard).mockRejectedValueOnce({
      code: "translation_incomplete",
      details: { reason: "stream_interrupted", completed: 1, total: 3 },
    }).mockResolvedValueOnce(undefined);
    startCardTranslation(card("Original"), "English");
    await settle();
    const firstSession = vi.mocked(translateAndSaveCard).mock.calls[0][3]?.session;

    const [view] = getTranslationTasksSnapshot();
    const saved = vi.fn();
    retryCardTranslation(view.id, saved);
    await settle();

    expect(translateAndSaveCard).toHaveBeenCalledTimes(2);
    expect(vi.mocked(translateAndSaveCard).mock.calls[1][3]?.session).toBe(firstSession);
    expect(getTranslationTasksSnapshot()[0].status).toBe("done");
    expect(saved).toHaveBeenCalledOnce();
  });

  it("cancels every running task when the provider configuration changes", () => {
    let signal: AbortSignal | undefined;
    vi.mocked(translateAndSaveCard).mockImplementation((_card, _language, taskSignal) => {
      signal = taskSignal;
      return new Promise(() => undefined);
    });
    startCardTranslation(card("Original"), "English");
    startCardTranslation(card("Other"), "Japanese");

    for (const listener of configListeners) listener();

    expect(getTranslationTasksSnapshot()).toHaveLength(0);
    expect(signal?.aborted).toBe(true);
  });

  it("notifies subscribers on every state change and toggles the tray", () => {
    const events: string[] = [];
    const unsubscribe = subscribeTranslationTasks(() => {
      events.push(`${getTranslationTasksSnapshot().length}:${getTranslationTraySnapshot()}`);
    });
    vi.mocked(translateAndSaveCard).mockImplementation(() => new Promise(() => undefined));
    startCardTranslation(card("Original"), "English");
    toggleTranslationTray();
    removeCardTranslation(getTranslationTasksSnapshot()[0].id);
    unsubscribe();

    expect(events).toEqual(["0:open", "1:open", "1:collapsed", "0:hidden"]);
  });
});
