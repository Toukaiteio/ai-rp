import { hashSeed } from "@/lib/seed";
import { getMapPreset } from "./presets";
import { normalizeMapSeed } from "./normalize";
import {
  PROCEDURAL_WORLD_GENERATOR_ID,
  PROCEDURAL_WORLD_GENERATOR_VERSION,
  type GeneratedMap,
  type MapArea,
  type MapBounds,
  type MapCell,
  type MapGenerationConfig,
  type MapParameters,
  type MapPoint,
  type JsonPrimitive,
  type ResolvedMapGeneration,
} from "./types";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function fingerprintText(value: string): string {
  return hashSeed(value).toString(16).padStart(8, "0");
}

export function fingerprintMapGeneration(config: Pick<ResolvedMapGeneration, "generator" | "seed" | "parameters" | "random">): string {
  return fingerprintText(stableJson(config));
}

export const fingerprint = fingerprintMapGeneration;

function unit(seed: string): number {
  return hashSeed(seed) / 0x1_0000_0000;
}

function intParameter(parameters: MapParameters, key: string, fallback: number, min: number, max: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function numberParameter(parameters: MapParameters, key: string, fallback: number, min: number, max: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function boolParameter(parameters: MapParameters, key: string, fallback: boolean): boolean {
  return typeof parameters[key] === "boolean" ? parameters[key] as boolean : fallback;
}

function areaBounds(cells: Array<{ x: number; y: number }>): MapBounds {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return { minX, minY, maxX, maxY };
}

function area(id: string, cells: Array<{ x: number; y: number }>): MapArea {
  const bounds = areaBounds(cells);
  const center: MapPoint = {
    x: Number((cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length).toFixed(3)),
    y: Number((cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length).toFixed(3)),
  };
  return { id, bounds, center, cellCount: cells.length };
}

function resolveRandomValue(rule: { type: string; min?: number; max?: number; step?: number; precision?: number; values?: JsonPrimitive[]; probability?: number }, seed: string): JsonPrimitive {
  const roll = unit(seed);
  if (rule.type === "boolean") return roll < (rule.probability ?? 0.5);
  if (rule.type === "choice") return rule.values?.[Math.min(rule.values.length - 1, Math.floor(roll * (rule.values?.length ?? 1)))] ?? null;
  if (rule.type === "integer") {
    const min = rule.min ?? 0;
    const max = rule.max ?? min;
    const step = rule.step ?? 1;
    const count = Math.floor((max - min) / step) + 1;
    return min + Math.min(count - 1, Math.floor(roll * count)) * step;
  }
  const min = rule.min ?? 0;
  const max = rule.max ?? min;
  const precision = rule.precision ?? 3;
  const scale = 10 ** precision;
  return Math.round((min + (max - min) * roll) * scale) / scale;
}

function mapConfigFromPreset(config: Extract<MapGenerationConfig, { mode: "DEFAULT" }>): ResolvedMapGeneration {
  const preset = getMapPreset(config.preset.id, config.preset.version);
  if (!preset) throw new Error(`未知地图 preset：${config.preset.id}@${config.preset.version}`);
  const resolved = {
    mode: "DEFAULT" as const,
    generator: { ...preset.generator },
    startSeed: "",
    seed: `${preset.ref.id}@${preset.ref.version}`,
    parameters: { ...preset.parameters },
    random: {},
    preset: { ...preset.ref },
  };
  return { ...resolved, fingerprint: fingerprintMapGeneration(resolved) };
}

function mapConfigFromCustom(config: Extract<MapGenerationConfig, { mode: "CUSTOM" }>, startSeed: string): ResolvedMapGeneration {
  const random: Record<string, JsonPrimitive> = {};
  for (const [key, rule] of Object.entries(config.random ?? {})) {
    random[key] = resolveRandomValue(rule, `${startSeed}|${config.generator.id}|${config.generator.version}|${config.seed}|${key}`);
  }
  const resolved = {
    mode: "CUSTOM" as const,
    generator: { ...config.generator },
    startSeed,
    seed: config.seed,
    parameters: { ...(config.parameters ?? {}), ...random },
    random,
  };
  return { ...resolved, fingerprint: fingerprintMapGeneration(resolved) };
}

export function resolveMapGeneration(config: MapGenerationConfig, startSeed: string): ResolvedMapGeneration {
  if (!normalizeMapSeed(startSeed)) throw new Error("startSeed 必须是非空字符串");
  if (config.mode === "DEFAULT") {
    return { ...mapConfigFromPreset(config), startSeed };
  }
  return mapConfigFromCustom(config, startSeed);
}

export function isResolvedMapGeneration(value: unknown): value is ResolvedMapGeneration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ResolvedMapGeneration>;
  return (
    (candidate.mode === "DEFAULT" || candidate.mode === "CUSTOM") &&
    typeof candidate.startSeed === "string" &&
    typeof candidate.seed === "string" &&
    !!candidate.generator &&
    typeof candidate.generator === "object" &&
    typeof candidate.generator.id === "string" &&
    typeof candidate.generator.version === "string" &&
    !!candidate.parameters &&
    typeof candidate.parameters === "object" &&
    !Array.isArray(candidate.parameters) &&
    !!candidate.random &&
    typeof candidate.random === "object" &&
    !Array.isArray(candidate.random) &&
    typeof candidate.fingerprint === "string"
  );
}

function makeAreaMap(cells: MapCell[], prefix: string): MapArea[] {
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const cell of cells) {
    const id = cell[prefix === "region" ? "regionId" : prefix === "continent" ? "continentId" : "islandId"];
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(cell);
    groups.set(id, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, group]) => area(id, group));
}

