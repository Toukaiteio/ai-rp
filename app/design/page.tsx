import type { Metadata } from "next";
import { Showcase } from "./showcase";

export const metadata: Metadata = {
  title: "UI 组件总览 · ai-rp",
  description: "从交互原型提取的 UI 组件与设计令牌",
};

export default function DesignPage() {
  return <Showcase />;
}
