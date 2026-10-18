import { describe, expect, it } from "vitest";
import { readCardFile } from "./io";

function buildPngWithCard(card: unknown): Uint8Array {
  const payload = new TextEncoder().encode(`chara\0${Buffer.from(JSON.stringify(card), "utf8").toString("base64")}`);
  const chunks = [
    { type: "IHDR", data: new Uint8Array(13) },
    { type: "tEXt", data: payload },
    { type: "IEND", data: new Uint8Array() },
  ];
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const chunk of chunks) {
    out.push(
      (chunk.data.length >>> 24) & 255,
      (chunk.data.length >>> 16) & 255,
      (chunk.data.length >>> 8) & 255,
      chunk.data.length & 255,
    );
    for (const char of chunk.type) out.push(char.charCodeAt(0));
    out.push(...chunk.data);
    out.push(0, 0, 0, 0);
  }
  return new Uint8Array(out);
}

describe("角色卡文件导入", () => {
  it("可以直接导入酒馆 PNG，并保留 PNG 作为本地封面", async () => {
    const png = buildPngWithCard({ spec: "chara_card_v2", data: { name: "林晚晴", first_mes: "坐。" } });
    const file = new File(
      [png.buffer as ArrayBuffer],
      "lin.png",
      { type: "image/png" },
    );

    const result = await readCardFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.name).toBe("林晚晴");
    expect(result.card.data.extensions?._local).toMatchObject({
      portrait: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it("PNG 没有内嵌角色卡时返回明确错误", async () => {
    const invalid = new Uint8Array([1, 2, 3]);
    const file = new File([invalid.buffer as ArrayBuffer], "not-a-card.png", { type: "image/png" });
    await expect(readCardFile(file)).resolves.toEqual({
      ok: false,
      error: "PNG 中没有找到酒馆角色卡数据",
    });
  });
});
