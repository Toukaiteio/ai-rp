import type { ChatMessage } from "@/lib/prompt/types";

/** 不写进 providers.json。探测到能响应才出现在设置里。 */
export const BROWSER_PROVIDER_ID = "browser";

interface ContentPart {
  type: "text" | "image";
  value: string | Blob;
}

interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ModelSession {
  prompt(input: string | ModelMessage[], options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming?(
    input: string | ModelMessage[],
    options?: { signal?: AbortSignal },
  ): ReadableStream<string> | AsyncIterable<string>;
  destroy?: () => void;
}

interface LanguageModelApi {
  availability(options?: { expectedInputs?: { type: string }[] }): Promise<string>;
  create(options?: {
    temperature?: number;
    expectedInputs?: { type: string }[];
    initialPrompts?: ModelMessage[];
    signal?: AbortSignal;
  }): Promise<ModelSession>;
}

/** 模型已经在本机，调用就能出字。还要下载的不算。 */
export function browserModelIsReady(status: string): boolean {
  return status === "available" || status === "readily";
}

function languageModel(): LanguageModelApi | null {
  const api = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
  if (!api || typeof api.availability !== "function" || typeof api.create !== "function") return null;
  return api;
}

let probe: Promise<boolean> | null = null;

/** 带图片输入探测。接口不在，或模型还没准备好，都是 false。 */
export function probeBrowserModel(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      const api = languageModel();
      if (!api) return false;
      try {
        const status = await api.availability({ expectedInputs: [{ type: "image" }] });
        return browserModelIsReady(status);
      } catch {
        return false;
      }
    })();
  }
  return probe;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

const expectedInputs = [{ type: "text" }, { type: "image" }];

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function emitChunk(acc: string, chunk: string): { acc: string; delta: string } {
  if (!chunk) return { acc, delta: "" };
  if (acc && chunk.startsWith(acc)) return { acc: chunk, delta: chunk.slice(acc.length) };
  return { acc: acc + chunk, delta: chunk };
}

async function readOutput(
  session: ModelSession,
  input: string | ModelMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (session.promptStreaming) {
    const stream = await session.promptStreaming(input, { signal });
    let acc = "";
    if (stream && typeof (stream as ReadableStream<string>).getReader === "function") {
      const reader = (stream as ReadableStream<string>).getReader();
      try {
        for (;;) {
          if (signal?.aborted) throw abortError();
          const { done, value } = await reader.read();
          if (done) break;
          const next = emitChunk(acc, String(value ?? ""));
          acc = next.acc;
          if (next.delta) onDelta(next.delta);
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }
    for await (const value of stream as AsyncIterable<string>) {
      if (signal?.aborted) throw abortError();
      const next = emitChunk(acc, String(value ?? ""));
      acc = next.acc;
      if (next.delta) onDelta(next.delta);
    }
    return;
  }
  const text = await session.prompt(input, { signal });
  if (text) onDelta(text);
}

function splitTranscript(messages: ChatMessage[]): { initial: ModelMessage[]; last: ChatMessage | undefined } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const dialogue = messages.filter((message) => message.role !== "system");
  const last = dialogue[dialogue.length - 1];
  const earlier = last ? dialogue.slice(0, -1) : dialogue;
  const initial: ModelMessage[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    ...earlier.map((message) => ({ role: message.role, content: message.content })),
  ];
  return { initial, last };
}

/** 不能看图的远程模型，用本机模型把图说成文字。 */
export async function describeImage(dataUrl: string, signal?: AbortSignal): Promise<string> {
  const api = languageModel();
  if (!api) throw new Error("unavailable");
  const blob = await dataUrlToBlob(dataUrl);
  const session = await api.create({
    temperature: 0.2,
    expectedInputs,
    signal,
  });
  try {
    const reply = await session.prompt(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              value: "用两三句中文描述这张图里看得见的人、场景和动作。不要评价，不要编故事。",
            },
            { type: "image", value: blob },
          ],
        },
      ],
      { signal },
    );
    return reply.trim();
  } finally {
    session.destroy?.();
  }
}

/** 整段对话在本机模型上接着写。图片只附在最后一条玩家消息上。 */
export async function streamBrowserChat(options: {
  messages: ChatMessage[];
  temperature: number;
  image?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const api = languageModel();
  if (!api) throw new Error("unavailable");
  const { initial, last } = splitTranscript(options.messages);
  const temperature = Math.min(1, Math.max(0, options.temperature));
  let session: ModelSession;
  try {
    session = await api.create({
      temperature,
      expectedInputs,
      initialPrompts: initial,
      signal: options.signal,
    });
  } catch {
    session = await api.create({ temperature, expectedInputs, signal: options.signal });
  }
  try {
    const text = last?.content ?? "";
    const input: string | ModelMessage[] = options.image
      ? [
          {
            role: "user",
            content: [
              ...(text ? [{ type: "text" as const, value: text }] : []),
              { type: "image" as const, value: await dataUrlToBlob(options.image) },
            ],
          },
        ]
      : text;
    await readOutput(session, input, options.onDelta, options.signal);
  } finally {
    session.destroy?.();
  }
}
