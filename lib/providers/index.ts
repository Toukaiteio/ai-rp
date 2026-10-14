import { createOpenAIProvider } from "./openai";
import type { ProviderAdapter } from "./types";

export * from "./types";
export * from "./config";
export { createOpenAIProvider } from "./openai";
export type { OpenAIAdapterOptions } from "./openai";
export { toChatError, redact } from "./errors";
export type { ChatErrorInfo } from "./errors";
export { resolveBaseURL, isInsecureBaseURL } from "./validate";

/**
 * 取适配器。上层只认这个函数。
 *
 * 只有 Chat Completions 一条路：Yosei-Router、OpenAI、DeepSeek、自定义
 * 都走同一个适配器，差别只在 baseURL 与 Key。
 */
export function getProvider(options: {
  providerId: string;
  apiKey: string;
  baseURL: string;
  timeoutMs?: number;
}): ProviderAdapter {
  return createOpenAIProvider({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeoutMs: options.timeoutMs,
  });
}
