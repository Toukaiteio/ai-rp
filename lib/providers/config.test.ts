import { describe, expect, it } from "vitest";
import { findProvider, imageProviderForModel, listProviders, presetChat } from "./config";
import { resolveBaseURL } from "./validate";

describe("提供商预设", () => {
  it("Agnes 和 Dots 紧跟在 YoseiRouter 后面，并标成免费", () => {
    const names = listProviders().map((provider) => provider.id);
    expect(names.slice(0, 3)).toEqual(["yosei-router", "agnes", "dots"]);
    expect(findProvider("agnes")?.badge).toBe("free");
    expect(findProvider("dots")?.badge).toBe("free");
    expect(findProvider("agnes")?.models.map((model) => (typeof model === "string" ? model : model.id))).toEqual([
      "agnes-3.0-flash",
      "agnes-2.5-flash",
    ]);
    expect(findProvider("dots")?.models[0]).toEqual({ id: "dots3-note-prev", vision: true });
    expect(findProvider("yosei-router")?.hideEndpoint).toBe(true);
    expect(findProvider("agnes")?.hideModel).toBe(true);
    expect(findProvider("dots")?.hideModel).toBe(true);
    expect(findProvider("openai")?.hideEndpoint).toBe(true);
    expect(findProvider("openai")?.models[0]).toEqual({ id: "gpt-6-luna", vision: true });
  });

  it("定死的预设忽略用户以前填过的地址和模型名", () => {
    expect(
      presetChat({ providerId: "agnes", model: "别的模型", baseURL: "https://example.com/v1" }),
    ).toEqual({ model: "agnes-3.0-flash", baseURL: "", vision: true });
    expect(
      presetChat({ providerId: "openai", model: "gpt-5-mini", baseURL: "https://example.com/v1" }),
    ).toEqual({ model: "gpt-6-luna", baseURL: "", vision: true });
    expect(
      presetChat({ providerId: "deepseek", model: "deepseek-chat", baseURL: "https://example.com/v1" }).baseURL,
    ).toBe("https://example.com/v1");
  });

  it("Agnes 的生图模型沿用它自己的地址，不借用对话提供商的自定义地址", () => {
    expect(imageProviderForModel("agnes-image-2.5-flash")?.id).toBe("agnes");
    expect(imageProviderForModel("gpt-image-2.5")?.id).toBe("openai");
    expect(imageProviderForModel("不存在的模型")).toBeUndefined();
    const resolved = resolveBaseURL("agnes");
    expect("baseURL" in resolved && resolved.baseURL).toBe("https://apihub.agnes-ai.com/v1");
  });
});
