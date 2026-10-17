/** 聊天附图。先缩到最长边 1280，再压成 jpeg，避免把整张原图塞进请求。 */

const MAX_EDGE = 1280;
const MAX_DATA_URL = 1_500_000;

export async function readChatImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("not-image");
  }
  const dataUrl = await blobToDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no-canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  if (jpeg.length > MAX_DATA_URL) throw new Error("too-large");
  return jpeg;
}

function blobToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode"));
    image.src = src;
  });
}

/** 角色头像压成小图再进记忆和存档。1024 的原图一张就能占掉几百 KB。 */
export async function shrinkPortrait(src: string): Promise<string> {
  const image = await loadImage(src);
  const edge = 128;
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no-canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** 把生图结果固化为本机可保存的 JPEG，避免上游签名 URL 过期。 */
export async function persistGeneratedImage(src: string): Promise<string> {
  const source = src.startsWith("data:image/") ? src : await fetchImageDataUrl(src);
  const image = await loadImage(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no-canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  if (jpeg.length > MAX_DATA_URL) throw new Error("too-large");
  return jpeg;
}

async function fetchImageDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error("image-fetch");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not-image");
  return blobToDataUrl(blob);
}

/** 只接受浏览器压出来的 data URL，拒绝别的地址，免得把任意 URL 转给上游。 */
export function isChatImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,") && value.length <= MAX_DATA_URL;
}
