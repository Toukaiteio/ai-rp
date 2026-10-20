import type { MetadataRoute } from "next";

/**
 * Web App Manifest：让支持 PWA 的浏览器可以把 ai-rp 安装成独立窗口。
 * 图标使用品牌资源，浏览器会按声明的尺寸缩放。
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
        src: "/brand/desktop-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/desktop-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
