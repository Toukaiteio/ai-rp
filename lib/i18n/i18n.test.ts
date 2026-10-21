import { describe, expect, it } from "vitest";
import { en } from "./en";
import { detectLocale, explainError, translate } from "./index";
import { zh, type MessageKey } from "./zh";

describe("i18n", () => {
  it("英文表和中文表的键一致", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("替换占位符，缺的语言退回中文", () => {
    expect(translate("zh", "shelf.count", { count: 3 })).toBe("(3 张)");
    expect(translate("en", "vault.attempts", { left: 3, max: 5 })).toContain("3");
    expect(translate("en", "chat.sayTo", { name: "Lin" })).toBe("Send a message to Lin");
  });

  it("没手动选过时，中文浏览器用中文，其他语言用英文", () => {
    expect(detectLocale(["zh-CN", "en"])).toBe("zh");
    expect(detectLocale(["en-US"])).toBe("en");
    expect(detectLocale(["ja"])).toBe("en");
    expect(detectLocale(undefined)).toBe("zh");
  });

  it("带 phrase 的错误按当前语言显示", () => {
    const caught = { phrase: "mismatch", message: "两次输入的密钥不一样" };
    expect(explainError(caught, (key) => translate("en", key))).toBe(
      en["vault.error.mismatch" as MessageKey],
    );
    expect(explainError(new Error("raw"), (key) => translate("zh", key))).toBe("raw");
  });
});
