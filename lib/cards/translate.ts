import settings from "@/data/card-translation.json";
import { BROWSER_PROVIDER_ID, probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { authHeaders, cleanApiKey } from "@/lib/providers/apikey";
import { isConfigured, usesBrowserModel, type ProviderConfig } from "@/lib/providers/settings";
import { resolveBaseURL } from "@/lib/providers/validate";
import type { ChatMessage } from "@/lib/prompt/types";
import { decodeSseBuffer } from "@/lib/wire";
import type { CharacterCard } from "./types";
import { collectTranslationSegments, type TranslationSegment } from "./translation-segments";
import { CardTranslationError, checkTranslationAbort as checkAbort, parseTranslationDictionary,
  synchronizeTranslationSpeakers,
  type CardTranslationProgress, type CardTranslationCheckpoint } from "./translation-types";

export { CardTranslationError, parseTranslationDictionary } from "./translation-types";
export type { CardTranslationErrorCode, CardTranslationErrorDetails, CardTranslationProgress,
  CardTranslationCheckpoint } from "./translation-types";

async function readTranslationStream(
  body: ReadableStream<Uint8Array>, onDelta: (text: string) => void, signal?: AbortSignal,
): Promise<string> {
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
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch {
        checkAbort(signal);
        throw new CardTranslationError("translation_incomplete", { reason: "stream_interrupted" });
      }
      checkAbort(signal);
      const { done, value } = chunk;
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      for (const raw of buffer.split("\n\n").slice(0, -1)) {
        if (!raw.trim()) continue;
        const payload = raw.trim().startsWith("data:") ? raw.trim().slice(5).trim() : "";
        if (payload === "[DONE]") continue;
        try { JSON.parse(payload); } catch {
          throw new CardTranslationError("translation_invalid_response", { reason: "invalid_sse" });
        }
      }
      const parsed = decodeSseBuffer(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (frame === "[DONE]") {
          if (terminated || !finished) throw new CardTranslationError("translation_incomplete", { reason: "stream_interrupted" });
          terminated = true;
          continue;
        }
        if (terminated || !frame || typeof frame !== "object") {
          throw new CardTranslationError("translation_invalid_response", { reason: "invalid_sse" });
        }
        if (frame.type === "error") throw new CardTranslationError("translation_request_failed", { reason: "upstream_error" });
        if (frame.type === "delta") {
          if (finished || typeof frame.text !== "string") throw new CardTranslationError("translation_invalid_response", { reason: "invalid_sse" });
          text += frame.text;
          onDelta(frame.text);
        } else if (frame.type === "done") {
          if (finished) throw new CardTranslationError("translation_invalid_response", { reason: "invalid_sse" });
          if (frame.finishReason !== "stop") {
            const reason = frame.finishReason === "length" ? "output_limit"
              : frame.finishReason === "content_filter" ? "content_filter" : "unexpected_finish_reason";
            throw new CardTranslationError("translation_incomplete", { reason });
          }
          finished = true;
        } else {
          throw new CardTranslationError("translation_invalid_response", { reason: "invalid_sse" });
        }
      }
      if (done) break;
    }
    if (!finished || !terminated || buffer.trim()) throw new CardTranslationError("translation_incomplete", { reason: "stream_interrupted" });
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
  options?: { signal?: AbortSignal; onProgress?: (progress: CardTranslationProgress) => void; checkpoint?: CardTranslationCheckpoint },
): Promise<CharacterCard> {
  const signal = options?.signal;
  let progress: CardTranslationProgress = { phase: "preparing", completed: 0, total: 0,
    field: "name", receivedCharacters: 0, completedCharacters: 0, totalCharacters: 0 };
  const emit = (patch: Partial<CardTranslationProgress>) => {
    progress = { ...progress, ...patch };
    options?.onProgress?.({ ...progress });
  };
  try {
    checkAbort(signal);
    emit({});
    if (!config) throw new CardTranslationError("translation_not_configured", { reason: "not_configured" });
    const browserReady = await probeBrowserModel();
    checkAbort(signal);
    const local = usesBrowserModel(config, browserReady);
    const resolved = local ? null : resolveBaseURL(config.providerId, config.baseURL);
    if (!local && (config.providerId === BROWSER_PROVIDER_ID || !isConfigured(config) || !resolved || "error" in resolved)) {
      throw new CardTranslationError("translation_not_configured", { reason: "not_configured" });
    }
    const result = structuredClone(card);
    const segments = collectTranslationSegments(result);
    const checkpoint = options?.checkpoint ?? { translations: {} };
    const signatureInput = JSON.stringify([card, locale, config.providerId, config.model.trim(),
      resolved && "baseURL" in resolved ? resolved.baseURL : config.baseURL, local, settings]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signatureInput));
    checkAbort(signal);
    const signature = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    if (checkpoint.signature !== signature) {
      checkpoint.translations = {};
      checkpoint.signature = signature;
    }
    emit({ total: segments.length, totalCharacters: segments.reduce((sum, segment) => sum + segment.characters, 0),
      field: segments[0]?.field ?? "description" });
    const write = (segment: TranslationSegment, translation: string) => segment.write(segment.field === "name"
      ? translation : synchronizeTranslationSpeakers(translation, card.data.name, result.data.name));
    for (let index = 0; index < segments.length;) {
      checkAbort(signal);
      const current = segments[index];
      if (Object.hasOwn(checkpoint.translations, current.key)) {
        let cached: string | undefined;
        try {
          cached = parseTranslationDictionary(JSON.stringify({ [current.key]: checkpoint.translations[current.key] }),
            { [current.key]: current.text })[current.key];
        } catch {
          delete checkpoint.translations[current.key];
        }
        if (cached !== undefined) {
          write(current, cached);
          emit({ completed: progress.completed + 1, completedCharacters: progress.completedCharacters + current.characters, field: current.field });
          index++;
          continue;
        }
      }
      const batch: TranslationSegment[] = [];
      let size = 0;
      while (index < segments.length && (!batch.length ||
        !Object.hasOwn(checkpoint.translations, segments[index].key) && segments[index].field === batch[0].field
        && size + segments[index].text.length <= settings.batchCharacters)) {
        const segment = segments[index++];
        batch.push(segment);
        size += segment.text.length;
      }
      emit({ phase: "translating", field: batch[0].field });
      checkAbort(signal);
      const source = Object.fromEntries(batch.map(({ key, text }) => [key, text]));
      const messages: ChatMessage[] = [
        { role: "system", content: `${settings.systemPrompt}\nTarget language: ${settings.languages[locale]}.\n${batch[0].field === "name"
          ? settings.namePrompt : `${settings.glossaryPrompt} ${JSON.stringify({ [card.data.name]: result.data.name })}`}` },
        { role: "user", content: JSON.stringify(source) },
      ];
      const onDelta = (delta: string) => emit({ receivedCharacters: progress.receivedCharacters + delta.length });
      let text = "";
      if (local) {
        await streamBrowserChat({ messages, temperature: settings.temperature, signal, onDelta: (delta) => { text += delta; onDelta(delta); } });
      } else {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(cleanApiKey(config.apiKey).value) },
          signal,
          body: JSON.stringify({ mode: "complete", providerId: config.providerId, model: config.model.trim(),
            baseURL: resolved && "baseURL" in resolved ? resolved.baseURL : undefined,
            messages, temperature: settings.temperature, reasoningEffort: "low",
            maxTokens: settings.maxTokens }),
        });
        if (!response.ok) throw new CardTranslationError("translation_request_failed", { reason: "http_error", status: response.status });
        if (!response.body) throw new CardTranslationError("translation_incomplete", { reason: "stream_interrupted" });
        text = await readTranslationStream(response.body, onDelta, signal);
      }
      checkAbort(signal);
      emit({ phase: "validating" });
      checkAbort(signal);
      const translated = parseTranslationDictionary(text, source);
      for (const segment of batch) {
        write(segment, translated[segment.key]);
        checkpoint.translations[segment.key] = translated[segment.key];
      }
      emit({ completed: progress.completed + batch.length,
        completedCharacters: progress.completedCharacters + batch.reduce((sum, segment) => sum + segment.characters, 0) });
    }
    checkAbort(signal);
    emit({ phase: "complete" });
    return result;
  } catch (error) {
    const context = { field: progress.field, completed: progress.completed, total: progress.total,
      receivedCharacters: progress.receivedCharacters };
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new CardTranslationError("translation_cancelled", { reason: "cancelled", ...context });
    }
    if (error instanceof CardTranslationError) {
      error.details = { ...error.details!, ...context };
      throw error;
    }
    throw new CardTranslationError("translation_request_failed", { reason: "network_error", ...context });
  }
}
