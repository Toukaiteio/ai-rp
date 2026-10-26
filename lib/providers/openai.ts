import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { ChatMessage } from "@/lib/prompt/types";
import { DEFAULT_CHAT_MAX_TOKENS, type ChatStreamEvent, type ProviderAdapter, type ReasoningEffort, type TokenUsage } from "./types";

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
  let usage: TokenUsage | undefined;

  for await (const chunk of stream) {
    // OpenAI 约定 usage 在最后一个 chunk 上（需要 stream_options.include_usage）
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
      };
    }
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content;
    if (text) {
      yield { type: "delta", text };
    }
    const toolCalls = choice?.delta?.tool_calls;
    if (toolCalls) {
      for (const call of toolCalls) {
        yield {
          type: "tool",
          index: call.index,
          id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments,
        };
      }
    }
    if (choice?.finish_reason) {
      sawFinish = true;
      yield { type: "done", finishReason: choice.finish_reason, ...(usage ? { usage } : {}) };
    }
  }

  // 有些中继不发 finish_reason，收流正常结束时补一个，前端才知道该收尾了
  if (!sawFinish) {
    yield { type: "done", finishReason: "stop", ...(usage ? { usage } : {}) };
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
      const stream = (await client.chat.completions.create(
        {
          model: request.model,
          messages: attachImage(request.messages, request.image) as OpenAI.Chat.ChatCompletionCreateParams["messages"],
          stream: true,
          // 让上游在最后一个 chunk 带 usage；不支持的少数中继会忽略这个字段
          stream_options: { include_usage: true },
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
          max_tokens: request.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
          ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
          ...(request.tools?.length ? { tools: request.tools } : {}),
        } as OpenAI.Chat.ChatCompletionCreateParams & { reasoning_effort?: ReasoningEffort },
        // signal 是中断链的末端：浏览器断开 → 路由 abort → 这里掐断上游连接
        { signal: request.signal },
      )) as AsyncIterable<ChatCompletionChunk>;

      return toEvents(stream);
    },
  };
}

function attachImage(messages: ChatMessage[], image: string | undefined): ChatMessage[] {
  if (!image) return messages;
  const index = messages.findLastIndex((message) => message.role === "user");
  if (index < 0) return messages;
  return messages.map((message, i) => {
    if (i !== index || typeof message.content !== "string") return message;
    return {
      role: message.role,
      content: [
        { type: "text", text: message.content || " " },
        { type: "image_url", image_url: { url: image } },
      ],
    } as unknown as ChatMessage;
  });
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "自定义地址";
  }
}
