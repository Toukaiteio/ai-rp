import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate, type MessageKey, type Vars } from "@/lib/i18n";
import { translationDiagnostic, type TranslationProgress } from "./CardTranslationFlow";
import type { TranslationTaskView } from "./CardTranslationTasks";
import { sortTranslationTasks, TranslationTaskList, TranslationTrayPill } from "./CardTranslationTray";

vi.mock("@/lib/i18n/use-i18n", () => ({
  useI18n: () => ({ locale: "en", t: (key: MessageKey, vars?: Vars) => translate("en", key, vars) }),
}));

const progress: TranslationProgress = {
  phase: "translating", completed: 2, total: 4, field: "description",
  receivedCharacters: 37, completedCharacters: 200, totalCharacters: 800,
};

function task(patch: Partial<TranslationTaskView>): TranslationTaskView {
  return { id: 1, name: "Card", language: "English", status: "running", startedAt: 1, ...patch };
}

const handlers = { onRetry: () => {}, onRemove: () => {} };

describe("translation task tray", () => {
  it("shows one progress bar and the translating field, not raw stream counters", () => {
    const html = renderToStaticMarkup(<TranslationTaskList tasks={[task({ progress })]} {...handlers} />);
    expect(html).toContain("Translating: Description");
    expect(html).toContain("200 / 800 characters · 25%");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).not.toContain("Characters received");
    expect(html).not.toContain("Completed segments");
  });

  it("marks a finished task as a new card and keeps 100% only then", () => {
    const complete = { ...progress, phase: "complete" as const, completedCharacters: 800 };
    const done = renderToStaticMarkup(<TranslationTaskList tasks={[task({ status: "done", progress: complete })]} {...handlers} />);
    expect(done).toContain("Translation complete. Saved as a new card.");
    expect(done).toContain('aria-valuenow="100"');
    const saving = renderToStaticMarkup(<TranslationTaskList tasks={[task({ status: "saving", progress: complete })]} {...handlers} />);
    expect(saving).toContain("Saving the translated card");
    expect(saving).toContain('aria-valuenow="99"');
  });

  it.each(["output_limit", "content_filter", "stream_interrupted", "invalid_json", "json_truncated", "invalid_sse", "unexpected_finish_reason", "upstream_error", "network_error", "unexpected_fields", "invalid_value", "invalid_dictionary", "missing_fields", "protected_tokens", "http_error"])("safely explains %s with the failed field", (reason) => {
    const diagnostic = translationDiagnostic({ message: "private payload", details: { reason, field: "character_book", completed: 2, total: 4, status: 429, payload: "secret" } });
    const html = renderToStaticMarkup(<TranslationTaskList tasks={[task({ status: "failed", error: "card.translationIncomplete", diagnostic })]} {...handlers} />);
    expect(html).toContain(translate("en", "card.translationIncomplete").replaceAll("'", "&#x27;"));
    expect(html).toContain(translate("en", diagnostic.reason).replaceAll("'", "&#x27;"));
    expect(html).toContain("Failed at: World book");
    expect(html).toContain("Continue translation");
    expect(html).not.toContain("private payload");
    expect(html).not.toContain("secret");
  });

  it("offers settings for missing configuration and a save-only retry", () => {
    const config = renderToStaticMarkup(
      <TranslationTaskList tasks={[task({ status: "failed", error: "card.translationNotConfigured", diagnostic: translationDiagnostic(null) })]}
        onRetry={() => {}} onRemove={() => {}} onOpenSettings={() => {}} />,
    );
    expect(config).toContain("Open Settings");
    expect(config).toContain("Continue translation");
    const save = renderToStaticMarkup(
      <TranslationTaskList tasks={[task({ status: "failed", error: "card.translationSaveFailed", diagnostic: translationDiagnostic(null) })]} {...handlers} />,
    );
    expect(save).toContain("Retry saving");
    expect(save).toContain("without calling the model again");
  });

  it("hides the failed field line when the field is unknown", () => {
    const diagnostic = translationDiagnostic({ details: { reason: "network_error", field: "secret field" } });
    const html = renderToStaticMarkup(<TranslationTaskList tasks={[task({ status: "failed", error: "card.translationFailed", diagnostic })]} {...handlers} />);
    expect(html).not.toContain("Failed at:");
  });

  it("orders active tasks first, then failures, then finished ones", () => {
    const ordered = sortTranslationTasks([
      task({ id: 1, status: "done" }),
      task({ id: 2, status: "failed" }),
      task({ id: 3, status: "running" }),
    ]);
    expect(ordered.map((entry) => entry.status)).toEqual(["running", "failed", "done"]);
  });

  it("collapses to a pill that shows the running percent or the leftover count", () => {
    const running = renderToStaticMarkup(<TranslationTrayPill tasks={[task({ progress })]} />);
    expect(running).toContain("25%");
    expect(running).not.toContain("Card");
    const parallel = renderToStaticMarkup(<TranslationTrayPill tasks={[
      task({ id: 1, progress }),
      task({ id: 2, progress }),
    ]} />);
    expect(parallel).toContain("×2");
    const finished = renderToStaticMarkup(<TranslationTrayPill tasks={[task({ status: "done" })]} />);
    expect(finished).toContain(">1<");
  });
});
