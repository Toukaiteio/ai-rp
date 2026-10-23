import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate, type Locale, type MessageKey, type Vars } from "@/lib/i18n";
import { createEmptyCard } from "@/lib/cards";
import { CardTranslation, CardTranslationConfirm } from "./CardTranslation";
import { CardTranslationMenu } from "./CardTranslationMenu";

const language = vi.hoisted(() => ({ locale: "zh" as Locale }));
vi.mock("@/lib/i18n/use-i18n", () => ({
  useI18n: () => ({ locale: language.locale, t: (key: MessageKey, vars?: Vars) => translate(language.locale, key, vars) }),
}));

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
    const html = renderToStaticMarkup(
      <CardTranslationConfirm name="Original" language="Simplified Chinese" skip={false}
        onSkip={() => {}} onClose={() => {}} onStart={() => {}} />,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<label");
    expect(html).toContain("focus-visible:outline-accent");
    expect(html).toContain(translate(locale, "card.translationNotice"));
    expect(html).toContain(translate(locale, "card.translationStart"));
    expect(html).toContain(translate(locale, "card.translateToLanguage", { language: translate(locale, "card.lang.zh") }));
    expect(html).not.toContain('checked=""');
  });

  it("offers cancellation before the task starts, not a progress modal", () => {
    language.locale = "zh";
    const html = renderToStaticMarkup(
      <CardTranslationConfirm name="Original" language="Simplified Chinese" skip={false}
        onSkip={() => {}} onClose={() => {}} onStart={() => {}} />,
    );
    expect(html).toContain("取消");
    expect(html).not.toContain("progressbar");
  });
});
