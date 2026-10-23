import { describe, expect, it } from "vitest";
import { buildKdfSidecar, kdfSidecarName, packMemories } from "./archive";
import type { CardMemory } from "./local";

describe("存档里的记忆", () => {
  it("人物、地点、事件和头像都会被收进去", () => {
    const memory: CardMemory = {
      cardId: "card-1",
      summary: null,
      facts: { characters: {}, places: {}, flags: {} },
      journal: {
        characters: { 阿宁: "刚下船" } as never,
        places: {},
        events: {},
        portraits: { 阿宁: "data:image/jpeg;base64,abc" },
      },
      attachmentState: {
        mapGenerations: { "world-map": { fingerprint: "abc" } },
      },
      attachmentGenerations: {
        "world-map": { seed: "session-a" },
      },
      turn: 3,
      updatedAt: 1,
    };
    const [packed] = packMemories([memory]);
    expect(packed.journal?.characters["阿宁"]?.detail).toBe("刚下船");
    expect(packed.journal?.portraits?.["阿宁"]).toBe("data:image/jpeg;base64,abc");
    expect(packed.turn).toBe(3);
    expect(packed.attachmentState).toEqual({
      mapGenerations: { "world-map": { fingerprint: "abc" } },
    });
    expect(packed.attachmentGenerations).toEqual({
      "world-map": { seed: "session-a" },
    });
  });

  it("保留没有 attachmentState 的旧记忆形状", () => {
    const [packed] = packMemories([
      {
        cardId: "old-card",
        summary: null,
        facts: { characters: {}, places: {}, flags: {} },
        turn: 0,
        updatedAt: 0,
      },
    ]);
    expect(packed.attachmentState).toBeUndefined();
    expect(packed.attachmentGenerations).toBeUndefined();
  });
});

describe("恢复参数旁文件", () => {
  it("与存档同名，只换后缀", () => {
    expect(kdfSidecarName("ai-rp-archive-2026-10-17.json")).toBe(
      "ai-rp-archive-2026-10-17.kdf.json",
    );
  });

  it("只写盐和迭代次数，不带任何密钥材料", () => {
    const text = buildKdfSidecar({ salt: "AAEC34", iterations: 600000 });
    expect(JSON.parse(text)).toEqual({ salt: "AAEC34", iterations: 600000 });
    expect(Object.keys(JSON.parse(text))).toEqual(["salt", "iterations"]);
  });
});
