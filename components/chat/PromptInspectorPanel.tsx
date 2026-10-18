"use client";

/**
 * Prompt Inspector（Phase 10）。
 *
 * 显示**最终发给模型的消息顺序**，每条带 role、来源、token 估算，
 * 以及这一轮激活了哪些世界书条目。SillyTavern 把它当作定位异常输出的
 * 主要工具，理由是一样的：出问题时第一件要确认的事是
 * 「模型到底看到了什么」，而不是「我以为它看到了什么」。
 *
 * 面板里的正文是**发给模型的内容本身**，所以它和 DevReportPanel 分开：
 * 报告那边刻意只存长度和计数，这边必须带正文才叫 Inspector。
 * 两个页签共用一个面板，数据都在内存里，刷新即失。
 */
import { useState, useSyncExternalStore } from "react";
import { cn } from "@/components/ui/cn";
import { inspectorLog, inspectorSnapshot, subscribeReports } from "@/lib/engine/dev-log";
import {
  SECTION_LABELS,
  type InspectorMessage,
  type InspectorSection,
  type PromptInspector,
} from "@/lib/prompt/inspector";

/** 每段一个颜色，和面板里的报告页签区分开。 */
const SECTION_TONE: Record<InspectorSection, string> = {
  system: "text-ink-2",
  card: "text-ink",
  voice: "text-ink",
  worldbook: "text-act",
  scene: "text-ink-2",
  history: "text-ink-3",
  director: "text-ink-2",
  note: "text-ink",
  post_history: "text-ink-2",
  user: "text-ink",
};

const LAYER_LABELS = {
  prefix: "前缀（吃缓存）",
  history: "历史",
  post: "回合层",
} as const;

/** 面板里显示层级：前缀吃缓存，其余每轮都变。 */
function layerLabel(layer: keyof typeof LAYER_LABELS): string {
  return LAYER_LABELS[layer];
}

export function PromptInspectorView() {
  const inspectors = useSyncExternalStore(subscribeReports, inspectorSnapshot, inspectorSnapshot);
  const [picked, setPicked] = useState(0);

  // 没有历史记录时给一个空壳，面板结构照样显示出来
  const list = inspectors.length > 0 ? inspectors : [EMPTY];
  const index = Math.min(picked, list.length - 1);
  const inspector = list[index];

  return (
    <div>
      {inspectors.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {inspectors.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={i === index}
              onClick={() => setPicked(i)}
              className={cn(
                "rounded-pill border px-2.5 py-1 font-mono text-[11px] transition-colors",
                i === index
                  ? "border-line-strong bg-surface-3 text-ink"
                  : "border-line bg-surface-2 text-ink-3 hover:border-line-strong",
              )}
            >
              {i === inspectors.length - 1 ? "最新" : `-${inspectors.length - 1 - i}`}
            </button>
          ))}
        </div>
      ) : null}

      <p className="m-0 mb-3 font-mono text-[11px] leading-relaxed text-ink-3">
        {inspector.totals.messages} 条 · {inspector.totals.tokens} token · 前缀{" "}
        {inspector.totals.prefixTokens} / 历史 {inspector.totals.historyTokens} / 回合{" "}
        {inspector.totals.postTokens}
      </p>

      {inspector.lorebook.length > 0 ? (
        <div className="mb-3 rounded-card border border-line bg-surface-2 px-3 py-2.5">
          <p className="m-0 mb-1.5 text-[11.5px] font-bold text-ink">
            激活的世界书条目 {inspector.lorebook.length} 条
          </p>
          <ul className="m-0 list-none space-y-1 p-0">
            {inspector.lorebook.map((item, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed">
                <span className="font-mono text-[10.5px] text-ink-3">
                  [{item.source}/{item.priority}]
                </span>{" "}
                <span className="text-ink-2">
                  {item.keys.length > 0 ? `命中 ${item.keys.join("、")} · ` : ""}
                  {item.content.slice(0, 40)}
                  {item.content.length > 40 ? "…" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {inspector.sections.map((summary) => (
          <section key={summary.section}>
            <header className="mb-1 flex items-baseline gap-2">
              <span className={cn("text-[12px] font-bold", SECTION_TONE[summary.section])}>
                [{SECTION_LABELS[summary.section]}]
              </span>
              <span className="font-mono text-[10.5px] text-ink-3">
                {summary.count} 条 · {summary.tokens}t
              </span>
            </header>
            <ul className="m-0 list-none space-y-1 p-0">
              {inspector.messages
                .filter((message) => message.section === summary.section)
                .map((message) => (
                  <MessageRow key={message.index} message={message} />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: InspectorMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">#{message.index}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-ink-2">{message.role}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{message.detail}</span>
        <span className="shrink-0 font-mono text-[10px] text-ink-3">
          {layerLabel(message.layer)}
        </span>
        {message.cached ? (
          <span className="shrink-0 font-mono text-[10px] text-act">cache</span>
        ) : null}
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{message.tokens}t</span>
      </button>
      {open ? (
        <pre className="m-0 mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-line pt-1.5 font-mono text-[11px] leading-relaxed text-ink-2">
          {message.content}
        </pre>
      ) : null}
    </li>
  );
}

/** 还没有任何记录时的空壳，让面板结构可见。 */
const EMPTY: PromptInspector = {
  messages: [],
  sections: [],
  totals: { messages: 0, tokens: 0, prefixTokens: 0, historyTokens: 0, postTokens: 0 },
  lorebook: [],
};

/** 面板顶部的一行摘要，给「当前是第几轮」用。 */
export function inspectorSummary(): string {
  const list = inspectorLog();
  const latest = list[list.length - 1];
  if (!latest) return "还没有记录";
  return `${latest.totals.messages} 条 · ${latest.totals.tokens}t`;
}
