import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 开发时从 127.0.0.1 打开和从 localhost 打开不是同一个来源。
     不放行的话，开发资源会被拦下，页面停在服务端那一帧，
     输入框打得进字，解锁按钮却一直是禁用的。 */
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/export/empty-fs.ts" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
