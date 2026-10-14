import type { ReactNode } from "react";
import { cn } from "./cn";

/* 场景 CG：挂在最后一条回复下方，图上一颗胶囊说明来源。
   没有 src 时用 children 顶替画面（占位、已有节点都行）。 */
export function CgCard({
  src,
  alt,
  caption,
  icon,
  children,
  className,
}: {
  src?: string;
  alt?: string;
  caption?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mt-1 overflow-hidden rounded-card bg-surface-2",
        className,
      )}
    >
      {src ? (
        /* 图片来自本机生成结果或用户卡片，尺寸未知，交给浏览器按容器裁切 */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt ?? ""}
          className="aspect-[16/10] w-full object-cover"
        />
      ) : (
        children
      )}
      {caption ? (
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-[7px] rounded-pill bg-overlay px-[13px] py-[5px] text-xs text-overlay-ink backdrop-blur-sm">
          {icon}
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/* 生图等待态：占住同样的位置和比例，避免生成完成后页面跳动 */
export function CgLoading({
  label = "正在生成场景 CG……",
  className,
}: {
  label?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex aspect-[16/10] flex-col items-center justify-center gap-2.5 rounded-card bg-surface-2 text-sm text-ink-2",
        className,
      )}
    >
      <span className="spin-ring" />
      {label}
    </div>
  );
}