function presetLandCells(
  config: ResolvedMapGeneration,
  preset: NonNullable<ReturnType<typeof getMapPreset>>,
): MapCell[] | null {
  const mask = preset.landMask;
  if (!mask) return null;
  const regionSize = intParameter(config.parameters, "regionSize", 4, 1, 16);
  const cells: MapCell[] = [];
  const land = new Set<string>();
  for (let y = 0; y < mask.height; y += 1) {
    const row = mask.landMask[y] ?? "";
    for (let x = 0; x < mask.width; x += 1) {
      if (row[x] === "#") land.add(`${x}:${y}`);
    }
  }

  const components: Array<Array<{ x: number; y: number }>> = [];
  const seen = new Set<string>();
  for (const key of land) {
    if (seen.has(key)) continue;
    const [rawX, rawY] = key.split(":");
    const start = { x: Number(rawX), y: Number(rawY) };
    const queue = [start];
    const component: Array<{ x: number; y: number }> = [];
    seen.add(key);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, y: current.y + dy };
        const nextKey = `${next.x}:${next.y}`;
        if (land.has(nextKey) && !seen.has(nextKey)) {
          seen.add(nextKey);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }

  const areaByCell = new Map<string, { type: "continent" | "island"; id: string }>();
  const sortedComponents = components.sort((a, b) => b.length - a.length);
  let continentIndex = 0;
  let islandIndex = 0;
  for (const component of sortedComponents) {
    const isContinent = component.length >= 8;
    const id = isContinent ? `continent-${++continentIndex}` : `island-${++islandIndex}`;
    for (const point of component) areaByCell.set(`${point.x}:${point.y}`, { type: isContinent ? "continent" : "island", id });
  }

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const key = `${x}:${y}`;
      const landCell = areaByCell.get(key);
      const cell: MapCell = {
        id: `cell-${x}-${y}`,
        x,
        y,
        terrain: landCell ? "land" : "water",
        regionId: `region-${Math.floor(y / regionSize)}-${Math.floor(x / regionSize)}`,
      };
      if (landCell?.type === "continent") cell.continentId = landCell.id;
      if (landCell?.type === "island") cell.islandId = landCell.id;
      cells.push(cell);
    }
  }
  return cells;
}

