import { describe, expect, it } from "vitest";
import {
  findInterfaceType,
  findProvider,
  imageProviderForModel,
  listProviders,
  presetChat,
  resolveInterfaceType,
} from "./config";
import { DEFAULT_USER_NAME, defaultProviderConfig, nextCustomProviderId, normalizeUserName, withImage } from "./settings";
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

  it("Anthropic 预设走官方 Messages 地址并允许用户填写模型", () => {
    expect(findProvider("anthropic")).toMatchObject({
      baseURL: "https://api.anthropic.com",
      interfaceType: "anthropic-messages",
      models: [],
      hideEndpoint: true,
    });
    expect(findInterfaceType("anthropic-messages")?.enabled).toBe(true);
  });

  it("预设锁死协议，自定义提供商可以选已启用的协议", () => {
    expect(resolveInterfaceType("anthropic")).toBe("anthropic-messages");
    expect(resolveInterfaceType("yosei-router", "anthropic-messages")).toBe("chat-completions");
    expect(resolveInterfaceType("custom", "anthropic-messages")).toBe("anthropic-messages");
    expect(resolveInterfaceType("custom", "openai-responses")).toBe("openai-responses");
    expect(resolveInterfaceType("custom")).toBe("chat-completions");
  });

  it("旧存档按提供商补齐协议，自定义保留用户选择", () => {
    expect(withImage({ providerId: "anthropic", model: "claude-test" }).interfaceType).toBe(
      "anthropic-messages",
    );
    expect(
      withImage({ providerId: "custom", interfaceType: "anthropic-messages" }).interfaceType,
    ).toBe("anthropic-messages");
    expect(withImage({ providerId: "custom" }).interfaceType).toBe("chat-completions");
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
    expect(defaultProviderConfig().encodeUserMessageWords).toBe(false);
    expect(defaultProviderConfig().reasoningEnabled).toBe(false);
    expect(defaultProviderConfig().reasoningEffort).toBe("high");
    expect(withImage({ providerId: "openai", model: "gpt-6-luna" }).userName).toBe(DEFAULT_USER_NAME);
    expect(withImage({}).encodeUserMessageWords).toBe(false);
    expect(withImage({ userName: "  Lin  " }).userName).toBe("Lin");
    expect(normalizeUserName("   ")).toBe(DEFAULT_USER_NAME);
  });

  it("推理设置默认关闭，旧值归一化为 high，并保留合法档位", () => {
    expect(withImage({}).reasoningEnabled).toBe(false);
    expect(withImage({ reasoningEnabled: true, reasoningEffort: "xhigh" }).reasoningEffort).toBe("xhigh");
    expect(withImage({ reasoningEnabled: true, reasoningEffort: "invalid" as never }).reasoningEffort).toBe("high");
  });

  it("Agnes 的生图模型沿用它自己的地址，不借用对话提供商的自定义地址", () => {
    expect(imageProviderForModel("agnes-image-2.5-flash")?.id).toBe("agnes");
    expect(imageProviderForModel("gpt-image-2.5")?.id).toBe("openai");
    expect(imageProviderForModel("不存在的模型")).toBeUndefined();
    const resolved = resolveBaseURL("agnes");
    expect("baseURL" in resolved && resolved.baseURL).toBe("https://apihub.agnes-ai.com/v1");
  });

  it("旧存档的「自定义」槽位迁移成可保存的提供商条目，且幂等", () => {
    const migrated = withImage({
      providerId: "custom",
      interfaceType: "anthropic-messages",
      model: "my-model",
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      vision: true,
    });
    expect(migrated.customProviders).toEqual([
      {
        id: "custom",
        name: "",
        interfaceType: "anthropic-messages",
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: ["my-model"],
        vision: true,
      },
    ]);
    expect(withImage(migrated).customProviders).toHaveLength(1);
  });

  it("选中的自定义条目跟着顶层字段回写，模型列表不被逐字输入污染", () => {
    const base = withImage({
      providerId: "custom",
      model: "m1",
      baseURL: "https://api.example.com/v1",
    });
    const edited = withImage({
      ...base,
      model: "m2-ha",
      baseURL: "https://other.example.com/v1",
      apiKey: "sk-new",
    });
    expect(edited.customProviders?.find((item) => item.id === "custom")).toMatchObject({
      baseURL: "https://other.example.com/v1",
      apiKey: "sk-new",
      models: ["m1"],
    });
  });

  it("没有自定义条目的存档补空列表，切到预设后条目原样保留", () => {
    expect(withImage({}).customProviders).toEqual([]);
    const withDef = withImage({
      providerId: "custom",
      model: "m1",
      baseURL: "https://api.example.com/v1",
    });
    const switched = withImage({
      ...withDef,
      providerId: "deepseek",
      model: "deepseek-chat",
      baseURL: "",
    });
    expect(switched.customProviders?.[0]).toMatchObject({
      id: "custom",
      baseURL: "https://api.example.com/v1",
      models: ["m1"],
    });
  });

  it("新建自定义提供商的 id 避开已用 id 和预设 id", () => {
    const def = (id: string) => ({
      id,
      name: "",
      interfaceType: "chat-completions",
      baseURL: "",
      apiKey: "",
      models: [],
      vision: false,
    });
    expect(nextCustomProviderId([])).toBe("custom");
    expect(nextCustomProviderId([def("custom")])).toBe("custom-2");
    expect(nextCustomProviderId([def("custom"), def("custom-2")])).toBe("custom-3");
  });
});
