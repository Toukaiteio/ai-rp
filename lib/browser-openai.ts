import type { ChatMessage } from "@/lib/prompt/types";
import type { ChatStreamEvent, ChatTool } from "@/lib/providers/types";

export interface BrowserOpenAIRequest {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  image?: string;
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

/** 预设或自定义 Base URL 转成浏览器 fetch 要访问的完整 endpoint。 */
export function browserChatEndpoint(baseURL: string): string {
  const url = new URL(baseURL.trim());
  if (url.protocol !== "https:") throw new Error("browser_https_required");
  url.hash = "";
  if (!url.pathname.endsWith("/chat/completions")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  }
  return url.toString();
}

/** 浏览器直连 OpenAI-compatible SSE。CORS、权限或上游错误由调用方回退到 /api/chat。 */
export async function streamBrowserOpenAI(request: BrowserOpenAIRequest): Promise<void> {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: request.model,
      messages: attachImage(request.messages, request.image),
      stream: true,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      ...(request.tools?.length ? { tools: request.tools } : {}),
    }),
    signal: request.signal,
    credentials: "omit",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(detail || `HTTP ${response.status}`);
    Object.assign(error, { status: response.status, code: `http_${response.status}` });
    throw error;
  }
  if (!response.body) throw new Error("no_body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawEvent = false;
  const emit = (event: ChatStreamEvent) => {
    sawEvent = true;
    request.onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const parsed = consumeSse(buffer, emit);
      buffer = parsed.rest;
      if (done) break;
    }
    if (buffer.trim()) consumeSse(`${buffer}\n\n`, emit);
    if (!sawEvent) throw new Error("invalid_sse");
  } finally {
    reader.releaseLock();
  }
}

function consumeSse(buffer: string, onEvent: (event: ChatStreamEvent) => void): { rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      continue;
    }
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) onEvent({ type: "delta", text: choice.delta.content });
    for (const call of choice?.delta?.tool_calls ?? []) {
      onEvent({
        type: "tool",
        index: call.index ?? 0,
        id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments,
      });
    }
    if (choice?.finish_reason) onEvent({ type: "done", finishReason: choice.finish_reason });
  }
  return { rest };
}

function attachImage(messages: ChatMessage[], image?: string): unknown[] {
  if (!image) return messages;
  const index = messages.findLastIndex((message) => message.role === "user");
  if (index < 0) return messages;
  return messages.map((message, current) => {
    if (current !== index) return message;
    return {
      role: message.role,
      content: [
        { type: "text", text: message.content || " " },
        { type: "image_url", image_url: { url: image } },
      ],
    };
  });
}
