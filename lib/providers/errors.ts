import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  OpenAIError,
} from "openai";

/** 返回给浏览器的一条错误。message 是给人看的中文，绝不包含 Key。 */
export interface ChatErrorInfo {
  status: number;
  code: string;
  message: string;
}

/**
 * 已知状态码用固定文案，不转发上游原文。
 * 上游的 401 报错常常会把 Key 的前后缀拼在 message 里，
 * 只要固定文案覆盖了，就不存在泄露路径。
 */
const STATUS_MESSAGES: Record<number, string> = {
  400: "请求被提供商拒绝，可能是模型不支持当前参数",
  401: "Key 无效或已过期，请重新获取",
  402: "账户额度不足",
  403: "Key 没有访问该模型的权限",
  404: "模型不存在，或 Base URL 路径不对",
  408: "提供商响应超时",
  413: "上下文过长，超出模型上限",
  422: "请求参数不被提供商接受",
  429: "请求过于频繁或额度已用尽，稍后再试",
  500: "提供商内部错误",
  502: "提供商网关错误",
  503: "提供商暂时不可用",
  504: "提供商网关超时",
};

/** 兜底：把任何形似密钥的片段抹掉。 */
export function redact(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey) {
    out = out.split(apiKey).join("***");
  }
  return out.replace(
    /\b(?:sk|sk-proj|sk-or|rk|api[_-]?key|bearer)[-_ ]?[A-Za-z0-9_\-]{8,}/gi,
    "***",
  );
}

function isKnownStatus(status: number): boolean {
  return Object.prototype.hasOwnProperty.call(STATUS_MESSAGES, status);
}

/**
 * 把 SDK 抛出的错误收敛成 { status, code, message }。
 *
 * 三条硬规则：
 * 1. 绝不转发 error.headers（里面带 Authorization 回显与 request id）。
 * 2. 已知状态码只用固定文案，不碰上游 message。
 * 3. 所有出口再走一遍 redact()，作为最后一道保险。
 */
export function toChatError(error: unknown, apiKey?: string): ChatErrorInfo {
  const finish = (info: ChatErrorInfo): ChatErrorInfo => ({
    ...info,
    message: redact(info.message, apiKey).slice(0, 300),
  });

  if (error instanceof APIUserAbortError) {
    return finish({ status: 499, code: "aborted", message: "已停止生成" });
  }

  if (error instanceof APIConnectionTimeoutError) {
    return finish({
      status: 504,
      code: "timeout",
      message: "连接提供商超时，请检查 Base URL 与网络",
    });
  }

  if (error instanceof APIConnectionError) {
    return finish({
      status: 502,
      code: "connection",
      message: "无法连接到提供商，请检查 Base URL 与网络",
    });
  }

  if (error instanceof APIError) {
    const status = typeof error.status === "number" ? error.status : 502;
    const known = isKnownStatus(status);
    return finish({
      status,
      code: error.code ?? error.type ?? `http_${status}`,
      message: known
        ? STATUS_MESSAGES[status]
        : `提供商返回了未预期的错误（HTTP ${status}）`,
    });
  }

  if (error instanceof OpenAIError) {
    return finish({
      status: 502,
      code: "provider",
      message: "调用提供商失败",
    });
  }

  return finish({
    status: 500,
    code: "unknown",
    message: "生成失败",
  });
}
