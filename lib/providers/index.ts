import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import { createResponsesProvider } from "./responses";
import { resolveInterfaceType } from "./config";
import type { ProviderAdapter } from "./types";

export * from "./types";
export * from "./config";
export { createAnthropicProvider } from "./anthropic";
export type { AnthropicAdapterOptions } from "./anthropic";
export { createOpenAIProvider } from "./openai";
export type { OpenAIAdapterOptions } from "./openai";
export { createResponsesProvider } from "./responses";
export type { ResponsesAdapterOptions } from "./responses";
export { toChatError, redact } from "./errors";
export type { ChatErrorInfo } from "./errors";
export { resolveBaseURL, isInsecureBaseURL } from "./validate";

/**
 * 取适配器。上层只认这个函数。
 *
 * 协议优先看调用方传来的 interfaceType；旧客户端没传时按预设或
 * providerId 推断，保证 Anthropic 预设仍然走 Messages。
 */
export function getProvider(options: {
  providerId: string;
  interfaceType?: string;
  apiKey: string;
  baseURL: string;
  timeoutMs?: number;
  maxRetries?: number;
}): ProviderAdapter {
  const interfaceType = resolveInterfaceType(options.providerId, options.interfaceType);
  const shared = {
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  };
  if (interfaceType === "anthropic-messages") {
    return createAnthropicProvider(shared);
  }
  if (interfaceType === "openai-responses") {
    return createResponsesProvider(shared);
  }
  return createOpenAIProvider(shared);
}
