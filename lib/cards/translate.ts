import settings from "@/data/card-translation.json";
import { BROWSER_PROVIDER_ID, probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { authHeaders, cleanApiKey } from "@/lib/providers/apikey";
import { isConfigured, usesBrowserModel, type ProviderConfig } from "@/lib/providers/settings";
import { resolveBaseURL } from "@/lib/providers/validate";
import type { ChatMessage } from "@/lib/prompt/types";
import { decodeSseBuffer } from "@/lib/wire";
import type { CharacterCard } from "./types";

export type CardTranslationErrorCode =
  | "translation_not_configured"
  | "translation_invalid_response"
  | "translation_incomplete"
  | "translation_request_failed"
  | "translation_cancelled";

export class CardTranslationError extends Error {
  constructor(public readonly code: CardTranslationErrorCode) {
    super(code);
    this.name = "CardTranslationError";
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CardTranslationError("translation_cancelled");
}

function markers(text: string): string[] {
  return text.match(/\{\{[\s\S]*?\}\}|<[^>]*>/g) ?? [];
}

export function parseTranslationDictionary(text: string, source: Record<string, string>): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CardTranslationError("translation_invalid_response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CardTranslationError("translation_invalid_response");
  }
  const result = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) {
    throw new CardTranslationError("translation_invalid_response");
  }
  for (const key of keys) {
    const translated = result[key];
    if (typeof translated !== "string" || !translated.trim() ||
        JSON.stringify(markers(translated)) !== JSON.stringify(markers(source[key]))) {
      throw new CardTranslationError("translation_invalid_response");
    }
  }
  return result as Record<string, string>;
}

interface Segment {
  key: string;
  text: string;
  write: (text: string) => void;
}

