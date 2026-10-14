import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { ChatStreamEvent, ProviderAdapter } from "./types";

export interface OpenAIAdapterOptions {
  apiKey: string;
  baseURL: string;
  /** 单次请求的整体超时，默认 120 秒 */
  timeoutMs?: number;
  /** 连接期失败的重试次数。流一旦开始就不会重试（SDK 自己也会拒绝） */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * 把 SDK 的 chunk 流转成我们的中立事件流。
 * 只取正文增量与结束原因，别的一律不往下传。
 */
async function* toEvents(
  stream: AsyncIterable<ChatCompletionChunk>,
): AsyncIterable<ChatStreamEvent> {
  let sawFinish = false;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content;
    if (text) {
      yield { type: "delta", text };
    }
    if (choice?.finish_reason) {
      sawFinish = true;
      yield { type: "done", finishReason: choice.finish_reason };
    }
  }

  // 有些中继不发 finish_reason，收流正常结束时补一个，前端才知道该收尾了
  if (!sawFinish) {
    yield { type: "done", finishReason: "stop" };
  }
}

/**
 * OpenAI Chat Completions 适配器。
 * 第一版只做这一种接口，Anthropic Messages 与 Responses 都不在这里。
 */
export function createOpenAIProvider(
  options: OpenAIAdapterOptions,
): ProviderAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 1,
  });

  return {
    id: "openai-chat-completions",
    // 只暴露主机名，避免把带凭据的完整 URL 打进界面或日志
    name: `Chat Completions · ${safeHost(options.baseURL)}`,

    async open(request) {
      // SDK 在 stream:true 时也会先 await fetch，
      // 所以 4xx / 5xx 会在这里抛出来，交给路由转成真实 HTTP 状态码。
      const stream = await client.chat.completions.create(
        {
          model: request.model,
          messages: request.messages,
          stream: true,
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
          ...(request.maxTokens !== undefined
            ? { max_tokens: request.maxTokens }
            : {}),
        },
        // signal 是中断链的末端：浏览器断开 → 路由 abort → 这里掐断上游连接
        { signal: request.signal },
      );

      return toEvents(stream);
    },
  };
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "自定义地址";
  }
}
