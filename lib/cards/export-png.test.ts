import { describe, expect, it } from "vitest";
import { extractCardJson } from "./png";
import { encodeCardPng } from "./io";

describe("PNG 角色卡导出", () => {
  it("生成酒馆可读取的 chara PNG，并不把本地 base64 封面塞进卡 JSON", () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "测试角色",
        description: "描述",
        personality: "安静",
        scenario: "图书馆",
        first_mes: "你好。",
        extensions: {
          _local: {
            portrait: "data:image/png;base64,ZmFrZQ==",
          },
        },
      },
    } as const;

    const encoded = encodeCardPng(card);
    const extracted = extractCardJson(encoded);
    expect(extracted).toMatchObject({
      spec: "chara_card_v2",
      data: { name: "测试角色" },
    });
    expect((extracted as { data: { extensions?: Record<string, unknown> } }).data.extensions?._local).toBeUndefined();
  });
});
