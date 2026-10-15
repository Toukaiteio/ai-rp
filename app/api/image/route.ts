import {
  buildPromptWriterMessages,
  buildScoreMessages,
  parseImagePrompt,
  parseScore,
} from "@/lib/image";
import { generateImage } from "@/lib/providers/images";
import {
  getProvider,
  isInsecureBaseURL,
  resolveBaseURL,
  toChatError,
  type ChatErrorInfo,
} from "@/lib/providers";
import type { ChatMessage } from "@/lib/prompt/types";

export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readKey(request: Request, header: string): string | null {
  const raw = request.headers.get(header);
  if (!raw) return null;
  if (header === "authorization") {
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match ? match[1].trim() : null;
  }
  return raw.trim() || null;
}

function jsonError(info: ChatErrorInfo) {
  return Response.json({ error: info }, { status: info.status });
}

async function readText(
  providerId: string,
  apiKey: string,
  baseURL: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  maxTokens: number,
): Promise<string> {
  const provider = getProvider({
    providerId,
    apiKey,
    baseURL,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
  const events = await provider.open({
    messages,
    model,
    temperature: 0.4,
    maxTokens,
    signal,
  });
  let text = "";
  for await (const event of events) {
    if (signal.aborted) break;
    if (event.type === "delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return text.trim();
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError({ status: 400, code: "bad_json", message: "请求体不是合法 JSON" });
  }
  if (!isRecord(raw)) {
    return jsonError({ status: 400, code: "bad_request", message: "请求体必须是 JSON 对象" });
  }

  const action = asString(raw.action);
  if (action !== "score" && action !== "generate") {
    return jsonError({ status: 400, code: "bad_request", message: "action 只能是 score 或 generate" });
  }

  const providerId = asString(raw.providerId);
  const model = asString(raw.model)?.trim();
  if (!providerId || !model) {
    return jsonError({ status: 400, code: "bad_request", message: "缺少对话模型" });
  }

  const chatKey = readKey(request, "authorization");
  if (!chatKey) {
    return jsonError({ status: 401, code: "missing_key", message: "缺少 API Key" });
  }

  const resolvedChat = resolveBaseURL(providerId, asString(raw.baseURL));
  if ("error" in resolvedChat) {
    return jsonError({ status: 400, code: "bad_base_url", message: resolvedChat.error });
  }
  const chatBase = resolvedChat.baseURL;

  const scene = asString(raw.scene) ?? "";
  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  if (action === "score") {
    try {
      const text = await readText(
        providerId,
        chatKey,
        chatBase,
        model,
        buildScoreMessages(scene),
        controller.signal,
        16,
      );
      const score = parseScore(text);
      if (score === null) {
        return jsonError({ status: 502, code: "bad_score", message: "评分未返回数值" });
      }
      return Response.json({ score });
    } catch (error) {
      return jsonError(toChatError(error, chatKey ?? undefined));
    }
  }

  const imageModel = asString(raw.imageModel)?.trim() ?? "";
  if (!imageModel) {
    return jsonError({ status: 400, code: "no_image_model", message: "未配置生图模型" });
  }

  const imageKey = readKey(request, "x-image-key") || chatKey;
  const imageProvider = asString(raw.imageProviderId) || providerId;
  if (!imageKey) {
    return jsonError({ status: 401, code: "missing_key", message: "缺少生图 API Key" });
  }

  const resolvedImage = resolveBaseURL(imageProvider, asString(raw.imageBaseURL) || asString(raw.baseURL));
  if ("error" in resolvedImage) {
    return jsonError({ status: 400, code: "bad_base_url", message: resolvedImage.error });
  }
  const imageBase = resolvedImage.baseURL;

  const name = asString(raw.name) ?? "";
  const appearance = asString(raw.appearance) ?? "";
  const styleId = asString(raw.styleId);

  try {
    const written = await readText(
      providerId,
      chatKey,
      chatBase,
      model,
      buildPromptWriterMessages({ name, appearance, scene, styleId }),
      controller.signal,
      300,
    );
    const prompt = parseImagePrompt(written);
    if (!prompt) {
      return jsonError({ status: 502, code: "empty_prompt", message: "未生成作画提示词" });
    }

    const image = await generateImage({
      apiKey: imageKey,
      baseURL: imageBase,
      model: imageModel,
      prompt,
      signal: controller.signal,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
    });

    const headers: Record<string, string> = {};
    if (imageBase && isInsecureBaseURL(imageBase)) headers["X-Insecure-Base-URL"] = "1";
    return Response.json({ prompt, src: image.src, styleId: styleId ?? "jp-flat" }, { headers });
  } catch (error) {
    return jsonError(toChatError(error, imageKey ?? chatKey ?? undefined));
  }
}
