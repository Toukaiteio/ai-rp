import { describe, expect, it } from "vitest";
import { authHeaders, cleanApiKey, headerSafeValue } from "./apikey";

/** 头值只能是 ISO-8859-1，这里模拟浏览器的检查。 */
function isHeaderSafe(value: string): boolean {
  for (const ch of value) {
    if (ch.codePointAt(0)! > 255) return false;
  }
  return true;
}

describe("cleanApiKey", () => {
  it("普通 Key 原样通过", () => {
    expect(cleanApiKey("sk-abc123")).toEqual({ value: "sk-abc123", removed: 0 });
  });

  it("清掉粘贴带来的尾随换行与空白，且不算可疑字符", () => {
    expect(cleanApiKey("  sk-abc123\n\t ")).toEqual({ value: "sk-abc123", removed: 0 });
  });

  it("全角空格、零宽字符、BOM、中文都清掉并计数", () => {
    for (const junk of ["\u3000", "\u200B", "\uFEFF", "\u4E2D", "\u2018"]) {
      const result = cleanApiKey(`sk-a${junk}b`);
      expect(result.value).toBe("sk-ab");
      expect(result.removed).toBe(1);
    }
  });

  it("整段粘贴中文说明时，清洗结果不会进请求头", () => {
    const result = cleanApiKey("我的密钥是 sk-abc");
    expect(result.value).toBe("sk-abc");
    expect(result.removed).toBeGreaterThan(0);
  });

  it("清洗后的值一定可以放进请求头", () => {
    const messy = "sk-\u4E2D\u3000a\u200Bb\uFEFFc\n";
    expect(isHeaderSafe(cleanApiKey(messy).value)).toBe(true);
  });

  it("空输入不会凭空造出内容", () => {
    expect(cleanApiKey("")).toEqual({ value: "", removed: 0 });
    expect(cleanApiKey("   \n")).toEqual({ value: "", removed: 0 });
  });

  it("整段都是非法字符时结果为「没有 Key」", () => {
    expect(cleanApiKey("我的密钥").value).toBe("");
    expect(cleanApiKey("我的密钥").removed).toBe(4);
  });
});

describe("authHeaders", () => {
  it("干净的 Key 生成 Bearer 头", () => {
    expect(authHeaders("sk-abc123")).toEqual({ Authorization: "Bearer sk-abc123" });
  });

  it("空 Key 返回空对象，调用方直接展开即可", () => {
    expect(authHeaders("")).toEqual({});
    expect(authHeaders("   ")).toEqual({});
    expect(authHeaders("\u3000\u200B")).toEqual({});
  });

  it("脏 Key 不会让 fetch 抛 non ISO-8859-1 错误", () => {
    for (const messy of ["sk-a\u3000b", "sk-a\u200Bb", "sk-a\uFEFFb", "我的密钥是 sk-abc"]) {
      const headers = authHeaders(messy);
      for (const value of Object.values(headers)) {
        expect(isHeaderSafe(value)).toBe(true);
      }
    }
  });
});

describe("headerSafeValue", () => {
  it("中文提供商名兜底文案被清成可放进响应头的值", () => {
    expect(headerSafeValue("Chat Completions · 自定义地址")).toBe("Chat Completions · ");
  });

  it("正常主机名不受影响", () => {
    expect(headerSafeValue("Chat Completions · router.dys.asia")).toBe(
      "Chat Completions · router.dys.asia",
    );
  });

  it("结果始终可以放进响应头", () => {
    expect(isHeaderSafe(headerSafeValue("自定义"))).toBe(true);
  });
});
