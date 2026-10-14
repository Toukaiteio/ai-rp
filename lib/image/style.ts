/** 生图风格。默认现代日系平涂，每次出图都带上，保证同一角色尽量是同一套画法。 */
export const IMAGE_STYLES = {
  "jp-flat": {
    label: "现代日系平涂",
    prompt:
      "modern Japanese anime illustration, flat cel shading, clean uniform lineart, soft even lighting, muted colors, consistent character design, single scene, no text, no watermark, no speech bubbles",
  },
  watercolor: {
    label: "水彩插画",
    prompt:
      "watercolor illustration, soft edges, paper texture, gentle light, consistent character design, single scene, no text, no watermark, no speech bubbles",
  },
} as const;

export type ImageStyleId = keyof typeof IMAGE_STYLES;

export const DEFAULT_IMAGE_STYLE: ImageStyleId = "jp-flat";

export function stylePrompt(id: string | undefined): string {
  if (id && id in IMAGE_STYLES) return IMAGE_STYLES[id as ImageStyleId].prompt;
  return IMAGE_STYLES[DEFAULT_IMAGE_STYLE].prompt;
}

export function styleLabel(id: string | undefined): string {
  if (id && id in IMAGE_STYLES) return IMAGE_STYLES[id as ImageStyleId].label;
  return IMAGE_STYLES[DEFAULT_IMAGE_STYLE].label;
}

/** 设置页里的常用模型名。真正生效的是用户填的那一个，空着就等于没配。 */
export const IMAGE_MODEL_PRESETS = ["gpt-image-1", "dall-e-3", "dall-e-2"] as const;
