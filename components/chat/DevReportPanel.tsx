"use client";

/**
 * 开发模式的本轮观测面板。
 *
 * 只在开发模式（或 URL 带 ?dev=1）出现，画在对话页右上角。
 * 它回答 Phase 0 的那个问题：「这一轮生成经过了哪些检查，结果如何」。
 *
 * 面板里的数据全部来自 lib/engine/dev-log，只在内存里，刷新即失。
 * 不显示玩家输入、不显示模型正文，只显示长度、计数、问题码和 12 字片段。
 */
import { useState, useSyncExternalStore } from "react";
import { ActPill, Capsule, Panel } from "@/components/ui";
import { IconQuality } from "@/components/icons";
import { cn } from "@/components/ui/cn";
import {
  clearReportLog,
  formatReportLine,
  reportSnapshot,
  reportTotals,
  subscribeReports,
} from "@/lib/engine/dev-log";
import { ISSUE_LABELS, type CheckRun, type GenerationReport } from "@/lib/engine/types";
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
      title="文本引擎观测（开发模式）"
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
  const reports = useSyncExternalStore(subscribeReports, reportSnapshot, reportSnapshot);
  const totals = reportTotals(reports);
  /*
   * 两个页签：检查结果 / 提示词结构（Phase 10）。
   *
   * 分页签而不是堆在一起：报告是「这一轮写得怎么样」，Inspector 是
   * 「模型看到了什么」，定位问题时先看哪个是明确的。堆一起会两边都看不清。
   */
  const [tab, setTab] = useState<"checks" | "prompt">("checks");

  return (
    <Panel open={open} className="text-[12.5px]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="m-0 text-[15px] font-bold text-ink">文本引擎观测</h3>
        <span className="text-[11px] text-ink-3">仅内存 · 不落盘</span>
        <span className="flex-1" />
        <ActPill onClick={onClose}>关闭</ActPill>
      </div>

      <div className="mb-3 flex gap-1.5">
        {(
          [
            ["checks", "检查结果"],
            ["prompt", "提示词结构"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] transition-colors",
              tab === value
                ? "border-line-strong bg-surface-3 text-ink"
                : "border-line bg-surface-2 text-ink-3 hover:border-line-strong",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "prompt" ? (
        <PromptInspectorView />
      ) : reports.length === 0 ? (
        <p className="m-0 text-ink-2">
          还没有生成记录。发一轮对话，这里会列出这一轮跑过的检查。
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Capsule tone="strong">近 {totals.rounds} 轮</Capsule>
            <Capsule>不合格 {totals.rejected}</Capsule>
            <Capsule>可修复 {totals.repairable}</Capsule>
            <Capsule>替玩家 {totals.playerControl}</Capsule>
            <Capsule>复读 {totals.repeated}</Capsule>
            <Capsule>坏 act {totals.invalidActs}</Capsule>
          </div>

          {totals.byCode.length > 0 ? (
            <p className="mb-3 text-[11.5px] leading-relaxed text-ink-2">
              高频问题：
              {totals.byCode
                .slice(0, 6)
                .map(([code, count]) => `${labelOf(code)}×${count}`)
                .join("，")}
            </p>
          ) : null}

          <div className="flex flex-col gap-2.5">
            {[...reports].reverse().map((report, reverseIndex) => (
              <ReportCard
                key={`${report.generatedAt}-${reverseIndex}`}
                report={report}
                index={reports.length - reverseIndex}
              />
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <ActPill onClick={clearReportLog}>清空</ActPill>
          </div>
        </>
      )}
    </Panel>
  );
}

function ReportCard({ report, index }: { report: GenerationReport; index: number }) {
  const failed = report.checks.filter(
    (check) => check.status !== "pass" && check.status !== "skip",
  );

  return (
    <section className="rounded-card border border-line bg-surface-2 p-3">
      <header className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-ink-3">
          #{index} · 第 {report.turn} 轮
        </span>
        <VerdictBadge report={report} />
        <span className="text-[11px] text-ink-3">{report.promptVersion}</span>
      </header>

      <p className="m-0 mb-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
        {report.responseLength}字 · {report.blockCount}块 · act {report.actCount}(坏
        {report.invalidActCount}) · dlg {report.dialogueCount} · scene {report.sceneCount} ·
        复读 {report.repeatedPhraseCount} · 语言 {report.language}
        {report.mode ? ` · 模式 ${report.mode}` : ""}
        {report.latencyMs === undefined ? "" : ` · ${report.latencyMs}ms`}
      </p>

      {report.repairAttempted ? (
        <p className={cn("m-0 mb-2 text-[11.5px] leading-relaxed", report.repairSucceeded ? "text-ink-2" : "text-danger")}>
          {report.repairSucceeded ? "自动修复：已修好" : "自动修复：失败"}
          {report.repairNote ? ` · ${report.repairNote}` : ""}
        </p>
      ) : null}

      {report.degradations.length > 0 ? (
        <p className="m-0 mb-2 text-[11.5px] leading-relaxed text-act">
          已降级 {report.degradations.length} 处：
          {report.degradations
            .map((item) => `${item.from}→${item.to}`)
            .join("，")}
        </p>
      ) : null}

      {report.lorebook ? (
        <p className="m-0 mb-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
          世界书：注入 {report.lorebook.injected}/{report.lorebook.matched} · 丢{" "}
          {report.lorebook.dropped} · {report.lorebook.tokens}/{report.lorebook.tokenCap} token
          <br />
          档位 常驻 {report.lorebook.byPriority.constant} · 场景 {report.lorebook.byPriority.scene} · 玩家{" "}
          {report.lorebook.byPriority.player} · 背景 {report.lorebook.byPriority.background}
          <br />
          来源 全局 {report.lorebook.bySource.global} · 角色 {report.lorebook.bySource.card} · 聊天{" "}
          {report.lorebook.bySource.chat}
        </p>
      ) : null}

      <ul className="m-0 list-none space-y-0.5 p-0">
        {report.checks.map((check) => (
          <CheckRow key={check.code} check={check} />
        ))}
      </ul>

      {failed.length === 0 ? (
        <p className="m-0 mt-2 text-[11.5px] text-ink-3">这一轮没有需要处理的问题。</p>
      ) : (
        <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[11.5px] text-ink-2">
          {failed.map((check, i) => (
            <li key={`${check.code}-${i}`}>· {check.detail}</li>
          ))}
        </ul>
      )}

      {report.model ? (
        <p className="m-0 mt-2 truncate font-mono text-[10.5px] text-ink-3">
          {report.providerId} / {report.model}
        </p>
      ) : null}
    </section>
  );
}

function CheckRow({ check }: { check: CheckRun }) {
  const tone =
    check.status === "block"
      ? "text-danger"
      : check.status === "warn"
        ? "text-act"
        : check.status === "skip"
          ? "text-ink-3"
          : "text-ink-2";

  return (
    <li className="flex items-baseline gap-1.5">
      <span className={cn("w-[52px] shrink-0 font-mono text-[10.5px]", tone)}>
        {statusMark(check.status)}
      </span>
      <span className="shrink-0 text-ink">{check.label}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3" title={check.detail}>
        {check.detail}
      </span>
    </li>
  );
}

function statusMark(status: CheckRun["status"]): string {
  switch (status) {
    case "pass":
      return "通过";
    case "warn":
      return "可修复";
    case "block":
      return "不合格";
    default:
      return "跳过";
  }
}

function VerdictBadge({ report }: { report: GenerationReport }) {
  const text =
    report.verdict === "pass" ? "合格" : report.verdict === "repair" ? "可修复" : "不合格";
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-px text-[10.5px] font-bold",
        report.verdict === "pass"
          ? "bg-surface-3 text-ink-2"
          : report.verdict === "repair"
            ? "bg-surface-3 text-act"
            : "bg-danger-soft text-danger",
      )}
    >
      {text}
    </span>
  );
}

function labelOf(code: string): string {
  return code in ISSUE_LABELS ? ISSUE_LABELS[code as keyof typeof ISSUE_LABELS] : code;
}

/** 控制台里打一行，方便一边玩一边看。只在 record 时调用。 */
export function logReport(report: GenerationReport, index: number): void {
  if (process.env.NODE_ENV !== "development") return;
  console.debug("[ai-rp] generation", formatReportLine(report, index), report);
}
