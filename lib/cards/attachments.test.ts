import { describe, expect, it } from "vitest";
import { parseCharacterCard, serializeCard, toWireCard } from "@/lib/cards";

describe("角色卡 attachment extensions", () => {
  it("normalizes ai-rp attachments and preserves neighboring extension data", () => {
    const result = parseCharacterCard({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "地图角色",
        extensions: {
          "ai-rp": {
            customField: { keep: true },
            attachments: [
              {
                id: "world-map",
                kind: "map",
                generation: { mode: "DEFAULT", preset: { id: "earth-simplified", version: "1" } },
              },
              { id: "future", kind: "future", payload: "keep" },
            ],
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.attachments).toHaveLength(2);
    expect(result.card.data.extensions?.["ai-rp"]).toMatchObject({ customField: { keep: true } });
    expect((result.card.data.extensions?.["ai-rp"] as { attachments?: unknown }).attachments).toEqual(result.card.data.attachments);
  });

  it("round-trips attachments in extensions without writing runtime state to the card", () => {
    const parsed = parseCharacterCard({
      name: "往返角色",
      extensions: {
        "ai-rp": {
          attachments: [{ id: "codex", kind: "codex", entries: [] }],
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const card = parsed.card;
    const wire = toWireCard(card);
    expect(wire.data.attachments).toBeUndefined();
    expect((wire.data.extensions?.["ai-rp"] as { attachments?: unknown }).attachments).toEqual(card.data.attachments);
    const again = parseCharacterCard(JSON.parse(serializeCard(card)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.card.data.attachments).toEqual(card.data.attachments);
  });
});
