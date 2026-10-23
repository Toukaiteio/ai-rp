import OpenAI from "openai";
import type {
  EasyInputMessage,
  FunctionTool,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import type { ChatMessage } from "@/lib/prompt/types";
import type { ChatStreamEvent, ChatTool, ProviderAdapter } from "./types";

export interface ResponsesAdapterOptions {
  apiKey: string;
  baseURL: string;
  /** 单次请求的整体超时，默认 120 秒 */
  timeoutMs?: number;
  /** 连接期失败的重试次数。流一旦开始就不会重试 */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/**
 * 把 Responses 的流事件收敛成中立事件流。
 *
 * 文本走 response.output_text.delta；函数调用先由 output_item.added 报出
 * 名字和 id，参数再由 function_call_arguments.delta 逐段到达——两段都用
 * output_index 当我们的事件 index，前端按 index 聚合，与 Chat Completions 一致。
 */
async function* toEvents(
  stream: AsyncIterable<ResponseStreamEvent>,
): AsyncIterable<ChatStreamEvent> {
  let sawFinish = false;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      if (event.delta) yield { type: "delta", text: event.delta };
      continue;
    }

    if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      yield {
        type: "tool",
        index: event.output_index,
        id: event.item.call_id ?? event.item.id,
        name: event.item.name,
      };
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      if (event.delta) yield { type: "tool", index: event.output_index, arguments: event.delta };
      continue;
    }

    if (event.type === "error") {
      yield { type: "error", message: event.message };
      continue;
    }

    if (event.type === "response.failed") {
      sawFinish = true;
      yield {
        type: "error",
        message: event.response.error?.message ?? "提供商返回了未预期的错误",
      };
      yield { type: "done", finishReason: "failed" };
      continue;
    }

    if (event.type === "response.incomplete") {
      sawFinish = true;
      yield {
        type: "done",
        finishReason: event.response.incomplete_details?.reason ?? "incomplete",
      };
      continue;
    }

    if (event.type === "response.completed") {
      sawFinish = true;
      const calledTool = event.response.output.some((item) => item.type === "function_call");
      yield { type: "done", finishReason: calledTool ? "tool_calls" : "stop" };
    }
  }

  // 有些中继不发 completed，收流正常结束时补一个，前端才知道该收尾了
  if (!sawFinish) {
    yield { type: "done", finishReason: "stop" };
  }
}

/**
 * OpenAI Responses 适配器。
 *
 * 与 Chat Completions 共用同一个官方 SDK，但请求是 `input` 数组、
 * 上限叫 max_output_tokens、推理档位在 reasoning.effort 里。
 * 每次都带完整输入并不落库（store:false），会话状态仍由本项目自己管理。
 */
export function createResponsesProvider(
  options: ResponsesAdapterOptions,
): ProviderAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 1,
  });

  return {
    id: "openai-responses",
    name: `Responses · ${safeHost(options.baseURL)}`,

    async open(request) {
      const stream = (await client.responses.create(
        {
          model: request.model,
          input: translateInput(request.messages, request.image),
          stream: true,
          store: false,
          max_output_tokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          reasoning: { effort: request.reasoningEffort ?? "high" },
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.tools?.length ? { tools: request.tools.map(toResponsesTool) } : {}),
        },
        // signal 是中断链的末端：浏览器断开 → 路由 abort → 这里掐断上游连接
        { signal: request.signal },
      )) as AsyncIterable<ResponseStreamEvent>;

      return toEvents(stream);
    },
  };
}

/**
 * 中立消息转 input 数组。
 *
 * system 消息保持原位留在 input 里（而不是抽成 instructions）：
 * 世界书、作者注、回合层的顺序本身就是提示词语义，抽走会打乱。
 */
function translateInput(messages: ChatMessage[], image: string | undefined): ResponseInputItem[] {
  const imageIndex = image
    ? messages.findLastIndex((message) => message.role === "user")
    : -1;

  return messages.map((message, index): ResponseInputItem => {
    if (index === imageIndex) {
      return {
        role: "user",
        content: [
          { type: "input_text", text: message.content || " " },
          { type: "input_image", image_url: image, detail: "auto" },
        ],
      };
    }
    const easy: EasyInputMessage = { role: message.role, content: message.content };
    return easy;
  });
}

/** Chat Completions 的嵌套 function 形状转成 Responses 的扁平 FunctionTool。 */
function toResponsesTool(tool: ChatTool): FunctionTool {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  };
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "自定义地址";
  }
}