export function generateProceduralWorld(config: ResolvedMapGeneration): GeneratedMap {
  if (config.generator.id !== PROCEDURAL_WORLD_GENERATOR_ID || config.generator.version !== PROCEDURAL_WORLD_GENERATOR_VERSION) {
    throw new Error(`不支持的地图生成器：${config.generator.id}@${config.generator.version}`);
  }
  const width = intParameter(config.parameters, "width", 24, 8, 64);
  const height = intParameter(config.parameters, "height", 12, 6, 36);
  const continents = intParameter(config.parameters, "continents", 3, 1, 8);
  const regionSize = intParameter(config.parameters, "regionSize", 4, 2, 16);
  const landRatio = numberParameter(config.parameters, "landRatio", 0.38, 0.1, 0.85);
  const islandDensity = numberParameter(config.parameters, "islandDensity", 0.08, 0, 0.35);
  const wrapX = boolParameter(config.parameters, "wrapX", true);
  const preset = config.mode === "DEFAULT" && config.preset
    ? getMapPreset(config.preset.id, config.preset.version)
    : undefined;
  const presetCells = preset ? presetLandCells(config, preset) : null;
  if (preset && presetCells) {
    const presetWidth = preset.landMask?.width ?? width;
    const presetHeight = preset.landMask?.height ?? height;
    const grid = Array.from({ length: presetHeight }, (_, y) => presetCells.slice(y * presetWidth, (y + 1) * presetWidth));
    const regions = makeAreaMap(presetCells, "region");
    const islands = makeAreaMap(presetCells, "island");
    const continentAreas = makeAreaMap(presetCells, "continent");
    const landCells = presetCells.filter((cell) => cell.terrain === "land").length;
    return {
      generator: { ...config.generator },
      seed: config.seed,
      fingerprint: config.fingerprint,
      width: presetWidth,
      height: presetHeight,
      grid,
      cells: presetCells,
      regions,
      islands,
      continents: continentAreas,
      stats: {
        width: presetWidth,
        height: presetHeight,
        totalCells: presetCells.length,
        landCells,
        waterCells: presetCells.length - landCells,
        landRatio: Number((landCells / presetCells.length).toFixed(6)),
        regionCount: regions.length,
        islandCount: islands.length,
        continentCount: continentAreas.length,
      },
    };
  }
  const centers = Array.from({ length: continents }, (_, index) => ({
    x: Math.floor(unit(`${config.seed}|continent|${index}|x`) * width),
    y: Math.floor(unit(`${config.seed}|continent|${index}|y`) * height),
  }));
  const radius = Math.sqrt((width * height * landRatio) / (continents * Math.PI)) * 1.15;
  const cells: MapCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const regionId = `region-${Math.floor(y / regionSize)}-${Math.floor(x / regionSize)}`;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centers.length; index += 1) {
        const center = centers[index];
        const dxRaw = Math.abs(x - center.x);
        const dx = wrapX ? Math.min(dxRaw, width - dxRaw) : dxRaw;
        const dy = Math.abs(y - center.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      }
      const noise = unit(`${config.seed}|noise|${x}|${y}`);
      const continentLand = nearestDistance <= radius * (0.72 + noise * 0.42);
      const islandLand = !continentLand && noise < islandDensity;
      const terrain = continentLand || islandLand ? "land" : "water";
      const cell: MapCell = { id: `cell-${x}-${y}`, x, y, terrain, regionId };
      if (continentLand) cell.continentId = `continent-${nearest + 1}`;
      if (islandLand) cell.islandId = `island-${x}-${y}`;
      cells.push(cell);
    }
  }
  const grid = Array.from({ length: height }, (_, y) => cells.slice(y * width, (y + 1) * width));
  const regions = makeAreaMap(cells, "region");
  const islands = makeAreaMap(cells, "island");
  const continentAreas = makeAreaMap(cells, "continent");
  const landCells = cells.filter((cell) => cell.terrain === "land").length;
  const result: GeneratedMap = {
    generator: { ...config.generator },
    seed: config.seed,
    fingerprint: config.fingerprint,
    width,
    height,
    grid,
    cells,
    regions,
    islands,
    continents: continentAreas,
    stats: {
      width,
      height,
      totalCells: cells.length,
      landCells,
      waterCells: cells.length - landCells,
      landRatio: Number((landCells / cells.length).toFixed(6)),
      regionCount: regions.length,
      islandCount: islands.length,
      continentCount: continentAreas.length,
    },
  };
  return result;
}

export const generateMap = generateProceduralWorld;
