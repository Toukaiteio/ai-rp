"use client";

import { useEffect } from "react";

/** 注册 PWA 的离线壳。API 请求不会交给 service worker 缓存。 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // 安装不是聊天的前置条件。浏览器不支持或阻止 SW 时继续正常使用网页。
    });
  }, []);

  return null;
}
