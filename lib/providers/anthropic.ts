import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  RawMessageStreamEvent,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { ChatMessage } from "@/lib/prompt/types";
import { DEFAULT_CHAT_MAX_TOKENS, type ChatStreamEvent, type ChatTool, type ProviderAdapter, type TokenUsage } from "./types";

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseURL: string;
  /** 单次请求的整体超时，默认 120 秒 */
  timeoutMs?: number;
  /** 连接期失败的重试次数。流一旦开始就不会重试 */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

type ConversationMessage = Extract<MessageParam, { role: "user" | "assistant" }>;
type SystemContent = string | TextBlockParam[];
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

async function* toEvents(
  stream: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<ChatStreamEvent> {
  let sawFinish = false;
  const toolIndices = new Map<number, number>();
  let nextToolIndex = 0;
  // usage 分两处来：message_start 给输入，message_delta 给输出，done 时合在一起
  let usage: TokenUsage | undefined;

  const toolIndexFor = (blockIndex: number): number => {
    const existing = toolIndices.get(blockIndex);
    if (existing !== undefined) return existing;
    const index = nextToolIndex;
    nextToolIndex += 1;
    toolIndices.set(blockIndex, index);
    return index;
  };

  for await (const event of stream) {
    if (event.type === "message_start") {
      usage = { promptTokens: event.message.usage?.input_tokens ?? 0, completionTokens: 0 };
      continue;
    }

    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      yield {
        type: "tool",
        index: toolIndexFor(event.index),
        id: event.content_block.id,
        name: event.content_block.name,
      };
      continue;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta" && event.delta.text) {
        yield { type: "delta", text: event.delta.text };
      } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
        yield {
          type: "tool",
          index: toolIndexFor(event.index),
          arguments: event.delta.partial_json,
        };
      }
      continue;
    }

    if (event.type === "message_delta" && event.delta.stop_reason && !sawFinish) {
      sawFinish = true;
      if (event.usage) {
        usage = {
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: event.usage.output_tokens ?? 0,
        };
      }
      yield { type: "done", finishReason: event.delta.stop_reason, ...(usage ? { usage } : {}) };
    }
  }

  if (!sawFinish) {
    yield { type: "done", finishReason: "stop", ...(usage ? { usage } : {}) };
  }
}

export function createAnthropicProvider(
  options: AnthropicAdapterOptions,
): ProviderAdapter {
  // Messages 路径由 SDK 拼成 /v1/messages；用户按 OpenAI 习惯填到 /v1 会变成 /v1/v1。
  const baseURL = options.baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 1,
  });

  return {
    id: "anthropic-messages",
    name: `Messages · ${safeHost(baseURL)}`,

    async open(request) {
      const translated = translateRequest(request.messages, request.image);
      const stream = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
          messages: translated.messages,
          stream: true,
          ...(translated.system ? { system: translated.system } : {}),
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
          ...(request.tools?.length ? { tools: request.tools.map(toTool) } : {}),
        },
        { signal: request.signal },
      );

      return toEvents(stream);
    },
  };
}

function translateRequest(
  messages: ChatMessage[],
  image: string | undefined,
): { messages: ConversationMessage[]; system?: SystemContent } {
  const systemMessages = messages.filter((message) => message.role === "system");
  const imageIndex = image
    ? messages.findLastIndex((message) => message.role === "user")
    : -1;

  const conversation = messages.flatMap((message, index) => {
    if (message.role === "system") return [];
    return [{
      role: message.role,
      content: toMessageContent(message, index === imageIndex ? image : undefined),
    } satisfies ConversationMessage];
  });

  return {
    messages: conversation,
    ...(systemMessages.length ? { system: toSystemContent(systemMessages) } : {}),
  };
}

function toSystemContent(messages: ChatMessage[]): SystemContent {
  if (messages.every((message) => !message.cache_control)) {
    return messages.map((message) => message.content).join("\n\n");
  }
  return messages.map((message) => toTextBlock(message));
}

function toMessageContent(
  message: ChatMessage,
  image: string | undefined,
): ConversationMessage["content"] {
  if (image) {
    return [toTextBlock(message, message.content || " "), toImageBlock(image)];
  }
  return message.cache_control ? [toTextBlock(message)] : message.content;
}

function toTextBlock(message: ChatMessage, text = message.content): TextBlockParam {
  return {
    type: "text",
    text,
    ...(message.cache_control ? { cache_control: { type: "ephemeral" } } : {}),
  };
}

function toImageBlock(image: string): {
  type: "image";
  source: { type: "base64"; media_type: ImageMediaType; data: string };
} {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(image);
  if (!match) throw new Error("Anthropic image must be a base64 data URL");
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1] as ImageMediaType,
      data: match[2],
    },
  };
}

function toTool(tool: ChatTool): Tool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: { ...tool.function.parameters, type: "object" },
  };
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "自定义地址";
  }
}
