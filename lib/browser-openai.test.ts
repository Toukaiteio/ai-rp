import { describe, expect, it } from "vitest";
import { browserChatEndpoint } from "./browser-openai";

describe("浏览器直连 endpoint", () => {
  it("为 API 根地址追加 chat completions", () => {
    expect(browserChatEndpoint("https://router.example/v1")).toBe(
      "https://router.example/v1/chat/completions",
    );
    expect(browserChatEndpoint("https://router.example/v1/")).toBe(
      "https://router.example/v1/chat/completions",
    );
  });

  it("不会重复追加完整 endpoint，并拒绝 HTTP", () => {
    expect(browserChatEndpoint("https://router.example/v1/chat/completions")).toBe(
      "https://router.example/v1/chat/completions",
    );
    expect(() => browserChatEndpoint("http://router.example/v1")).toThrow(
      "browser_https_required",
    );
  });
});
