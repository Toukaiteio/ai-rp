import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "./validate";
import { CardTranslationError, parseTranslationDictionary, translateCharacterCard, type CardTranslationCheckpoint,
  type CardTranslationProgress } from "./translate";
import { splitTranslationText } from "./translation-segments";
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
  it.each(["{}", '{"a":"ok","b":"extra"}', '{"a":1}', '{"a":""}', "[]", "null", 'before\n```json\n{"a":"hi"}\n```', '{"a":'])
    ("rejects invalid dictionary %s", (text) => {
      expect(() => parseTranslationDictionary(text, { a: "hello" })).toThrowError(CardTranslationError);
    });
  it("requires exact ordered macros and tags, including speaker attributes", () => {
    const source = { a: '<dlg who="Alice">{{char}} {{user}}</dlg>' };
    for (const a of ['<dlg who="艾丽丝">{{char}} {{user}}</dlg>', '<dlg who="Alice">{{user}} {{char}}</dlg>', "plain"]) {
      expect(() => parseTranslationDictionary(JSON.stringify({ a }), source)).toThrow();
    }
    expect(parseTranslationDictionary(JSON.stringify(source), source)).toEqual(source);
  });
  it.each(["json", "JSON", ""])("accepts a complete pure %s code fence", (language) => {
    expect(parseTranslationDictionary(` \n\`\`\`${language}\n{"a":"hi"}\n\`\`\`\n`, { a: "hello" })).toEqual({ a: "hi" });
  });
  it.each([
    ['{"a":"cut', "json_truncated"], ["broken", "invalid_json"], ["{}", "missing_fields"],
    ['{"a":"plain"}', "protected_tokens"], ['{"a":"hi","extra":"hi"}', "unexpected_fields"],
  ])("reports a safe validation reason for %s", (text, reason) => {
    expect(() => parseTranslationDictionary(text, { a: "{{char}} hello" })).toThrowError(
      expect.objectContaining({ details: { reason } }));
  });
});

