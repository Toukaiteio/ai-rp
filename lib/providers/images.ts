import OpenAI from "openai";

export interface GeneratedImage {
  /** 可直接放进 img src 的地址：data URL 或上游给的临时 URL */
  src: string;
}

/**
 * OpenAI Images 及兼容接口。
 * 用官方 SDK，不自己拼 multipart。b64 优先，只有 URL 时才退回 URL
 * （URL 会过期，能拿 b64 就拿 b64，方便存进会话）。
 */
export async function generateImage(options: {
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GeneratedImage> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? 120_000,
    maxRetries: 0,
  });

  const dalle = /dall-e/i.test(options.model);
  const result = await client.images.generate(
    {
      model: options.model,
      prompt: options.prompt,
      n: 1,
      size: "1024x1024",
      ...(dalle ? { response_format: "b64_json" as const } : {}),
    },
    { signal: options.signal },
  );

  const item = result.data?.[0];
  if (item?.b64_json) {
    return { src: `data:image/png;base64,${item.b64_json}` };
  }
  if (item?.url) return { src: item.url };
  throw new Error("生图接口没有返回图片");
}
