/**
 * 文本引擎的对外入口。
 *
 * 前端、跑批脚本和测试都从这里引，不直接引内部文件，
 * 这样后面加「自动修复」和「状态更新」时，接线方式不用改。
 */
export {
  ISSUE_CODES,
  GATE_ACTION,
  ISSUE_LABELS,
  ISSUE_SEVERITY,
  type BlockDegradation,
  type CheckRun,
  type GateAction,
  type GateDecision,
  type GenerationInput,
  type GenerationIssue,
  type GenerationReport,
  type GenerationResult,
  type GenerationVerdict,
  type IssueCode,
  type IssueSeverity,
  type LanguageId,
  type ValidationSeverity,
} from "./types";
export {
  checkGeneration,
  reportForValidation,
  sortIssues,
  summarizeReport,
} from "./report";
export {
  describeValidation,
  bypassResponseValidation,
  resolveGeneration,
  stripStageDirections,
  validateResponseBlocks,
  type ResponseValidation,
  type ValidateOptions,
} from "./validate";
export {
  commitTurn,
  retryBase,
  type CommitOutcome,
  type HistoryTurn,
  type PendingTurn,
} from "./history";
export {
  buildRepairMessages,
  extractRepairedText,
  summarizeReasons,
  REPAIR_CONTRACT,
  REPAIR_SYSTEM_PROMPT,
  type RepairOutcome,
  type RepairPromptOptions,
} from "./repair";
export {
  MAX_BLOCKS_PER_TURN,
  MAX_RESPONSE_LENGTH,
  MAX_SCENES_PER_TURN,
} from "./checks";
export {
  DEV_LOG_LIMIT,
  clearReportLog,
  devFlagServerSnapshot,
  devReportEnabled,
  formatReportLine,
  recordReport,
  reportLog,
  reportSnapshot,
  reportTotals,
  subscribeDevFlag,
  subscribeReports,
  type ReportTotals,
} from "./dev-log";
export { promptVersion } from "./version";
export { detectLanguage, repeatedPhrases, visibleLength } from "./text";
