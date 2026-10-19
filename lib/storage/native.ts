import type { VaultBackend } from "./backend";

/**
 * 桌面 / 安卓壳注入的存储桥。
 * 大块密文走 data、local 两个目录；localStorage 由壳在文档开始前镜像到 prefs 文件。
 */

export interface NativeCall {
  op: "get" | "set" | "remove" | "keys" | "clear";
  bucket: "data" | "local";
  key?: string;
  value?: string | null;
}

export interface NativeCallResult {
  ok: boolean;
  value?: string | null;
  keys?: string[];
  error?: string;
}

declare global {
  interface Window {
    __AI_RP_NATIVE__?: boolean;
    __AI_RP_CALL__?: (message: NativeCall) => Promise<NativeCallResult>;
  }
}

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && window.__AI_RP_NATIVE__ === true && typeof window.__AI_RP_CALL__ === "function";
}

async function call(message: NativeCall): Promise<NativeCallResult> {
  const invoke = window.__AI_RP_CALL__;
  if (!invoke) throw new Error("原生存储不可用");
  const result = await invoke(message);
  if (!result?.ok) throw new Error(result?.error || "原生存储失败");
  return result;
}

export function createNativeBackend(bucket: "data" | "local"): VaultBackend {
  return {
    kind: "file",
    async get(key) {
      const result = await call({ op: "get", bucket, key });
      return typeof result.value === "string" ? result.value : null;
    },
    async set(key, value) {
      await call({ op: "set", bucket, key, value });
    },
    async remove(key) {
      await call({ op: "remove", bucket, key });
    },
    async keys() {
      const result = await call({ op: "keys", bucket });
      return Array.isArray(result.keys) ? result.keys.filter((key) => typeof key === "string") : [];
    },
    async clear() {
      await call({ op: "clear", bucket });
    },
  };
}
