import { describe, expect, it } from "vitest";
import { findProvider, imageProviderForModel, listProviders, presetChat } from "./config";
import { DEFAULT_USER_NAME, defaultProviderConfig, normalizeUserName, withImage } from "./settings";
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
    expect(findProvider("yosei-router")?.models[0]).toEqual({ id: "dots3-note-prev", vision: true });
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

  it("把旧的 YoseiRouter 模型配置迁移到首选视觉模型", () => {
    expect(
      withImage({
        providerId: "yosei-router",
        model: "deepseek-v4-flash-200k",
        vision: false,
      }),
    ).toMatchObject({
      providerId: "yosei-router",
      model: "dots3-note-prev",
      vision: true,
    });
  });

  it("旧配置缺少用户名时使用安全默认值，并清理空白用户名", () => {
    expect(defaultProviderConfig().userName).toBe(DEFAULT_USER_NAME);
    expect(withImage({ providerId: "openai", model: "gpt-6-luna" }).userName).toBe(DEFAULT_USER_NAME);
    expect(withImage({ userName: "  Lin  " }).userName).toBe("Lin");
    expect(normalizeUserName("   ")).toBe(DEFAULT_USER_NAME);
  });

  it("Agnes 的生图模型沿用它自己的地址，不借用对话提供商的自定义地址", () => {
    expect(imageProviderForModel("agnes-image-2.5-flash")?.id).toBe("agnes");
    expect(imageProviderForModel("gpt-image-2.5")?.id).toBe("openai");
    expect(imageProviderForModel("不存在的模型")).toBeUndefined();
    const resolved = resolveBaseURL("agnes");
    expect("baseURL" in resolved && resolved.baseURL).toBe("https://apihub.agnes-ai.com/v1");
  });
});
