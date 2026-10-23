import {
  APIError as AnthropicAPIError,
  APIConnectionTimeoutError as AnthropicTimeoutError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { toChatError } from "./errors";

describe("Anthropic provider errors", () => {
  it("maps Anthropic HTTP errors without exposing the upstream message", () => {
    const error = new AnthropicAPIError(
      401,
      { error: { type: "authentication_error", message: "invalid sk-ant-secret" } },
      "invalid sk-ant-secret",
      new Headers(),
      "authentication_error",
    );

    expect(toChatError(error)).toEqual({
      status: 401,
      code: "authentication_error",
      message: "Key 无效或已过期，请重新获取",
    });
  });

  it("maps Anthropic connection timeouts", () => {
    expect(toChatError(new AnthropicTimeoutError())).toEqual({
      status: 504,
      code: "timeout",
      message: "连接提供商超时，请检查 Base URL 与网络",
    });
  });
});
