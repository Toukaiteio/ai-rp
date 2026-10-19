import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "./validate";
import { CardTranslationError, parseTranslationDictionary, translateCharacterCard } from "./translate";
import { defaultProviderConfig } from "@/lib/providers/settings";
import { probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { encodeSseFrame } from "@/lib/wire";

vi.mock("@/lib/browser-model", () => ({
  BROWSER_PROVIDER_ID: "browser", probeBrowserModel: vi.fn(), streamBrowserChat: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();
const config = () => ({ ...defaultProviderConfig(), apiKey: " sk-test\n", model: "test-model" });
function card() {
  const result = createEmptyCard();
  Object.assign(result.data, { name: "Alice", description: "A scholar {{char}}", personality: "Quiet", scenario: "Library",
    first_mes: '<dlg who="Alice">Hello {{user}}</dlg>', mes_example: "<START>Hello", system_prompt: "Stay in character",
    post_history_instructions: "Write briefly", author_note: "Slow pace", alternate_greetings: ["Welcome", ""],
    creator: "Author", tags: ["English"], extensions: { avatar: "data:image/png;base64,abc", custom: { secret: true } },
    character_book: { name: "World", tokenCap: 300, entries: [
      { keys: ["library"], content: "Many books", probability: 50, enabled: false },
      { keys: ["a", "b"], content: "Both needed", logic: "and" },
    ] },
    voice: { sentenceLength: "short", directness: "direct", emotionalExpression: "open",
      vocabulary: ["Indeed"], habits: ["Pauses"], avoidances: ["Curses"], sampleLines: ["Hello"] },
  });
  return result;
}
function sse(text: string, finishReason = "stop", end = true) {
  const data = encodeSseFrame({ type: "delta", text }) + encodeSseFrame({ type: "done", finishReason }) + (end ? encodeSseFrame("[DONE]") : "");
  const bytes = new TextEncoder().encode(data);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }));
}
function successfulRequests() {
  fetchMock.mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const source = JSON.parse(request.messages[1].content);
    return sse(JSON.stringify(Object.fromEntries(Object.entries(source).map(([key, value]) => [key, `译${value}`]))));
  });
}

beforeEach(() => {
  vi.mocked(probeBrowserModel).mockResolvedValue(false);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("translation response validation", () => {
  it.each(["{}", '{"a":"ok","b":"extra"}', '{"a":1}', '{"a":""}', "[]", "null", '```json\n{"a":"hi"}\n```', '{"a":'])
    ("rejects invalid dictionary %s", (text) => {
      expect(() => parseTranslationDictionary(text, { a: "hello" })).toThrowError(new CardTranslationError("translation_invalid_response"));
    });
  it("requires exact ordered macros and tags, including speaker attributes", () => {
    const source = { a: '<dlg who="Alice">{{char}} {{user}}</dlg>' };
    for (const a of ['<dlg who="艾丽丝">{{char}} {{user}}</dlg>', '<dlg who="Alice">{{user}} {{char}}</dlg>', "plain"]) {
      expect(() => parseTranslationDictionary(JSON.stringify({ a }), source)).toThrow();
    }
    expect(parseTranslationDictionary(JSON.stringify(source), source)).toEqual(source);
  });
});

describe("translateCharacterCard", () => {
  it("translates all supported text while retaining metadata and leaving the source untouched", async () => {
    successfulRequests();
    const original = card();
    const snapshot = structuredClone(original);
    const result = await translateCharacterCard(original, "zh", config());
    expect(original).toEqual(snapshot);
    expect(result.data.description).toBe("译A scholar {{char}}");
    expect(result.data.first_mes).toBe('译<dlg who="Alice">Hello {{user}}</dlg>');
    for (const field of ["personality", "scenario", "mes_example", "system_prompt", "post_history_instructions", "author_note"] as const) {
      expect(result.data[field]).toBe(`译${original.data[field]}`);
    }
    expect(result.data.alternate_greetings).toEqual(["译Welcome", ""]);
    expect(result.data.character_book).toEqual({ name: "译World", tokenCap: 300, entries: [
      { keys: ["library", "译library"], content: "译Many books", probability: 50, enabled: false },
      { keys: ["a", "b"], content: "译Both needed", logic: "and" },
    ] });
    expect(result.data.voice).toEqual({ ...original.data.voice, vocabulary: ["译Indeed"], habits: ["译Pauses"], avoidances: ["译Curses"], sampleLines: ["译Hello"] });
    for (const field of ["name", "creator", "extensions", "tags"] as const) expect(result.data[field]).toEqual(original.data[field]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ mode: "complete", model: "test-model" });
    expect(String(init?.body)).not.toContain("sk-test");
  });
  it("splits a large field and completes multiple batches without splitting markers", async () => {
    successfulRequests();
    const original = card();
    original.data.description = "x".repeat(1597) + "{{char}}<narr>" + "y".repeat(7000) + "</narr>";
    const result = await translateCharacterCard(original, "en", config());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    expect(result.data.description.replaceAll("译", "")).toBe(original.data.description);
  });
  it("rejects missing configuration without requesting a model", async () => {
    await expect(translateCharacterCard(card(), "zh", { ...config(), apiKey: "中文" })).rejects.toMatchObject({ code: "translation_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["length", "content_filter", "tool_calls"])("rejects incomplete finish reason %s", async (reason) => {
    fetchMock.mockResolvedValue(sse("{}", reason));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_incomplete" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires the terminal SSE frame", async () => {
    fetchMock.mockResolvedValue(sse("{}", "stop", false));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_incomplete" });
  });
  it("rejects malformed SSE frames even when the dictionary is otherwise complete", async () => {
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const response = await success(url, init);
      return new Response(`data: not-json\n\n${await response.text()}`);
    });
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
  });
  it("leaves the original card intact when a later batch fails", async () => {
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    let calls = 0;
    fetchMock.mockImplementation(async (url, init) => ++calls === 1 ? success(url, init) : sse("{}"));
    const original = card();
    original.data.description = "a".repeat(7000);
    const snapshot = structuredClone(original);
    await expect(translateCharacterCard(original, "zh", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
    expect(original).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["http", "network", "event"])("redacts %s errors without retries", async (failure) => {
    if (failure === "http") fetchMock.mockResolvedValue(new Response("sk-secret upstream payload", { status: 500 }));
    if (failure === "network") fetchMock.mockRejectedValue(new Error("sk-secret upstream payload"));
    if (failure === "event") fetchMock.mockResolvedValue(new Response(encodeSseFrame({ type: "error", message: "sk-secret upstream payload" })));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_request_failed", message: "translation_request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid JSON and does not retry", async () => {
    fetchMock.mockResolvedValue(sse("broken"));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels before requests and during an unending stream", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateCharacterCard(card(), "zh", config(), { signal: controller.signal })).rejects.toMatchObject({ code: "translation_cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    const during = new AbortController();
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({ start() { setTimeout(() => during.abort(), 0); } })));
    await expect(translateCharacterCard(card(), "zh", config(), { signal: during.signal })).rejects.toMatchObject({ code: "translation_cancelled" });
  });
  it("uses the configured browser model without a remote request", async () => {
    vi.mocked(probeBrowserModel).mockResolvedValue(true);
    vi.mocked(streamBrowserChat).mockImplementation(async (args) => { args.onDelta(args.messages[1].content); });
    const original = card();
    expect(await translateCharacterCard(original, "en", { ...config(), providerId: "browser", apiKey: "" })).toEqual(original);
    expect(streamBrowserChat).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
