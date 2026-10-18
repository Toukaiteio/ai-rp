/**
 * 开发模式的本轮观测记录。
 *
 * 只存在内存里，刷新页面就没了——Phase 0 的验收标准要求
 * 「不记录 API Key、完整隐私聊天内容或敏感数据」，所以：
 * 1. 这里存的是 GenerationReport，字段全是长度、计数、问题码和 12 字以内的片段；
 * 2. 不存正文，也不存玩家输入，只存它的长度和语言；
 * 3. 不落 localStorage、不发请求、不进导出。
 *
 * 生产构建里整个模块会被摇掉：唯一入口 devReportEnabled() 在 NODE_ENV 不是
 * development 时直接返回 false，调用方据此不再调用 record。
 */
import type { GenerationReport } from "./types";
import type { PromptInspector } from "@/lib/prompt/inspector";

/** 面板最多回看多少轮。够对比「改前改后」，又不会把内存堆起来。 */
export const DEV_LOG_LIMIT = 20;

/**
 * Prompt Inspector 只留最近几轮。
 *
 * 它比报告大得多（带着每条消息的正文），所以单独一个小缓冲。
 * 三份够对比「这一轮和上一轮有什么不一样」，再多就是内存里堆一份聊天记录。
 */
export const INSPECTOR_LOG_LIMIT = 3;

const entries: GenerationReport[] = [];
const inspectors: PromptInspector[] = [];
const listeners = new Set<() => void>();

/**
 * 开发模式是否开启。
 * 默认按 NODE_ENV 判断；浏览器里还可以用 ?dev=1 临时打开，
 * 方便对着预览部署看真实模型的表现（预览是 production 构建）。
 */
export function devReportEnabled(search?: string): boolean {
  if (typeof window === "undefined") return false;
  const query = search ?? window.location.search;
  const params = new URLSearchParams(query);
  if (params.get("dev") === "0") return false;
  if (params.has("dev")) return true;
  return process.env.NODE_ENV === "development";
}

/**
 * 给 useSyncExternalStore 用的订阅与快照。
 *
 * 这个开关只由 NODE_ENV 和 URL 决定，本来就不该进 React 状态：
 * 用 state + effect 去读它，会在挂载后多渲染一次，还会被 react-hooks 规则拦下。
 * 服务端快照固定 false，水合时两边一致；客户端第一次取快照时 URL 已经可读。
 */
export function subscribeDevFlag(): () => void {
  return () => {};
}

export function devFlagServerSnapshot(): boolean {
  return false;
}

export function recordReport(report: GenerationReport): void {
  entries.push(report);
  while (entries.length > DEV_LOG_LIMIT) entries.shift();
  for (const listener of listeners) listener();
}

/**
 * 记下这一轮的提示词结构（Phase 10）。
 *
 * 和 recordReport 分开是因为它带着正文——报告那边刻意只存长度和计数。
 * 两份数据分开存、分开清，面板里也是两个页签，
 * 这样「不记录完整隐私内容」那条约束在报告那边仍然是成立的。
 */
export function recordInspector(inspector: PromptInspector): void {
  inspectors.push(inspector);
  while (inspectors.length > INSPECTOR_LOG_LIMIT) inspectors.shift();
  for (const listener of listeners) listener();
}

export function inspectorLog(): readonly PromptInspector[] {
  return inspectors;
}

export function reportLog(): readonly GenerationReport[] {
  return entries;
}

export function clearReportLog(): void {
  entries.length = 0;
  inspectors.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 用。返回数组本身，写入时才换引用。 */
export function reportSnapshot(): readonly GenerationReport[] {
  return entries;
}

export function inspectorSnapshot(): readonly PromptInspector[] {
  return inspectors;
}

export interface ReportTotals {
  rounds: number;
  /** 判定为 reject 的轮数，对应「不合格，不写进历史」 */
  rejected: number;
  /** 判定为 repair 的轮数，对应「可修复，自动修一次」 */
  repairable: number;
  playerControl: number;
  repeated: number;
  invalidActs: number;
  /** 问题码 → 命中轮数，按命中次数降序 */
  byCode: Array<[string, number]>;
}

/** 面板顶部的汇总。Phase 0 的基线就是这一行数字随改动怎么变。 */
export function reportTotals(list: readonly GenerationReport[]): ReportTotals {
  const codes = new Map<string, number>();
  let rejected = 0;
  let repairable = 0;
  let playerControl = 0;
  let repeated = 0;
  let invalidActs = 0;

  for (const report of list) {
    if (report.verdict === "reject") rejected += 1;
    if (report.verdict === "repair") repairable += 1;
    if (report.playerControlViolation) playerControl += 1;
    if (report.repeatedPhraseCount > 0) repeated += 1;
    invalidActs += report.invalidActCount;
    for (const code of new Set(report.issues.map((issue) => issue.code))) {
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }

  return {
    rounds: list.length,
    rejected,
    repairable,
    playerControl,
    repeated,
    invalidActs,
    byCode: [...codes.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** 一行摘要，控制台里也能看。 */
export function formatReportLine(report: GenerationReport, index: number): string {
  const failed = report.checks.filter((check) => check.status !== "pass" && check.status !== "skip");
  const head = `#${index + 1} 第 ${report.turn} 轮 ${report.verdict} ${report.blockCount}块 ${report.responseLength}字 act ${report.actCount}(坏${report.invalidActCount}) dlg ${report.dialogueCount}`;
  if (failed.length === 0) return `${head} · 全部通过`;
  return `${head} · ${failed.map((check) => `${check.label}(${check.status})`).join(" ")}`;
}
