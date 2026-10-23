import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "./index";
import { createAnthropicProvider } from "./anthropic";
import type { ChatRequest } from "./types";

const anthropicMock = vi.hoisted(() => ({
  create: vi.fn(),
  constructors: [] as unknown[],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: anthropicMock.create };

    constructor(options: unknown) {
      anthropicMock.constructors.push(options);
    }
  },
}));

function fakeStream(events: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    yield* events;
  })();
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: "claude-test",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

describe("Anthropic Messages provider", () => {
  beforeEach(() => {
    anthropicMock.create.mockReset();
    anthropicMock.constructors.length = 0;
  });

  it("strips a trailing /v1 because the SDK appends /v1/messages itself", () => {
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1/",
    });

    expect(anthropicMock.constructors[0]).toMatchObject({
      baseURL: "https://api.anthropic.example",
    });
    expect(provider.name).toBe("Messages · api.anthropic.example");
  });

  it("extracts system messages and maps text, images, and tools to the Messages request", async () => {
    anthropicMock.create.mockResolvedValue(fakeStream([]));
    const signal = new AbortController().signal;
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1",
    });

    await provider.open(request({
      messages: [
        { role: "system", content: "Rule one" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Describe this image" },
      ],
      temperature: 0.4,
      maxTokens: 2048,
      image: "data:image/png;base64,AAEC",
      signal,
      tools: [{
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Look up weather",
          parameters: {
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      }],
    }));

    expect(anthropicMock.create).toHaveBeenCalledWith({
      model: "claude-test",
      max_tokens: 2048,
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAEC" },
            },
          ],
        },
      ],
      stream: true,
      system: "Rule one",
      temperature: 0.4,
      tools: [{
        name: "lookup_weather",
        description: "Look up weather",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      }],
    }, { signal });
  });

  it("converts text and tool-use stream events, preserving stop_reason", async () => {
    anthropicMock.create.mockResolvedValue(fakeStream([
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "The answer is " },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tool-1", name: "lookup_weather" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"city"' },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: ':"Paris"}' },
      },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ]));
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1",
    });

    const stream = await provider.open(request());

    await expect(collect(stream)).resolves.toEqual([
      { type: "delta", text: "The answer is " },
      { type: "tool", index: 0, id: "tool-1", name: "lookup_weather" },
      { type: "tool", index: 0, arguments: '{"city"' },
      { type: "tool", index: 0, arguments: ':"Paris"}' },
      { type: "done", finishReason: "tool_use" },
    ]);
  });

  it("emits a stop done event when a stream ends without stop_reason", async () => {
    anthropicMock.create.mockResolvedValue(fakeStream([
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Done" },
      },
    ]));
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1",
    });

    const stream = await provider.open(request());

    await expect(collect(stream)).resolves.toEqual([
      { type: "delta", text: "Done" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});

describe("getProvider Anthropic routing", () => {
  beforeEach(() => {
    anthropicMock.create.mockReset();
    anthropicMock.constructors.length = 0;
  });

  it("selects the Anthropic Messages adapter for providerId anthropic", () => {
    const provider = getProvider({
      providerId: "anthropic",
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1",
    });

    expect(provider.id).toBe("anthropic-messages");
    expect(provider.name).toBe("Messages · api.anthropic.example");
  });

  it("routes a custom provider to Messages when the interface type asks for it", () => {
    const provider = getProvider({
      providerId: "custom",
      interfaceType: "anthropic-messages",
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.example/v1",
    });

    expect(provider.id).toBe("anthropic-messages");
  });

  it("keeps a custom provider on Chat Completions by default", () => {
    const provider = getProvider({
      providerId: "custom",
      interfaceType: "chat-completions",
      apiKey: "sk-test",
      baseURL: "https://provider.example/v1",
    });

    expect(provider.id).toBe("openai-chat-completions");
  });
});