function collectSegments(card: CharacterCard): Segment[] {
  const segments: Segment[] = [];
  function add(text: string | undefined, write: (text: string) => void) {
    if (!text?.trim()) return;
    const parts: string[] = [];
    let part = "";
    // Markup and macros are indivisible even when a field spans several batches.
    for (const token of text.match(/\{\{[\s\S]*?\}\}|<[^>]*>|[^<{]+|[<{]/g) ?? []) {
      const protectedToken = /^(?:\{\{|<[^>]*>)/.test(token);
      const units = protectedToken ? [token] : Array.from(token);
      for (const unit of units) {
        if (part && part.length + unit.length > settings.segmentCharacters) {
          parts.push(part);
          part = "";
        }
        part += unit;
      }
    }
    if (part) parts.push(part);
    const translated = [...parts];
    let remaining = parts.filter((text) => text.trim()).length;
    parts.forEach((text, index) => {
      if (!text.trim()) return;
      segments.push({ key: `s${segments.length}`, text, write: (value) => {
        translated[index] = value;
        remaining--;
        if (!remaining) write(translated.join(""));
      } });
    });
  }
  const data = card.data;
  for (const field of settings.fields as (keyof Pick<typeof data,
    "description" | "personality" | "scenario" | "first_mes" | "mes_example" |
    "system_prompt" | "post_history_instructions" | "author_note">)[]) {
    add(data[field], (text) => { data[field] = text; });
  }
  data.alternate_greetings?.forEach((text, index) => add(text, (value) => { data.alternate_greetings![index] = value; }));
  if (data.voice) {
    const voice = data.voice;
    for (const field of settings.voiceFields as ("vocabulary" | "habits" | "avoidances" | "sampleLines")[]) {
      voice[field].forEach((text, index) => add(text, (value) => { voice[field][index] = value; }));
    }
  }
  const book = data.character_book;
  if (book) {
    add(book.name, (text) => { book.name = text; });
    for (const entry of book.entries) {
      add(entry.content, (text) => { entry.content = text; });
      // Adding synonyms to an AND list would require both languages to match.
      if (entry.logic !== "and") {
        for (const key of [...entry.keys]) {
          add(key, (text) => { if (!entry.keys.includes(text)) entry.keys.push(text); });
        }
      }
    }
  }
  return segments;
}

async function readTranslationStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finished = false;
  let terminated = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      for (const raw of buffer.split("\n\n").slice(0, -1)) {
        if (!raw.trim()) continue;
        const payload = raw.trim().startsWith("data:") ? raw.trim().slice(5).trim() : "";
        if (payload === "[DONE]") continue;
        try { JSON.parse(payload); } catch { throw new CardTranslationError("translation_invalid_response"); }
      }
      const parsed = decodeSseBuffer(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (frame === "[DONE]") { terminated = true; continue; }
        if (terminated || !frame || typeof frame !== "object") throw new CardTranslationError("translation_invalid_response");
        if (frame.type === "error") throw new CardTranslationError("translation_request_failed");
        if (frame.type === "delta") {
          if (finished || typeof frame.text !== "string") throw new CardTranslationError("translation_invalid_response");
          text += frame.text;
        } else if (frame.type === "done") {
          if (frame.finishReason !== "stop") throw new CardTranslationError("translation_incomplete");
          finished = true;
        } else {
          throw new CardTranslationError("translation_invalid_response");
        }
      }
      if (done) break;
    }
    if (!finished || !terminated || buffer.trim()) throw new CardTranslationError("translation_incomplete");
    return text;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function translateCharacterCard(
  card: CharacterCard,
  locale: "zh" | "en",
  config: ProviderConfig,
  options?: { signal?: AbortSignal },
): Promise<CharacterCard> {
  const signal = options?.signal;
  try {
    checkAbort(signal);
    if (!config) throw new CardTranslationError("translation_not_configured");
    const browserReady = await probeBrowserModel();
    checkAbort(signal);
    const local = usesBrowserModel(config, browserReady);
    const resolved = local ? null : resolveBaseURL(config.providerId, config.baseURL);
    if (!local && (config.providerId === BROWSER_PROVIDER_ID || !isConfigured(config) || !resolved || "error" in resolved)) {
      throw new CardTranslationError("translation_not_configured");
    }
    const result = structuredClone(card);
    const segments = collectSegments(result);
    for (let index = 0; index < segments.length;) {
      checkAbort(signal);
      const batch: Segment[] = [];
      let size = 0;
      while (index < segments.length && (!batch.length || size + segments[index].text.length <= settings.batchCharacters)) {
        const segment = segments[index++];
        batch.push(segment);
        size += segment.text.length;
      }
      const source = Object.fromEntries(batch.map(({ key, text }) => [key, text]));
      const messages: ChatMessage[] = [
        { role: "system", content: `${settings.systemPrompt}\nTarget language: ${settings.languages[locale]}. Preserve the character name: ${JSON.stringify(card.data.name)}.` },
        { role: "user", content: JSON.stringify(source) },
      ];
      let text = "";
      if (local) {
        await streamBrowserChat({ messages, temperature: settings.temperature, signal, onDelta: (delta) => { text += delta; } });
      } else {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(cleanApiKey(config.apiKey).value) },
          signal,
          body: JSON.stringify({ mode: "complete", providerId: config.providerId, model: config.model.trim(),
            baseURL: resolved && "baseURL" in resolved ? resolved.baseURL : undefined,
            messages, temperature: settings.temperature, maxTokens: settings.maxTokens }),
        });
        if (!response.ok) throw new CardTranslationError("translation_request_failed");
        if (!response.body) throw new CardTranslationError("translation_incomplete");
        text = await readTranslationStream(response.body, signal);
      }
      checkAbort(signal);
      const translated = parseTranslationDictionary(text, source);
      batch.forEach((segment) => segment.write(translated[segment.key]));
    }
    checkAbort(signal);
    return result;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new CardTranslationError("translation_cancelled");
    if (error instanceof CardTranslationError) throw error;
    throw new CardTranslationError("translation_request_failed");
  }
}
