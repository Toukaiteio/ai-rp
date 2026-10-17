import type { MetadataRoute } from "next";

/**
 * Web App Manifest：让支持 PWA 的浏览器可以把 ai-rp 安装成独立窗口。
 * 图标使用 SVG，避免把二进制构建产物放进仓库；浏览器会按声明的尺寸缩放。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ai-rp",
    short_name: "ai-rp",
    description: "极简的 Serverless AI 角色扮演游戏",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#161616",
    theme_color: "#161616",
    lang: "zh-CN",
    icons: [
      {
        src: "/icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
