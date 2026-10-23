import { describe, expect, it } from "vitest";
import {
  decodeMarkedBase64,
  decodeUtf8Base64,
  encodeRandomUserWords,
  encodeUtf8Base64,
  hasMarkedBase64,
} from "./user-message-encoding";

describe("用户消息隐私混淆", () => {
  it("按 UTF-8 编码并能还原中文、日文和 emoji", () => {
    const text = "你好世界！こんにちは 🌙";
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
  });

  it("只替换随机词语，标记外的内容保持原样", () => {
    const source = "Hello 世界，今天去上海。";
    const encoded = encodeRandomUserWords(source, { random: () => 0 });

    expect(encoded.encodedWords).toBeGreaterThan(0);
    expect(encoded.text).toContain("[[b64:utf8:");
    expect(encoded.text).toContain("Hello");
    expect(decodeMarkedBase64(encoded.text)).toBe(source);
    expect(hasMarkedBase64(encoded.text)).toBe(true);
  });

  it("没有可编码词语时不修改输入", () => {
    expect(encodeRandomUserWords("，！？").text).toBe("，！？");
    expect(hasMarkedBase64("普通文本")).toBe(false);
  });

  it("遇到非法标记时保留原文，不让内部分析失败", () => {
    const value = "前文 [[b64:utf8:not-valid]] 后文";
    expect(decodeMarkedBase64(value)).toBe(value);
  });
});
