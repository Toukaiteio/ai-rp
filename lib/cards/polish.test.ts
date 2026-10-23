import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "./validate";
import { polishCardField } from "./polish";
import { defaultProviderConfig } from "@/lib/providers/settings";
import { probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { encodeSseFrame } from "@/lib/wire";

vi.mock("@/lib/browser-model", () => ({
  BROWSER_PROVIDER_ID: "browser",
  probeBrowserModel: vi.fn(),
  streamBrowserChat: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.mocked(probeBrowserModel).mockResolvedValue(false);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function sse(text: string): Response {
  const payload = encodeSseFrame({ type: "delta", text }) + encodeSseFrame({ type: "done", finishReason: "stop" }) + encodeSseFrame("[DONE]");
  return new Response(payload);
}

describe("polishCardField", () => {
  it("uses the existing complete API and keeps the polish prompt scoped to one field", async () => {
    fetchMock.mockResolvedValue(sse("润色后的简介"));
    const card = createEmptyCard("Alice");
    const config = { ...defaultProviderConfig(), providerId: "custom", model: "test-model", baseURL: "https://provider.example/v1", apiKey: "sk-test" };
    const result = await polishCardField(card, "description", "Alice 是一名学者。", { config });
    expect(result).toBe("润色后的简介");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.mode).toBe("complete");
    expect(request.messages[0].content).toContain("只润色用户提供的字段");
    expect(request.messages[1].content).toContain("Alice 是一名学者");
  });

  it("supports the browser model path without sending a remote request", async () => {
    vi.mocked(probeBrowserModel).mockResolvedValue(true);
    vi.mocked(streamBrowserChat).mockImplementation(async ({ onDelta }) => onDelta("本机润色"));
    const result = await polishCardField(createEmptyCard("Alice"), "personality", "安静", { config: defaultProviderConfig() });
    expect(result).toBe("本机润色");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
