import { describe, expect, it } from "vitest";
import { packMemories } from "./archive";
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
      turn: 3,
      updatedAt: 1,
    };
    const [packed] = packMemories([memory]);
    expect(packed.journal?.characters["阿宁"]?.detail).toBe("刚下船");
    expect(packed.journal?.portraits?.["阿宁"]).toBe("data:image/jpeg;base64,abc");
    expect(packed.turn).toBe(3);
  });
});
