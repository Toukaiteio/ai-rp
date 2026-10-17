/** 嵌进 EPUB 之前的图片上限。超过就缩小、再降质量，避免一张 CG 把书撑到几十兆。 */
export const MAX_IMAGE_EDGE = 800;
export const MAX_IMAGE_BYTES = 180_000;

export function clampEdge(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

async function drawFitted(src: string, edge: number): Promise<HTMLCanvasElement | null> {
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
  if (!loaded) return null;

  const size = clampEdge(image.naturalWidth || image.width, image.naturalHeight || image.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, size.width, size.height);
  } catch {
    return null;
  }
  return canvas;
}

/** 把 data URL 或图片地址压成较小的 JPEG。解不了就返回 null，导出时跳过这张图。 */
export async function compressImage(src: string): Promise<Blob | null> {
  let edge = MAX_IMAGE_EDGE;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = await drawFitted(src, edge);
    if (!canvas) return null;
    for (const quality of [0.72, 0.55, 0.4]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
      if (blob && attempt === 3 && quality === 0.4) return blob;
    }
    edge = Math.round(edge * 0.7);
  }
  return null;
}

/** 没有 CG 时用角色名画一张封面，同样走 JPEG，不塞未压缩的原图。 */
export async function renderNameCover(name: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画不了封面");
  context.fillStyle = "#161616";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ededed";
  context.textAlign = "center";
  context.font = "160px sans-serif";
  context.fillText(name.slice(0, 1) || "·", 400, 620);
  context.font = "42px sans-serif";
  context.fillText(name.slice(0, 18), 400, 740);
  const blob = await canvasBlob(canvas, 0.8);
  if (!blob) throw new Error("封面导出失败");
  return blob;
}
