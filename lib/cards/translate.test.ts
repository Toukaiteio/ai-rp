import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "./validate";
import { CardTranslationError, parseTranslationDictionary, translateCharacterCard, type CardTranslationCheckpoint,
  type CardTranslationProgress } from "./translate";
import { collectTranslationSegments, splitTranslationText } from "./translation-segments";
import settings from "@/data/card-translation.json";
import { resolveBaseURL } from "@/lib/providers/validate";
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
      expect.objectContaining({ details: expect.objectContaining({ reason }) }));
  });
});

describe("translation segmentation", () => {
  it("keeps the name in one first segment even beyond the normal segment limit", () => {
    const original = card();
    original.data.name = "Long name ".repeat(400);
    const segments = collectTranslationSegments(original);
    expect(segments[0]).toMatchObject({ field: "name", text: original.data.name.trim() });
    expect(segments.filter((segment) => segment.field === "name")).toHaveLength(1);
  });
  it("prefers paragraph, then sentence, then word boundaries and retains every character", () => {
    expect(splitTranslationText("First.\n\nSecond sentence. Last", 24)).toEqual(["First.\n\n", "Second sentence. Last"]);
    expect(splitTranslationText("First sentence. Second phrase", 22)).toEqual(["First sentence. ", "Second phrase"]);
    expect(splitTranslationText("alpha beta gamma", 12)).toEqual(["alpha beta ", "gamma"]);
    const text = "😀".repeat(10) + '{{a sentence. and\n\nmacro}}<dlg who="a b">Text</dlg>';
    const parts = splitTranslationText(text, 7);
    expect(parts.join("")).toBe(text);
    expect(parts).toContain("{{a sentence. and\n\nmacro}}");
    expect(parts).toContain('<dlg who="a b">');
    expect(splitTranslationText('<dlg title="a > b" who="Alice">Hello</dlg>', 7)).toContain('<dlg title="a > b" who="Alice">');
    expect(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
  });
});

describe("translateCharacterCard", () => {
  it("sends the whole card in one request with the fixed glossary in the system prompt", async () => {
    const original = card();
    original.data.description = "Alice knows Bob. ".repeat(300);
    fetchMock.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const source = JSON.parse(request.messages[1].content);
      // 名字和全部正文片段在同一个字典里，只发一次
      expect(source.s0).toBe("Alice");
      expect(Object.keys(source).length).toBeGreaterThan(5);
      expect(request.messages[0].content).toContain(settings.namePrompt);
      expect(request.messages[0].content).toContain(`Source character name: ${original.data.name}`);
      return sse(JSON.stringify(Object.fromEntries(Object.entries(source).map(([key, value]) =>
        [key, key === "s0" ? "艾丽丝" : String(value).replaceAll("Alice knows Bob", "艾丽丝认识 Bob")]))));
    });
    const result = await translateCharacterCard(original, "Simplified Chinese", config());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data.name).toBe("艾丽丝");
    expect(result.data.description).toBe("艾丽丝认识 Bob. ".repeat(300));
    expect(result.data.first_mes).toContain('who="艾丽丝"');
  });
  it("reports name validation failure and writes nothing else", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const source = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      return sse(JSON.stringify({ ...source, s0: "" }));
    });
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    await expect(translateCharacterCard(card(), "Simplified Chinese", config(), { checkpoint })).rejects.toMatchObject({
      code: "translation_invalid_response", details: { field: "name", completed: 0, reason: "invalid_value" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkpoint.translations).toEqual({});
  });
  it("rejects model-translated speaker attributes before local synchronization", async () => {
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const source = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      if (Object.values(source).some((value) => String(value).includes('who="Alice"'))) {
        return sse(JSON.stringify(Object.fromEntries(Object.entries(source).map(([key, value]) =>
          [key, String(value).replace('who="Alice"', 'who="译Alice"')]))));
      }
      return success(url, init);
    });
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({
      details: { field: "first_mes", reason: "protected_tokens" },
    });
  });
  it("retries the whole card after a mid-stream cancellation without caching anything", async () => {
    const original = card();
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    const controller = new AbortController();
    successfulRequests();
    await expect(translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint, signal: controller.signal,
      onProgress: (event) => { if (event.receivedCharacters > 0) controller.abort(); },
    })).rejects.toMatchObject({ code: "translation_cancelled", details: { completed: 0 } });
    expect(checkpoint.translations).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    const result = await translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint });
    expect(result.data.name).toBe("译Alice");
    expect(result.data.first_mes).toContain('who="译Alice"');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 重试的字典里再次包含名字，没有靠缓存跳过
    const source = JSON.parse(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[1].content);
    expect(source.s0).toBe("Alice");
  });
  it("invalidates checkpoints signed with the old settings schema", async () => {
    const original = card();
    const provider = config();
    const resolved = resolveBaseURL(provider.providerId, provider.baseURL);
    const oldSettings = { ...settings, schemaVersion: 1, fields: settings.fields.filter((field) => field !== "name") };
    const input = JSON.stringify([original, "zh", provider.providerId, provider.model.trim(),
      "baseURL" in resolved ? resolved.baseURL : provider.baseURL, false, oldSettings]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    const signature = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    const checkpoint = { signature, translations: { s0: "old description", orphan: "old" } };
    successfulRequests();
    const result = await translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint });
    expect(result.data.name).toBe("译Alice");
    expect(checkpoint.signature).not.toBe(signature);
    expect(checkpoint.translations).not.toHaveProperty("orphan");
    expect(JSON.parse(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[1].content)).toMatchObject({ s0: "Alice" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("translates all supported text while retaining metadata and leaving the source untouched", async () => {
    successfulRequests();
    const original = card();
    const snapshot = structuredClone(original);
    const result = await translateCharacterCard(original, "Simplified Chinese", config());
    expect(original).toEqual(snapshot);
    expect(result.data.description).toBe("译A scholar {{char}}");
    expect(result.data.first_mes).toBe('译<dlg who="译Alice">Hello {{user}}</dlg>');
    for (const field of ["personality", "scenario", "mes_example", "system_prompt", "post_history_instructions", "author_note"] as const) {
      expect(result.data[field]).toBe(`译${original.data[field]}`);
    }
    expect(result.data.alternate_greetings).toEqual(["译Welcome", ""]);
    expect(result.data.character_book).toEqual({ name: "译World", tokenCap: 300, entries: [
      { keys: ["library", "译library"], content: "译Many books", probability: 50, enabled: false },
      { keys: ["a", "b"], content: "译Both needed", logic: "and" },
    ] });
    expect(result.data.voice).toEqual({ ...original.data.voice, vocabulary: ["译Indeed"], habits: ["译Pauses"], avoidances: ["译Curses"], sampleLines: ["译Hello"] });
    expect(result.data.name).toBe("译Alice");
    for (const field of ["creator", "extensions", "tags"] as const) expect(result.data[field]).toEqual(original.data[field]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ mode: "complete", model: "test-model", reasoningEffort: "low" });
    // 小卡的输出下限：固定余量 + 每字 2 token 还不够 minTokens 时保底
    expect(JSON.parse(String(init?.body)).maxTokens).toBe(1024);
    expect(String(init?.body)).not.toContain("sk-test");
  });
  it("sends a large field as fragments inside the one request without splitting markers", async () => {
    successfulRequests();
    const original = card();
    original.data.description = "x".repeat(1597) + "{{char}}<narr>" + "y".repeat(7000) + "</narr>";
    const result = await translateCharacterCard(original, "English", config());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 大卡的输出上限跟着输入体量走，但仍在天花板内
    const maxTokens = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).maxTokens as number;
    expect(maxTokens).toBeGreaterThan(10_000);
    expect(maxTokens).toBeLessThanOrEqual(settings.maxTokens);
    expect(result.data.description.replaceAll("译", "")).toBe(original.data.description);
  });
  it("rejects missing configuration without requesting a model", async () => {
    await expect(translateCharacterCard(card(), "Simplified Chinese", { ...config(), apiKey: "中文" })).rejects.toMatchObject({ code: "translation_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([["length", "output_limit"], ["content_filter", "content_filter"], ["tool_calls", "unexpected_finish_reason"]])("rejects incomplete finish reason %s", async (reason, detail) => {
    fetchMock.mockResolvedValue(sse("{}", reason));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_incomplete", details: { reason: detail } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires the terminal SSE frame", async () => {
    fetchMock.mockResolvedValue(sse("{}", "stop", false));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_incomplete", details: { reason: "stream_interrupted" } });
  });
  it("rejects malformed SSE frames even when the dictionary is otherwise complete", async () => {
    successfulRequests();
    const success = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const response = await success(url, init);
      return new Response(`data: not-json\n\n${await response.text()}`);
    });
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
  });
  it("leaves the original card intact when the single request fails", async () => {
    fetchMock.mockResolvedValue(sse("{}"));
    const original = card();
    original.data.description = "a".repeat(7000);
    const snapshot = structuredClone(original);
    await expect(translateCharacterCard(original, "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
    expect(original).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["http", "network", "event"])("redacts %s errors without retries", async (failure) => {
    if (failure === "http") fetchMock.mockResolvedValue(new Response("sk-secret upstream payload", { status: 500 }));
    if (failure === "network") fetchMock.mockRejectedValue(new Error("sk-secret upstream payload"));
    if (failure === "event") fetchMock.mockResolvedValue(new Response(encodeSseFrame({ type: "error", message: "sk-secret upstream payload" })));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_request_failed", message: "translation_request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid JSON and does not retry", async () => {
    fetchMock.mockResolvedValue(sse("broken"));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({ code: "translation_invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels before requests and during an unending stream", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateCharacterCard(card(), "Simplified Chinese", config(), { signal: controller.signal })).rejects.toMatchObject({ code: "translation_cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    const during = new AbortController();
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({ start() { setTimeout(() => during.abort(), 0); } })));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config(), { signal: during.signal })).rejects.toMatchObject({ code: "translation_cancelled" });
  });
  it("uses the configured browser model without a remote request", async () => {
    vi.mocked(probeBrowserModel).mockResolvedValue(true);
    vi.mocked(streamBrowserChat).mockImplementation(async (args) => { args.onDelta(args.messages[1].content); });
    const original = card();
    expect(await translateCharacterCard(original, "English", { ...config(), providerId: "browser", apiKey: "" })).toEqual(original);
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
    const result = await translateCharacterCard(original, "Simplified Chinese", config(), { onProgress: (event) => events.push(event) });
    expect(result).toEqual(original);
    expect(events[0].phase).toBe("preparing");
    expect(events.some((event) => event.phase === "translating" && event.completed === 0 && event.receivedCharacters > 0)).toBe(true);
    expect(events.some((event) => event.phase === "validating" && event.completed === 0)).toBe(true);
    const final = events.at(-1)!;
    expect(final.phase).toBe("complete");
    expect(final.completed).toBe(final.total);
    expect(final.total).toBeGreaterThan(1);
    expect(final.completedCharacters).toBe(original.data.name.length + original.data.description.length);
    expect(final.totalCharacters).toBe(final.completedCharacters);
    expect(final.receivedCharacters).toBeGreaterThan(0);
    expect(events.every((event, index) => ["name", "description"].includes(event.field) && (!index
      || event.completed >= events[index - 1].completed && event.receivedCharacters >= events[index - 1].receivedCharacters))).toBe(true);
  });
  it("retries the whole card after a truncated response without caching partial output", async () => {
    const original = createEmptyCard();
    original.data.description = "word ".repeat(1000);
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    fetchMock.mockResolvedValue(sse('{"s0":"partial', "length"));
    await expect(translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint })).rejects.toMatchObject({
      code: "translation_incomplete", details: { reason: "output_limit", completed: 0 },
    });
    expect(Object.keys(checkpoint.translations)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(checkpoint)).not.toContain("sk-test");
    fetchMock.mockClear();
    successfulRequests();
    const resumed = await translateCharacterCard(original, "Simplified Chinese", { ...config(), apiKey: "sk-replaced" }, { checkpoint });
    expect(resumed.data.description.replaceAll("译", "")).toBe(original.data.description);
    // 重试不带任何已缓存片段：单请求没有部分成功的片段
    for (const [, init] of fetchMock.mock.calls) {
      const source = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      expect(Object.keys(source).length).toBeGreaterThan(1);
    }
    fetchMock.mockClear();
    expect(await translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint })).toEqual(resumed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["source", "language", "provider", "model", "baseURL"])("clears checkpoint when %s changes", async (change) => {
    successfulRequests();
    const original = createEmptyCard();
    original.data.description = "Original";
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    await translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint });
    const signature = checkpoint.signature;
    const next = config();
    if (change === "source") original.data.description = "Changed";
    if (change === "provider") { next.providerId = "custom"; next.baseURL = "https://example.com/v1"; }
    if (change === "model") next.model = "different-model";
    if (change === "baseURL") next.baseURL = "https://example.com/v1";
    checkpoint.translations.orphan = "must clear";
    fetchMock.mockClear();
    await translateCharacterCard(original, change === "language" ? "English" : "Simplified Chinese", next, { checkpoint });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkpoint.signature).not.toBe(signature);
    expect(checkpoint.translations).not.toHaveProperty("orphan");
  });
  it("retains nothing on cancellation and never caches unfinished output", async () => {
    const original = createEmptyCard();
    original.data.description = "word ".repeat(800);
    const checkpoint: CardTranslationCheckpoint = { translations: {} };
    const controller = new AbortController();
    successfulRequests();
    await expect(translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint, signal: controller.signal,
      onProgress: (event) => { if (event.receivedCharacters > 0) controller.abort(); },
    })).rejects.toMatchObject({ code: "translation_cancelled", details: { reason: "cancelled", completed: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(checkpoint.translations)).toHaveLength(0);
    fetchMock.mockClear();
    const result = await translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint });
    expect(result.data.description.replaceAll("译", "")).toBe(original.data.description);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const empty: CardTranslationCheckpoint = { translations: {} };
    fetchMock.mockResolvedValue(sse('{"s0":"partial', "length"));
    await expect(translateCharacterCard(original, "Simplified Chinese", config(), { checkpoint: empty })).rejects.toMatchObject({
      details: { reason: "output_limit", completed: 0 },
    });
    expect(empty.translations).toEqual({});
  });
  it("distinguishes HTTP status and reader interruption without exposing upstream messages", async () => {
    fetchMock.mockResolvedValue(new Response("sk-secret unsafe upstream text", { status: 429 }));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({
      message: "translation_request_failed", details: { reason: "http_error", status: 429 },
    });
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.error(new Error("sk-secret unsafe upstream text"));
    } })));
    await expect(translateCharacterCard(card(), "Simplified Chinese", config())).rejects.toMatchObject({
      message: "translation_incomplete", details: { reason: "stream_interrupted", completed: 0 },
    });
  });
  it("reports the request's first field when the single request is cut short", async () => {
    const original = createEmptyCard();
    original.data.description = "Description only";
    original.data.personality = "Personality only";
    fetchMock.mockResolvedValue(sse("{}", "content_filter"));
    await expect(translateCharacterCard(original, "Simplified Chinese", config())).rejects.toMatchObject({
      details: { reason: "content_filter", field: "name", completed: 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
