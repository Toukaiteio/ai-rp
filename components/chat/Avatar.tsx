"use client";

import { useState } from "react";
import { avatarProxyUrl } from "@/lib/cards/online";

/**
 * 头像。
 *
 * 有立绘地址就显示立绘，取不到（不是从卡源来的卡、被网络挡住、图挂了）
 * 就退回按名字生成的首字母。立绘走本项目中转，浏览器只跟同源说话。
 */
export function Avatar({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src.startsWith("data:") ? src : avatarProxyUrl(src)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <span className="grid h-full w-full place-items-center bg-surface-3 font-serif text-sm font-black text-ink-2">
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}
