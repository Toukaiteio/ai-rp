import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "./index";
import { createResponsesProvider } from "./responses";
import type { ChatRequest } from "./types";

const openaiMock = vi.hoisted(() => ({
  create: vi.fn(),
  constructors: [] as unknown[],
}));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    responses = { create: openaiMock.create };

    constructor(options: unknown) {
      openaiMock.constructors.push(options);
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
    model: "gpt-test",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

describe("OpenAI Responses provider", () => {
  beforeEach(() => {
    openaiMock.create.mockReset();
    openaiMock.constructors.length = 0;
  });

  it("keeps system messages in the input order and maps tools to flat function tools", async () => {
    openaiMock.create.mockResolvedValue(fakeStream([]));
    const signal = new AbortController().signal;
    const provider = createResponsesProvider({
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    await provider.open(request({
      messages: [
        { role: "system", content: "Rule one" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Describe this image" },
      ],
      temperature: 0.4,
      maxTokens: 2048,
      reasoningEffort: "low",
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

    expect(openaiMock.create).toHaveBeenCalledWith({
      model: "gpt-test",
      input: [
        { role: "system", content: "Rule one" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Describe this image" },
      ],
      stream: true,
      store: false,
      max_output_tokens: 2048,
      reasoning: { effort: "low" },
      temperature: 0.4,
      tools: [{
        type: "function",
        name: "lookup_weather",
        description: "Look up weather",
        parameters: {
          properties: { city: { type: "string" } },
          required: ["city"],
        },
        strict: false,
      }],
    }, { signal });
  });

  it("attaches the image to the last user message as input parts", async () => {
    openaiMock.create.mockResolvedValue(fakeStream([]));
    const provider = createResponsesProvider({
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    await provider.open(request({
      messages: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "Describe this image" },
      ],
      image: "data:image/png;base64,AAEC",
    }));

    const createArgs = openaiMock.create.mock.calls[0][0] as {
      input: Array<{ role: string; content: unknown }>;
    };
    expect(createArgs.input[0]).toEqual({ role: "user", content: "earlier" });
    expect(createArgs.input[2]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "Describe this image" },
        { type: "input_image", image_url: "data:image/png;base64,AAEC", detail: "auto" },
      ],
    });
  });

  it("converts text and function-call stream events, preserving the finish reason", async () => {
    openaiMock.create.mockResolvedValue(fakeStream([
      {
        type: "response.output_text.delta",
        delta: "The answer is ",
      },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", call_id: "call-1", id: "item-1", name: "lookup_weather" },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        delta: '{"city"',
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        delta: ':"Paris"}',
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ type: "function_call", call_id: "call-1", name: "lookup_weather", arguments: "{}" }],
        },
      },
    ]));
    const provider = createResponsesProvider({
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    const stream = await provider.open(request());

    await expect(collect(stream)).resolves.toEqual([
      { type: "delta", text: "The answer is " },
      { type: "tool", index: 1, id: "call-1", name: "lookup_weather" },
      { type: "tool", index: 1, arguments: '{"city"' },
      { type: "tool", index: 1, arguments: ':"Paris"}' },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it("emits stop when the response completes without tool calls", async () => {
    openaiMock.create.mockResolvedValue(fakeStream([
      { type: "response.output_text.delta", delta: "Done" },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ]));
    const provider = createResponsesProvider({
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    const stream = await provider.open(request());

    await expect(collect(stream)).resolves.toEqual([
      { type: "delta", text: "Done" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("turns failed and incomplete responses into error / truncated done events", async () => {
    const provider = createResponsesProvider({
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    openaiMock.create.mockResolvedValue(fakeStream([
      {
        type: "response.failed",
        response: { status: "failed", error: { message: "boom" } },
      },
    ]));
    await expect(collect((await provider.open(request())))).resolves.toEqual([
      { type: "error", message: "boom" },
      { type: "done", finishReason: "failed" },
    ]);

    openaiMock.create.mockResolvedValue(fakeStream([
      {
        type: "response.incomplete",
        response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
      },
    ]));
    await expect(collect((await provider.open(request())))).resolves.toEqual([
      { type: "done", finishReason: "max_output_tokens" },
    ]);

    openaiMock.create.mockResolvedValue(fakeStream([
      { type: "error", code: "server_error", message: "overloaded", param: null, sequence_number: 1 },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ]));
    await expect(collect((await provider.open(request())))).resolves.toEqual([
      { type: "error", message: "overloaded" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});

describe("getProvider Responses routing", () => {
  beforeEach(() => {
    openaiMock.create.mockReset();
    openaiMock.constructors.length = 0;
  });

  it("routes a custom provider to Responses when the interface type asks for it", () => {
    const provider = getProvider({
      providerId: "custom",
      interfaceType: "openai-responses",
      apiKey: "sk-test",
      baseURL: "https://api.openai.example/v1",
    });

    expect(provider.id).toBe("openai-responses");
    expect(provider.name).toBe("Responses · api.openai.example");
  });
});
