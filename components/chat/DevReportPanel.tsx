"use client";

/**
 * 开发模式的提示词结构面板。
 *
 * 只在开发模式（或 URL 带 ?dev=1）出现，画在对话页右上角。
 * 数据来自 lib/engine/dev-log 的内存态，刷新即失。
 * 模型看到的每条消息、来源、token 都在这里，不发请求、不改生成。
 */
import { ActPill, Panel } from "@/components/ui";
import { IconQuality } from "@/components/icons";
import { PromptInspectorView } from "./PromptInspectorPanel";

export function DevReportButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title="提示词结构（开发模式）"
      className="grid size-7 shrink-0 place-items-center rounded-sm bg-surface text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
    >
      <IconQuality className="size-4" />
    </button>
  );
}

export function DevReportPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Panel open={open} className="text-[12.5px]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="m-0 text-[15px] font-bold text-ink">提示词结构</h3>
        <span className="flex-1" />
        <ActPill onClick={onClose}>关闭</ActPill>
      </div>
      <PromptInspectorView />
    </Panel>
  );
}
