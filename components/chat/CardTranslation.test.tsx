import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";
import { createEmptyCard } from "@/lib/cards";
import { CardTranslation } from "./CardTranslation";
import { CardTranslationDialog } from "./CardTranslationDialog";

const language = vi.hoisted(() => ({ locale: "zh" as Locale }));
vi.mock("@/lib/i18n/use-i18n", () => ({
  useI18n: () => ({ locale: language.locale, t: (key: MessageKey) => translate(language.locale, key) }),
}));

const handlers = { onSkip: () => {}, onClose: () => {}, onStart: () => {}, onOpenSettings: () => {} };

describe("card translation UI", () => {
  it.each(["zh", "en"] as const)("shows an explicit target-language action in %s", (locale) => {
    language.locale = locale;
    const html = renderToStaticMarkup(<CardTranslation card={createEmptyCard()} />);
    expect(html).toContain(translate(locale, "card.translate"));
    expect(html).not.toContain('role="dialog"');
  });

  it.each(["zh", "en"] as const)("renders informed consent and a themed native checkbox in %s", (locale) => {
    language.locale = locale;
    const html = renderToStaticMarkup(<CardTranslationDialog stage="confirm" name="Original" skip={false} error="card.translationFailed" {...handlers} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<label");
    expect(html).toContain("focus-visible:outline-accent");
    expect(html).toContain(translate(locale, "card.translationNotice"));
    expect(html).toContain(translate(locale, "card.translationStart"));
    expect(html).not.toContain('checked=""');
  });

  it("has loading, cancellation and success feedback independent of the reminder", () => {
    language.locale = "zh";
    const loading = renderToStaticMarkup(<CardTranslationDialog stage="loading" name="Original" skip error="card.translationFailed" {...handlers} />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("正在翻译角色卡");
    expect(loading).toContain("取消");
    expect(loading).not.toContain('type="checkbox"');
    const success = renderToStaticMarkup(<CardTranslationDialog stage="success" name="Original" skip error="card.translationFailed" {...handlers} />);
    expect(success).toContain("译卡已另存至本地角色架");
  });

  it("offers settings for missing configuration and safe retry feedback", () => {
    language.locale = "en";
    const html = renderToStaticMarkup(<CardTranslationDialog stage="error" name="Original" skip={false} error="card.translationNotConfigured" {...handlers} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Open Settings");
    expect(html).toContain("Retry");
  });
});
