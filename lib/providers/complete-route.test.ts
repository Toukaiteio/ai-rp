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

  it.each(["extreme", 5, null])("rejects unsupported reasoning effort %s", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(open).not.toHaveBeenCalled();
  });
});
