import {
  PROCEDURAL_WORLD_GENERATOR_ID,
  PROCEDURAL_WORLD_GENERATOR_VERSION,
  type MapPresetId,
  type MapParameters,
  type MapPresetRef,
} from "./types";
import earthMask from "@/data/maps/earth-mask.json";

export interface MapPresetDefinition {
  ref: MapPresetRef;
  generator: { id: string; version: string };
  parameters: MapParameters;
  landMask?: { width: number; height: number; landMask: string[] };
}

const EARTH_MASK = {
  width: earthMask.width,
  height: earthMask.height,
  landMask: earthMask.landMask,
};

export const MAP_PRESETS: Record<MapPresetId, MapPresetDefinition> = {
  "earth-simplified": {
    ref: { id: "earth-simplified", version: "1" },
    generator: { id: PROCEDURAL_WORLD_GENERATOR_ID, version: PROCEDURAL_WORLD_GENERATOR_VERSION },
    parameters: { width: earthMask.width, height: earthMask.height, regionSize: 4, wrapX: false },
    landMask: EARTH_MASK,
  },
  "earth-political": {
    ref: { id: "earth-political", version: "1" },
    generator: { id: PROCEDURAL_WORLD_GENERATOR_ID, version: PROCEDURAL_WORLD_GENERATOR_VERSION },
    parameters: { width: earthMask.width, height: earthMask.height, regionSize: 3, wrapX: false },
    landMask: EARTH_MASK,
  },
  "earth-physical": {
    ref: { id: "earth-physical", version: "1" },
    generator: { id: PROCEDURAL_WORLD_GENERATOR_ID, version: PROCEDURAL_WORLD_GENERATOR_VERSION },
    parameters: { width: earthMask.width, height: earthMask.height, regionSize: 2, wrapX: false },
    landMask: EARTH_MASK,
  },
  "earth-oceanic": {
    ref: { id: "earth-oceanic", version: "1" },
    generator: { id: PROCEDURAL_WORLD_GENERATOR_ID, version: PROCEDURAL_WORLD_GENERATOR_VERSION },
    parameters: { width: earthMask.width, height: earthMask.height, regionSize: 5, wrapX: false },
    landMask: EARTH_MASK,
  },
};

export function getMapPreset(id: string, version: string): MapPresetDefinition | undefined {
  const preset = MAP_PRESETS[id as MapPresetId];
  return preset?.ref.version === version ? preset : undefined;
}
