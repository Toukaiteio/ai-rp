import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate, type Locale, type MessageKey, type Vars } from "@/lib/i18n";
import { createEmptyCard } from "@/lib/cards";
import { CardTranslation } from "./CardTranslation";
import { CardTranslationDialog } from "./CardTranslationDialog";
import { CardTranslationMenu } from "./CardTranslationMenu";

const language = vi.hoisted(() => ({ locale: "zh" as Locale }));
vi.mock("@/lib/i18n/use-i18n", () => ({
  useI18n: () => ({ locale: language.locale, t: (key: MessageKey, vars?: Vars) => translate(language.locale, key, vars) }),
}));

const handlers = { onSkip: () => {}, onClose: () => {}, onStart: () => {}, onOpenSettings: () => {} };

describe("card translation UI", () => {
  it.each(["zh", "en"] as const)("opens a round target-language trigger in %s", (locale) => {
    language.locale = locale;
    const html = renderToStaticMarkup(<CardTranslation card={createEmptyCard()} />);
    expect(html).toContain(translate(locale, "card.translationConfirm"));
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="dialog"');
  });

  it("lists common languages and a custom entry in the menu", () => {
    language.locale = "zh";
    const html = renderToStaticMarkup(<CardTranslationMenu anchor={null} current="Simplified Chinese" onClose={() => {}} onPick={() => {}} />);
    expect(html).toContain('role="menu"');
    expect(html).toContain("翻译为");
    expect(html).toContain("简体中文");
    expect(html).toContain("日语");
    expect(html).toContain("俄语");
    expect(html).toContain("自定义语言");
    expect(html).toContain(translate("zh", "card.translateCustomPlaceholder"));
  });

  it.each(["zh", "en"] as const)("renders informed consent and a themed native checkbox in %s", (locale) => {
    language.locale = locale;
    const html = renderToStaticMarkup(<CardTranslationDialog stage="confirm" name="Original" targetLanguage="Simplified Chinese" skip={false} error="card.translationFailed" {...handlers} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<label");
    expect(html).toContain("focus-visible:outline-accent");
    expect(html).toContain(translate(locale, "card.translationNotice"));
    expect(html).toContain(translate(locale, "card.translationStart"));
    expect(html).toContain(translate(locale, "card.translateToLanguage", { language: translate(locale, "card.lang.zh") }));
    expect(html).not.toContain('checked=""');
  });

  it("has loading, cancellation and success feedback independent of the reminder", () => {
    language.locale = "zh";
    const loading = renderToStaticMarkup(<CardTranslationDialog stage="loading" name="Original" targetLanguage="Simplified Chinese" skip error="card.translationFailed" {...handlers} />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("正在翻译角色卡");
    expect(loading).toContain("取消");
    expect(loading).not.toContain('type="checkbox"');
    const success = renderToStaticMarkup(<CardTranslationDialog stage="success" name="Original" targetLanguage="Simplified Chinese" skip error="card.translationFailed" {...handlers} />);
    expect(success).toContain("译卡已另存至本地角色架");
  });

  it("offers settings for missing configuration and safe retry feedback", () => {
    language.locale = "en";
    const html = renderToStaticMarkup(<CardTranslationDialog stage="error" name="Original" targetLanguage="Simplified Chinese" skip={false} error="card.translationNotConfigured" {...handlers} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Open Settings");
    expect(html).toContain("Retry");
  });
});
