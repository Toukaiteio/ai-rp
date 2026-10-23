import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { getProvider, type ChatStreamEvent } from "@/lib/providers";

vi.mock("@/lib/providers", async (importOriginal) => ({
  ...await importOriginal<object>(), getProvider: vi.fn(),
}));

const open = vi.fn();
function request(reasoningEffort?: unknown) {
  return new Request("https://app.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-offline-test" },
    body: JSON.stringify({ mode: "complete", providerId: "custom", model: "test-model",
      baseURL: "https://provider.example/v1", messages: [{ role: "user", content: "translate" }],
      maxTokens: 4096, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }),
  });
}

describe("complete route translation parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProvider).mockReturnValue({ id: "test", name: "test", open });
    open.mockImplementation(async () => (async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: "delta", text: "{}" };
      yield { type: "done", finishReason: "stop" };
    })());
  });

  it("forwards low reasoning and disables automatic retries for translation", async () => {
    const response = await POST(request("low"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("[DONE]");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: "low", maxTokens: 4096 }));
    expect(getProvider).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it("preserves the default for other complete requests", async () => {
    const response = await POST(request());
    await response.text();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: undefined }));
    expect(getProvider).not.toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it("forwards the selected interface type to the provider adapter", async () => {
    const response = await POST(new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-offline-test" },
      body: JSON.stringify({
        mode: "complete",
        providerId: "custom",
        interfaceType: "anthropic-messages",
        model: "claude-test",
        baseURL: "https://provider.example/v1",
        messages: [{ role: "user", content: "hello" }],
      }),
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(getProvider).toHaveBeenCalledWith(
      expect.objectContaining({ interfaceType: "anthropic-messages" }),
    );
  });

  it.each(["extreme", 5, null])("rejects unsupported reasoning effort %s", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(open).not.toHaveBeenCalled();
  });
  it("preserves card macro context in the server fallback", async () => {
    const response = await POST(new Request("https://app.example/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-offline-test" },
      body: JSON.stringify({ providerId: "custom", model: "test-model", baseURL: "https://provider.example/v1", tools: false,
        context: { card: { name: "Alice", description: "{{charFirstMessage::1}} / {{charVersion}} / {{charDepthPrompt}} / {{charCreatorNotes}}",
          personality: "", scenario: "", first_mes: "Hello {{user}}", alternate_greetings: ["Welcome {{user}}"], character_version: "v2",
          extensions: { depth_prompt: { prompt: "Depth {{char}}" }, _unmapped: { creator_notes: "Notes {{char}}" } } },
          userName: "Bob", history: [{ role: "user", content: "Hello" }], seed: 1 },
      }),
    }));
    expect(response.status).toBe(200);
    await response.text();
    const messages = open.mock.calls.at(-1)![0].messages as { content: string }[];
    expect(messages.some((message) => message.content.includes("Welcome Bob / v2 / Depth Alice / Notes Alice"))).toBe(true);
  });

  it("registers attachment tools on the assembled chat request", async () => {
    const response = await POST(new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-offline-test" },
      body: JSON.stringify({
        providerId: "custom",
        model: "test-model",
        baseURL: "https://provider.example/v1",
        context: {
          card: {
            name: "Alice",
            description: "",
            personality: "",
            scenario: "",
            first_mes: "Hello",
            attachments: [{
              id: "script-1",
              kind: "script",
              source: "globalThis.secret = true",
              requestedPermissions: { network: true, filesystem: true, cardScope: true },
            }],
          },
          history: [{ role: "user", content: "查看附件" }],
          seed: 1,
        },
      }),
    }));
    expect(response.status).toBe(200);
    await response.text();
    const finalRequest = open.mock.calls.at(-1)![0] as { tools?: Array<{ function: { name: string } }> };
    expect(finalRequest.tools?.map((tool) => tool.function.name)).toContain("attachment_query");
    expect(finalRequest.tools?.map((tool) => tool.function.name)).toContain("attachment_update");
  });

  it("retries the director stage when a browser fallback has no valid plan", async () => {
    const response = await POST(new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-offline-test" },
      body: JSON.stringify({
        providerId: "custom",
        model: "test-model",
        baseURL: "https://provider.example/v1",
        planning: false,
        tools: false,
        context: {
          card: { name: "Alice", description: "", personality: "", scenario: "" },
          history: [{ role: "user", content: "继续" }],
          seed: 1,
        },
      }),
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][0]).toEqual(expect.objectContaining({
      maxTokens: 700,
      reasoningEffort: "low",
    }));
  });
});
