import { describe, expect, it } from "vitest";
import {
  generateMap,
  getMapPreset,
  ATTACHMENT_TOOLS,
  executeAttachmentTool,
  formatAttachmentCatalog,
  normalizeAttachment,
  resolveMapGeneration,
  type MapGenerationConfig,
} from "@/lib/attachments";

const custom: MapGenerationConfig = {
  mode: "CUSTOM",
  generator: { id: "procedural-world-v1", version: "1" },
  seed: "story-seed",
  parameters: { width: 20, height: 10, continents: 2 },
  random: {
    islandDensity: { type: "float", min: 0.02, max: 0.18, precision: 3 },
    regionSize: { type: "integer", min: 2, max: 6 },
  },
};

describe("attachment map generation", () => {
  it("provides stable renderable DEFAULT presets", () => {
    for (const id of ["earth-simplified", "earth-political", "earth-physical", "earth-oceanic"] as const) {
      const preset = getMapPreset(id, "1");
      expect(preset?.ref).toEqual({ id, version: "1" });
      const attachment = normalizeAttachment({
        id: `${id}-map`,
        kind: "map",
        generation: { mode: "DEFAULT", preset: { id, version: "1" } },
      });
      expect(attachment.ok).toBe(true);
      if (!attachment.ok || attachment.attachment.kind !== "map") return;
      const resolved = resolveMapGeneration(
        (attachment.attachment as Extract<typeof attachment.attachment, { kind: "map" }>).generation,
        "session-a",
      );
      const map = generateMap(resolved);
      const otherStart = generateMap(resolveMapGeneration(
        (attachment.attachment as Extract<typeof attachment.attachment, { kind: "map" }>).generation,
        "session-b",
      ));
      expect(map.cells.length).toBe(map.width * map.height);
      expect(map.grid).toHaveLength(map.height);
      expect(map.grid?.every((row) => row.length === map.width)).toBe(true);
      expect(map.regions.length).toBeGreaterThan(0);
      expect(map.stats.totalCells).toBe(map.cells.length);
      expect(generateMap(resolved)).toEqual(map);
      expect(otherStart).toEqual(map);
      expect(map.cells.some((cell) => cell.terrain === "land")).toBe(true);
      expect(map.cells.some((cell) => cell.terrain === "water")).toBe(true);
    }
  });

  it("keeps CUSTOM generation deterministic and fingerprints resolved input", () => {
    const first = resolveMapGeneration(custom, "start-a");
    const second = resolveMapGeneration(custom, "start-a");
    expect(second).toEqual(first);
    expect(generateMap(first)).toEqual(generateMap(second));
    expect(resolveMapGeneration(custom, "start-b")).not.toEqual(first);
    expect(first.random).toHaveProperty("islandDensity");
    expect(first.random).toHaveProperty("regionSize");
  });

  it("rejects random and parameter name collisions", () => {
    const result = normalizeAttachment({
      id: "map-1",
      kind: "map",
      generation: {
        mode: "CUSTOM",
        generator: { id: "procedural-world-v1", version: "1" },
        seed: "seed",
        parameters: { width: 20 },
        random: { width: { type: "integer", min: 1, max: 2 } },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown preset ids and versions", () => {
    expect(normalizeAttachment({
      id: "bad-preset",
      kind: "map",
      generation: { mode: "DEFAULT", preset: { id: "earth-simplified", version: "2" } },
    }).ok).toBe(false);
    expect(normalizeAttachment({
      id: "bad-preset",
      kind: "map",
      generation: { mode: "DEFAULT", preset: { id: "mars", version: "1" } },
    }).ok).toBe(false);
  });
});

describe("attachment declarations", () => {
  it("normalizes codex entries as declarative data", () => {
    const result = normalizeAttachment({
      id: "codex-1",
      kind: "codex",
      entries: [{ id: "entry-1", title: "潮汐", content: "海水每天涨落。", tags: ["地理"] }],
    });
    expect(result).toEqual({
      ok: true,
      attachment: {
        id: "codex-1",
        kind: "codex",
        version: "1",
        entries: [{ id: "entry-1", title: "潮汐", content: "海水每天涨落。", tags: ["地理"], enabled: true }],
      },
    });
  });

  it("normalizes scripts as disabled declarations with fixed permissions", () => {
    const marker = "attachment-script-marker";
    delete (globalThis as Record<string, unknown>)[marker];
    const result = normalizeAttachment({
      id: "script-1",
      kind: "script",
      runtime: "sandbox",
      source: `globalThis.${marker} = true`,
      permissions: { network: true, filesystem: true, cardScope: false },
    });
    expect(result).toEqual({
      ok: true,
      attachment: {
        id: "script-1",
        kind: "script",
         version: "1",
         runtime: "sandbox",
         source: `globalThis.${marker} = true`,
         requestedPermissions: { network: true, filesystem: true, cardScope: false },
         permissions: { network: false, filesystem: false, cardScope: true },
        status: "unsupported",
        enabled: false,
      },
    });
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it("retains unknown kinds without making them executable", () => {
    const result = normalizeAttachment({ id: "future-1", kind: "future", payload: { value: 1 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment).toMatchObject({ kind: "future", payload: { value: 1 } });
  });

  it("exposes declarative query/update tools and never executes scripts", () => {
    const scriptMarker = "attachment-tool-script-marker";
    delete (globalThis as Record<string, unknown>)[scriptMarker];
    const map = normalizeAttachment({
      id: "map-tool",
      kind: "map",
      generation: { mode: "DEFAULT", preset: { id: "earth-simplified", version: "1" } },
    });
    const codex = normalizeAttachment({
      id: "codex-tool",
      kind: "codex",
      entries: [{ id: "entry-1", title: "港口", content: "潮汐影响港口。", tags: [] }],
    });
    const script = normalizeAttachment({
      id: "script-tool",
      kind: "script",
      source: `globalThis.${scriptMarker} = true`,
      requestedPermissions: { network: true, filesystem: true, cardScope: true },
    });
    expect(ATTACHMENT_TOOLS.map((tool) => tool.function.name)).toEqual(["attachment_query", "attachment_update"]);
    expect(map.ok && codex.ok && script.ok).toBe(true);
    if (!map.ok || !codex.ok || !script.ok) return;

    const context = { attachments: [map.attachment, codex.attachment, script.attachment], startSeed: "tool-session" };
    const codexQuery = executeAttachmentTool("attachment_query", JSON.stringify({ attachmentId: "codex-tool", query: "港口" }), context);
    expect(codexQuery.result).toContain("潮汐影响港口");

    const mapUpdate = executeAttachmentTool("attachment_update", JSON.stringify({
      attachmentId: "map-tool",
      operation: "set_map_generation",
      generation: {
        mode: "CUSTOM",
        generator: { id: "procedural-world-v1", version: "1" },
        seed: "updated-seed",
        parameters: { width: 12, height: 6, continents: 2 },
      },
    }), context);
    expect(mapUpdate.result).toContain("已更新地图");
    expect(mapUpdate.maps?.["map-tool"].stats.totalCells).toBe(72);

    const codexUpdate = executeAttachmentTool("attachment_update", JSON.stringify({
      attachmentId: "codex-tool",
      operation: "upsert_codex_entry",
      entry: { id: "entry-2", title: "灯塔", content: "灯塔在夜间点亮。", tags: ["地标"] },
    }), context);
    expect(codexUpdate.result).toContain("当前 2 条");
    expect(codexUpdate.attachments?.find((item) => item.id === "codex-tool")).toMatchObject({ entries: [{ id: "entry-1" }, { id: "entry-2" }] });

    const scriptUpdate = executeAttachmentTool("attachment_update", JSON.stringify({
      attachmentId: "script-tool",
      operation: "set_map_generation",
      generation: { mode: "CUSTOM", generator: { id: "evil", version: "1" }, seed: "x" },
    }), context);
    expect(scriptUpdate.result).toContain("明确拒绝");
    expect((globalThis as Record<string, unknown>)[scriptMarker]).toBeUndefined();
    expect(formatAttachmentCatalog(context.attachments)).toContain("unsupported，不可执行");
  });
});
