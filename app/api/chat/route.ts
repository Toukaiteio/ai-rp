import {
  assemble,
  cacheStatsFor,
  planBudget,
  applySummary,
  buildSummarizeMessages,
  emptyKeyFacts,
  mergeFacts,
  parseFactsPayload,
  type AssembleInput,
  type ChatMessage,
  type KeyFacts,
  type RollingSummary,
} from "@/lib/prompt";
import {
  getProvider,
  isInsecureBaseURL,
  resolveBaseURL,
  toChatError,
  type ChatErrorInfo,
} from "@/lib/providers";
import { encodeSseFrame, type WireEvent } from "@/lib/wire";

/**
 * Vercel 上的函数超时上限，与 vercel.json 里保持一致。
 *
 * 这里刻意不写 `runtime` 和 `dynamic`：项目开了 cacheComponents，
 * v16 起这两个 segment config 在该模式下不允许出现。
 * 运行时本来就是 Node.js（不是 Edge），正合 AGENTS.md 的要求。
 */
export const maxDuration = 300;

/** 单次上游请求的超时。 */
const UPSTREAM_TIMEOUT_MS = 120_000;
/** 给回复预留的 token，算预算时先扣掉。 */
const RESPONSE_TOKENS = 1024;

interface ChatRequestBody {
  providerId: string;
  model: string;
  /** 组装所需的全部原料。服务端负责组装，浏览器不碰提示词结构。 */
  context: {
    card: AssembleInput["card"];
    lorebook?: AssembleInput["lorebook"];
    persona?: string;
    history: ChatMessage[];
    seed: number;
    turn?: number;
    summary?: RollingSummary;
    facts?: KeyFacts;
    authorNote?: AssembleInput["authorNote"];
    style?: AssembleInput["style"];
    userName?: string;
    maxContext?: number;
  };
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  /** 会话标识，用于按会话统计缓存命中率 */
  sessionId?: string;
}

/** 不组装，原样把 messages 送给上游。建议输入走这条，不能混进角色扮演的缓存统计。 */
interface CompleteRequestBody {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
}

