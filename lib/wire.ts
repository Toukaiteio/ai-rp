import type { ChatStreamEvent } from "@/lib/providers/types";
import type { ScenePatch } from "@/lib/scene";
import type { ThreadPatchEntry } from "@/lib/story";

/**
 * /api/chat 的线上格式：一帧一个 JSON，最后一帧是 [DONE]。
 * meta 帧先把这次组装的观测数据发下来（占用、丢了几条、是否触发压缩、
 * 缓存是否命中），前端顶栏的「记忆」占用就是它算出来的。
 */
export type WireEvent =
  | {
      type: "meta";
      used: number;
      max: number;
      dropped: number;
      kept: number;
      lorebookEntries: number;
      /** 缓存命中率，仅内测统计用，前端不展示给玩家 */
      cacheHit: boolean;
      needsSummarize: boolean;
      provider: string;
      model: string;
      /**
       * 导演顺便给出的状态变化。服务端路径下这是前端唯一能拿到它的地方——
       * 状态要跟着会话落盘，而组装在服务端，所以随 meta 回传。
       */
      statePatch?: ScenePatch;
      threadPatch?: ThreadPatchEntry[];
      /** 这一轮用的回合模式，同样只用于观测 */
      mode?: string;
    }
  | { type: "summary"; text: string; coveredIndex: number }
  | ChatStreamEvent;

export type WireFrame = WireEvent | "[DONE]";

export function encodeSseFrame(frame: WireFrame): string {
  const payload = frame === "[DONE]" ? "[DONE]" : JSON.stringify(frame);
  return `data: ${payload}\n\n`;
}

/**
 * 从累积的缓冲区里切出完整帧，返回剩余的不完整尾巴。
 * 网络分片可能把一个帧劈成两半，调用方必须把 rest 留到下一轮再拼。
 */
export function decodeSseBuffer(buffer: string): {
  frames: WireFrame[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: WireFrame[] = [];

  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      frames.push("[DONE]");
      continue;
    }
    try {
      frames.push(JSON.parse(payload) as WireEvent);
    } catch {
      // 坏帧跳过，不要因此中断整段流
    }
  }

  return { frames, rest };
}

/** 把整条流读完，只拼出正文。用于不需要逐字渲染的次要请求。 */
export async function readSseText(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { frames, rest } = decodeSseBuffer(buffer);
    buffer = rest;

    for (const frame of frames) {
      if (frame === "[DONE]") continue;
      if (frame.type === "delta") text += frame.text;
    }
  }

  return text;
}