describe("translation segmentation", () => {
  it("prefers paragraph, then sentence, then word boundaries and retains every character", () => {
    expect(splitTranslationText("First.\n\nSecond sentence. Last", 24)).toEqual(["First.\n\n", "Second sentence. Last"]);
    expect(splitTranslationText("First sentence. Second phrase", 22)).toEqual(["First sentence. ", "Second phrase"]);
    expect(splitTranslationText("alpha beta gamma", 12)).toEqual(["alpha beta ", "gamma"]);
    const text = "😀".repeat(10) + '{{a sentence. and\n\nmacro}}<dlg who="a b">Text</dlg>';
    const parts = splitTranslationText(text, 7);
    expect(parts.join("")).toBe(text);
    expect(parts).toContain("{{a sentence. and\n\nmacro}}");
    expect(parts).toContain('<dlg who="a b">');
    expect(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
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
    expect(JSON.parse(String(init?.body))).toMatchObject({ mode: "complete", model: "test-model", reasoningEffort: "low" });
    expect(JSON.parse(String(init?.body)).maxTokens).toBeLessThanOrEqual(4096);
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
  it.each([["length", "output_limit"], ["content_filter", "content_filter"], ["tool_calls", "unexpected_finish_reason"]])("rejects incomplete finish reason %s", async (reason, detail) => {
    fetchMock.mockResolvedValue(sse("{}", reason));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_incomplete", details: { reason: detail } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires the terminal SSE frame", async () => {
    fetchMock.mockResolvedValue(sse("{}", "stop", false));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({ code: "translation_incomplete", details: { reason: "stream_interrupted" } });
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
  it("preserves boundary whitespace and emits actual streamed and validated progress", async () => {
    const original = createEmptyCard();
    original.data.description = ` \n${"First sentence. ".repeat(120)}\n\n{{char}}<narr>Last</narr>\t `;
    const events: CardTranslationProgress[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      const source = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      const json = JSON.stringify(source);
      const middle = Math.floor(json.length / 2);
      return new Response(encodeSseFrame({ type: "delta", text: json.slice(0, middle) })
        + encodeSseFrame({ type: "delta", text: json.slice(middle) })
        + encodeSseFrame({ type: "done", finishReason: "stop" }) + encodeSseFrame("[DONE]"));
    });
    const result = await translateCharacterCard(original, "zh", config(), { onProgress: (event) => events.push(event) });
    expect(result).toEqual(original);
    expect(events[0].phase).toBe("preparing");
    expect(events.some((event) => event.phase === "translating" && event.completed === 0 && event.receivedCharacters > 0)).toBe(true);
    expect(events.some((event) => event.phase === "validating" && event.completed === 0)).toBe(true);
    const final = events.at(-1)!;
    expect(final.phase).toBe("complete");
    expect(final.completed).toBe(final.total);
    expect(final.total).toBeGreaterThan(1);
    expect(final.completedCharacters).toBe(original.data.description.length);
    expect(final.totalCharacters).toBe(final.completedCharacters);
    expect(final.receivedCharacters).toBeGreaterThan(0);
    expect(events.every((event, index) => event.field === "description" && (!index
      || event.completed >= events[index - 1].completed && event.receivedCharacters >= events[index - 1].receivedCharacters))).toBe(true);
  });
  it("manually resumes verified segments without paying for them again, including after API key replacement", async () => {
    const original = createEmptyCard();
    original.data.description = "word ".repeat(1000);
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    let calls = 0;
    fetchMock.mockImplementation(async (url, init) => ++calls === 1 ? success(url, init) : sse("{}", "length"));
    await expect(translateCharacterCard(original, "zh", config(), { checkpoint })).rejects.toMatchObject({
      code: "translation_incomplete", details: { reason: "output_limit", completed: 1 },
    });
    const verified = Object.keys(checkpoint.translations);
    expect(verified).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(checkpoint)).not.toContain("sk-test");
    fetchMock.mockClear();
    successfulRequests();
    const resumed = await translateCharacterCard(original, "zh", { ...config(), apiKey: "sk-replaced" }, { checkpoint });
    expect(resumed.data.description.replaceAll("译", "")).toBe(original.data.description);
    for (const [, init] of fetchMock.mock.calls) {
      const source = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      expect(Object.keys(source).some((key) => verified.includes(key))).toBe(false);
    }
    fetchMock.mockClear();
    expect(await translateCharacterCard(original, "zh", config(), { checkpoint })).toEqual(resumed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["source", "locale", "provider", "model", "baseURL"])("clears checkpoint when %s changes", async (change) => {
    successfulRequests();
    const original = createEmptyCard();
    original.data.description = "Original";
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    await translateCharacterCard(original, "zh", config(), { checkpoint });
    const signature = checkpoint.signature;
    const next = config();
    if (change === "source") original.data.description = "Changed";
    if (change === "provider") { next.providerId = "custom"; next.baseURL = "https://example.com/v1"; }
    if (change === "model") next.model = "different-model";
    if (change === "baseURL") next.baseURL = "https://example.com/v1";
    checkpoint.translations.orphan = "must clear";
    fetchMock.mockClear();
    await translateCharacterCard(original, change === "locale" ? "en" : "zh", next, { checkpoint });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkpoint.signature).not.toBe(signature);
    expect(checkpoint.translations).not.toHaveProperty("orphan");
  });
  it("retains verified checkpoint on cancellation and never caches unfinished output", async () => {
    const original = createEmptyCard();
    original.data.description = "word ".repeat(800);
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    const controller = new AbortController();
    successfulRequests();
    await expect(translateCharacterCard(original, "zh", config(), { checkpoint, signal: controller.signal,
      onProgress: (event) => { if (event.completed > 0) controller.abort(); },
    })).rejects.toMatchObject({ code: "translation_cancelled", details: { reason: "cancelled", completed: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(checkpoint.translations)).toHaveLength(1);
    fetchMock.mockClear();
    const result = await translateCharacterCard(original, "zh", config(), { checkpoint });
    expect(result.data.description.replaceAll("译", "")).toBe(original.data.description);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const empty: CardTranslationCheckpoint = { translations: {} };
    fetchMock.mockResolvedValue(sse('{"s0":"partial', "length"));
    await expect(translateCharacterCard(original, "zh", config(), { checkpoint: empty })).rejects.toMatchObject({
      details: { reason: "output_limit", completed: 0 },
    });
    expect(empty.translations).toEqual({});
  });
  it("distinguishes HTTP status and reader interruption without exposing upstream messages", async () => {
    fetchMock.mockResolvedValue(new Response("sk-secret unsafe upstream text", { status: 429 }));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({
      message: "translation_request_failed", details: { reason: "http_error", status: 429 },
    });
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.error(new Error("sk-secret unsafe upstream text"));
    } })));
    await expect(translateCharacterCard(card(), "zh", config())).rejects.toMatchObject({
      message: "translation_incomplete", details: { reason: "stream_interrupted", completed: 0 },
    });
  });
  it("keeps batches within one field so progress identifies the actual failure", async () => {
    const original = createEmptyCard();
    original.data.description = "Description only";
    original.data.personality = "Personality only";
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    let calls = 0;
    fetchMock.mockImplementation(async (url, init) => ++calls === 1 ? success(url, init) : sse("{}", "content_filter"));
    await expect(translateCharacterCard(original, "zh", config())).rejects.toMatchObject({
      details: { reason: "content_filter", field: "personality", completed: 1, total: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
