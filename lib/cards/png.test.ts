import { describe, expect, it } from "vitest";
import { extractCardJson } from "./png";

/** 现搭最小 PNG：签名 + IHDR + 若干块 + IEND。CRC 读取方不校验，补零即可。 */
function buildPng(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const { type, data } of chunks) {
    out.push(
      (data.length >>> 24) & 255,
      (data.length >>> 16) & 255,
      (data.length >>> 8) & 255,
      data.length & 255,
    );
    for (const char of type) out.push(char.charCodeAt(0));
    for (const byte of data) out.push(byte);
    out.push(0, 0, 0, 0);
  }
  return new Uint8Array(out);
}

function textChunk(keyword: string, payload: string): { type: string; data: Uint8Array } {
  const head = new TextEncoder().encode(`${keyword}\0`);
  const body = new TextEncoder().encode(payload);
  const data = new Uint8Array(head.length + body.length);
  data.set(head, 0);
  data.set(body, head.length);
  return { type: "tEXt", data };
}

const IHDR = { type: "IHDR", data: new Uint8Array(13) };
const IEND = { type: "IEND", data: new Uint8Array(0) };

const CARD = {
  spec: "chara_card_v2",
  data: { name: "测试角色", description: "描述", first_mes: "开场" },
};

function base64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

describe("PNG 内嵌角色卡", () => {
  it("tEXt 里的 base64 卡能拆出来", () => {
    const png = buildPng([IHDR, textChunk("chara", base64(JSON.stringify(CARD))), IEND]);
    expect(extractCardJson(png)).toEqual(CARD);
  });

  it("卡里的中文能原样拆出来", () => {
    const card = { spec: "chara_card_v2", data: { name: "林晚晴", first_mes: "坐。" } };
    const png = buildPng([IHDR, textChunk("chara", base64(JSON.stringify(card))), IEND]);
    expect(extractCardJson(png)).toEqual(card);
  });

  it("少数卡直接把 JSON 原文塞进 tEXt，也认", () => {
    const png = buildPng([IHDR, textChunk("chara", JSON.stringify(CARD)), IEND]);
    expect(extractCardJson(png)).toEqual(CARD);
  });

  it("别的 keyword 不当卡", () => {
    const png = buildPng([IHDR, textChunk("Description", base64(JSON.stringify(CARD))), IEND]);
    expect(extractCardJson(png)).toBeNull();
  });

  it("chara 块里不是 JSON 时返回 null，不抛", () => {
    const png = buildPng([IHDR, textChunk("chara", base64("这不是 JSON")), IEND]);
    expect(extractCardJson(png)).toBeNull();
  });

  it("不是 PNG 返回 null", () => {
    expect(extractCardJson(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(extractCardJson(new Uint8Array(0))).toBeNull();
  });

  it("块长度越界时停手，不抛", () => {
    const png = buildPng([IHDR, textChunk("chara", base64(JSON.stringify(CARD))), IEND]);
    // 第一个块（IHDR）的长度字段改成巨大值，后面就都读不到了
    png[8] = 0x7f;
    expect(extractCardJson(png)).toBeNull();
  });
});
