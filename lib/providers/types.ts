import type { ChatMessage } from "@/lib/prompt/types";

/** 流式事件。文本增量，以及函数调用的参数碎片。 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "tool";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "done"; finishReason?: string }
  | { type: "error"; message: string };

/** OpenAI Chat Completions 的 tools 字段。中继按这个形状接收。 */
export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  /**
   * 中立的 role + text，不带任何接口方言。
   * 提示词构建器只产出这一种形状，各家适配器自己转格式：
   * Chat Completions 直接用；以后接 Anthropic Messages 时把 system 抽出来单独传；
   * 接 Responses 时转成 input 数组并无状态调用（每次传完整输入，不依赖服务端状态）。
   */
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Reasoning-capable models use the strongest default effort. */
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /** 不传就不向模型提供函数调用 */
  tools?: ChatTool[];
  /** 贴在最后一条用户消息上的 jpeg data URL */
  image?: string;
}

/**
 * 提供商适配器。所有提供商都收敛到这一个接口，
 * 上层（/api/chat）不关心对面是 OpenAI 还是中继。
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  /**
   * 建立上游连接并返回事件流。
   *
   * 分成 open() + 迭代两步，是为了让「连接期失败」和「流中途失败」可区分：
   * 401 / 404 / 429 / 超时都在 open() 阶段抛出，
   * 路由据此返回真正的 HTTP 状态码，而不是把一个错误塞进已经 200 的流里。
   */
  open(request: ChatRequest): Promise<AsyncIterable<ChatStreamEvent>>;
}
