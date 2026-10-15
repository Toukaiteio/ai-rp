import { describe, expect, it } from "vitest";
import { browserModelIsReady } from "./browser-model";
import { canSend, usesBrowserModel, type ProviderConfig } from "./providers/settings";

function config(partial: Partial<ProviderConfig>): ProviderConfig {
  return {
    providerId: "yosei-router",
    model: "deepseek-v4-flash-200k",
    apiKey: "",
    baseURL: "",
    temperature: 0.9,
    vision: false,
    image: {
      model: "",
      baseURL: "",
      apiKey: "",
      styleId: "jp-flat",
      auto: false,
      budget: 4,
      threshold: 6,
    },
    ...partial,
  };
}

describe("浏览器模型", () => {
  it("只有已经能响应才算可用", () => {
    expect(browserModelIsReady("available")).toBe(true);
    expect(browserModelIsReady("readily")).toBe(true);
    expect(browserModelIsReady("downloadable")).toBe(false);
    expect(browserModelIsReady("downloading")).toBe(false);
    expect(browserModelIsReady("unavailable")).toBe(false);
  });

  it("没填 Key 且本机模型就绪时直接用它", () => {
    const empty = config({});
    expect(usesBrowserModel(empty, true)).toBe(true);
    expect(canSend(empty, true)).toBe(true);
    expect(usesBrowserModel(empty, false)).toBe(false);
    expect(canSend(empty, false)).toBe(false);
  });

  it("填了 Key 就走所选提供商，除非选的就是浏览器", () => {
    const remote = config({ apiKey: "sk-test" });
    expect(usesBrowserModel(remote, true)).toBe(false);
    expect(canSend(remote, true)).toBe(true);
    const local = config({ providerId: "browser", apiKey: "sk-test" });
    expect(usesBrowserModel(local, true)).toBe(true);
    expect(usesBrowserModel(local, false)).toBe(false);
  });
});