type ParsedRequest =
  | { kind: "chat"; body: ChatRequestBody }
  | { kind: "complete"; body: CompleteRequestBody }
  | { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Key 从请求头透传，只活在这一个请求的内存里。
 * 不接受 query 参数，避免 Key 落进访问日志与 Referer。
 */
function readApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages = value.filter(
    (m): m is ChatMessage =>
      isRecord(m) &&
      (m.role === "system" || m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string",
  );
  return messages.length === value.length ? messages : null;
}

function parseBody(raw: unknown): ParsedRequest {
  if (!isRecord(raw)) return { error: "请求体必须是 JSON 对象" };

  const providerId = asString(raw.providerId);
  if (!providerId) return { error: "缺少 providerId" };

  const model = asString(raw.model);
  if (!model?.trim()) return { error: "缺少 model" };

  // 建议输入这类次要请求：不带角色卡，也不进缓存统计
  if (raw.mode === "complete") {
    const messages = parseMessages(raw.messages);
    if (!messages || messages.length === 0) return { error: "messages 为空" };
    return {
      kind: "complete",
      body: {
        providerId,
        model: model.trim(),
        messages,
        temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
        maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : undefined,
        baseURL: asString(raw.baseURL),
      },
    };
  }

  const context = raw.context;
  if (!isRecord(context)) return { error: "缺少 context" };

  const card = context.card;
  if (!isRecord(card) || typeof card.name !== "string") {
    return { error: "context.card 缺 name" };
  }

  if (!Array.isArray(context.history)) {
    return { error: "context.history 必须是数组" };
  }

  const history = parseMessages(context.history);
  if (!history) return { error: "context.history 里有无法识别的消息" };

  return {
    kind: "chat",
    body: {
    providerId,
    model: model.trim(),
    context: {
      card: {
        name: card.name,
        description: typeof card.description === "string" ? card.description : "",
        personality: typeof card.personality === "string" ? card.personality : "",
        scenario: typeof card.scenario === "string" ? card.scenario : "",
        system_prompt: asString(card.system_prompt),
        mes_example: asString(card.mes_example),
        post_history_instructions: asString(card.post_history_instructions),
      },
      lorebook: context.lorebook as AssembleInput["lorebook"],
      persona: asString(context.persona),
      history,
      // seed 必须是数字。它是概率条目与摘要判定的确定性依据，
      // 不传就退化成 0，前缀仍然稳定。
      seed: typeof context.seed === "number" ? context.seed : 0,
      turn: typeof context.turn === "number" ? context.turn : 0,
      summary: context.summary as RollingSummary | undefined,
      facts: context.facts as KeyFacts | undefined,
      authorNote: context.authorNote as AssembleInput["authorNote"],
      style: (context.style === "haruhi" || context.style === "mushoku"
        ? context.style
        : undefined) as AssembleInput["style"],
      userName: asString(context.userName),
      maxContext:
        typeof context.maxContext === "number" ? context.maxContext : undefined,
    },
    temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : undefined,
    baseURL: asString(raw.baseURL),
    sessionId: asString(raw.sessionId),
    },
  };
}

function jsonError(info: ChatErrorInfo, extra?: Record<string, unknown>) {
  return Response.json({ error: info, ...extra }, { status: info.status });
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError({
      status: 400,
      code: "bad_json",
      message: "请求体不是合法 JSON",
    });
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return jsonError({ status: 400, code: "bad_request", message: parsed.error });
  }

  if (parsed.kind === "complete") {
    return complete(request, parsed.body);
  }

  const body = parsed.body;
  const apiKey = readApiKey(request);

  if (!apiKey) {
    return jsonError({
      status: 401,
      code: "missing_key",
      message: "缺少 API Key，请在连接设置里填一个",
    });
  }

  const resolved = resolveBaseURL(body.providerId, body.baseURL);
  if ("error" in resolved) {
    return jsonError({
      status: 400,
      code: "bad_base_url",
      message: resolved.error,
    });
  }
  const baseURL = resolved.baseURL;

  const { context } = body;

  /* ---------------- 服务端组装 ---------------- */

  const maxContext = context.maxContext ?? 16_000;
  const budget = planBudget(maxContext, RESPONSE_TOKENS);

  const { messages, budget: report, cacheKey, needsSummarize } = assemble({
    ...context,
    budget,
  });

  // 命中率只在这里记，不下发给玩家——这是内测观察数据，不是玩法信息
  const cacheHit = cacheStatsFor(body.sessionId ?? "default").observe(cacheKey);

  // 中断链：浏览器断开 → request.signal → controller → SDK signal → 上游连接
  const controller = new AbortController();
  if (request.signal.aborted) {
    controller.abort();
  } else {
    request.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const provider = getProvider({
    providerId: body.providerId,
    apiKey: apiKey ?? "",
    baseURL,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  let events: Awaited<ReturnType<typeof provider.open>>;
  try {
    events = await provider.open({
      messages,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      signal: controller.signal,
    });
  } catch (error) {
    // 只传 apiKey 用于抹除，绝不把 error 原样返回（headers 里有凭据回显）
    return jsonError(toChatError(error, apiKey ?? undefined), {
      provider: provider.name,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const encoder = new TextEncoder();
      const send = (frame: Parameters<typeof encodeSseFrame>[0]) => {
        try {
          streamController.enqueue(encoder.encode(encodeSseFrame(frame)));
        } catch {
          // 流已被取消，后续内容丢弃
        }
      };

      const meta: WireEvent = {
        type: "meta",
        used: report.used,
        max: report.max,
        dropped: report.dropped,
        kept: report.kept,
        lorebookEntries: report.lorebookEntries,
        cacheHit,
        needsSummarize,
        provider: provider.name,
        model: body.model,
      };

      try {
        send(meta);

        for await (const event of events) {
          if (controller.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          send({
            type: "error",
            message: toChatError(error, apiKey ?? undefined).message,
          });
        }
      } finally {
        send("[DONE]");
        try {
          streamController.close();
        } catch {
          // 已经关掉了
        }
      }
    },

    // 前端断开时触发，掐断上游请求，不让它继续烧 token
    cancel() {
      controller.abort();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Provider": provider.name,
    // 前缀指纹随响应头发下去，方便内测时核对缓存有没有串卡
    "X-Cache-Key": cacheKey,
  };
  if (baseURL && isInsecureBaseURL(baseURL)) {
    headers["X-Insecure-Base-URL"] = "1";
  }

  return new Response(stream, { headers });
}

/**
 * 摘要单独一个端点：POST /api/chat?mode=summarize
 *
 * 为什么不塞进主流程：压缩要额外一次上游调用，硬塞进对话流会让首字时间变长。
 * 独立出来之后，前端可以拿到 meta.needsSummarize 之后再决定什么时候压，
 * 压完把结果存起来，下一轮塞进 context.summary 就行。
 */
export async function PUT(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError({
      status: 400,
      code: "bad_json",
      message: "请求体不是合法 JSON",
    });
  }

  const apiKey = readApiKey(request);
  if (!apiKey) {
    return jsonError({
      status: 401,
      code: "missing_key",
      message: "缺少 API Key",
    });
  }

  if (!isRecord(raw)) {
    return jsonError({ status: 400, code: "bad_request", message: "请求体不是对象" });
  }

  const providerId = asString(raw.providerId);
  const model = asString(raw.model);
  if (!providerId || !model) {
    return jsonError({ status: 400, code: "bad_request", message: "缺少 providerId 或 model" });
  }

  const resolved = resolveBaseURL(providerId, asString(raw.baseURL));
  if ("error" in resolved) {
    return jsonError({ status: 400, code: "bad_base_url", message: resolved.error });
  }

  const previous = asString(raw.previous) ?? "";
  const additions = Array.isArray(raw.additions)
    ? (raw.additions.filter(
        (m): m is ChatMessage =>
          isRecord(m) &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      ) as ChatMessage[])
    : [];
  if (additions.length === 0) {
    return jsonError({ status: 400, code: "bad_request", message: "additions 为空" });
  }

  const messages = buildSummarizeMessages({
    previous,
    additions,
    facts: raw.facts as KeyFacts | undefined,
  });

  const provider = getProvider({
    providerId,
    apiKey,
    baseURL: resolved.baseURL,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  let text = "";
  try {
    const events = await provider.open({
      messages,
      model,
      temperature: 0.3,
      maxTokens: 800,
      signal: request.signal,
    });
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") throw new Error(event.message);
    }
  } catch (error) {
    return jsonError(toChatError(error, apiKey), { provider: provider.name });
  }

  const coveredIndex =
    typeof raw.coveredIndex === "number" ? raw.coveredIndex : additions.length;
  const compressedCount =
    typeof raw.compressedCount === "number" ? raw.compressedCount : 0;
  const { prose, facts: extracted } = parseFactsPayload(text);
  const summary = applySummary(
    { text: previous, coveredIndex: 0, compressedCount },
    prose,
    coveredIndex,
  );
  const facts = mergeFacts(
    sanitizeIncomingFacts(raw.facts),
    extracted,
  );

  return Response.json({ summary, facts, raw: text.trim() });
}

/** 建议输入：原样转发 messages，不组装，也不记进角色扮演的缓存命中率。 */
async function complete(request: Request, body: CompleteRequestBody): Promise<Response> {
  const apiKey = readApiKey(request);
  if (!apiKey) {
    return jsonError({
      status: 401,
      code: "missing_key",
      message: "缺少 API Key，请在连接设置里填一个",
    });
  }

  let baseURL = "";
  {
    const resolved = resolveBaseURL(body.providerId, body.baseURL);
    if ("error" in resolved) {
      return jsonError({ status: 400, code: "bad_base_url", message: resolved.error });
    }
    baseURL = resolved.baseURL;
  }

  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const provider = getProvider({
    providerId: body.providerId,
    apiKey: apiKey ?? "",
    baseURL,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  let events: Awaited<ReturnType<typeof provider.open>>;
  try {
    events = await provider.open({
      messages: body.messages,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      signal: controller.signal,
    });
  } catch (error) {
    return jsonError(toChatError(error, apiKey ?? undefined), { provider: provider.name });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const encoder = new TextEncoder();
      const send = (frame: Parameters<typeof encodeSseFrame>[0]) => {
        try {
          streamController.enqueue(encoder.encode(encodeSseFrame(frame)));
        } catch {
          // 流已被取消
        }
      };
      try {
        for await (const event of events) {
          if (controller.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          send({ type: "error", message: toChatError(error, apiKey ?? undefined).message });
        }
      } finally {
        send("[DONE]");
        try {
          streamController.close();
        } catch {
          // 已经关掉了
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Provider": provider.name,
    },
  });
}

function sanitizeIncomingFacts(value: unknown): KeyFacts {
  const clean = parseFactsPayload(
    `<facts>${JSON.stringify(isRecord(value) ? value : {})}</facts>`,
  ).facts;
  return clean ?? emptyKeyFacts();
}
