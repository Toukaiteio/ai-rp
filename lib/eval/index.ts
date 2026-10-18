/** 评测集与自动回归。 */
export {
  CATEGORY_LABELS,
  EVAL_CASES,
  EVAL_CATEGORIES,
  casesByCategory,
  type EvalCase,
  type EvalCategory,
  type MetricKey,
} from "./cases";
export {
  EVAL_SEQUENCES,
  type EvalSequence,
} from "./sequences";
export {
  METRIC_DIRECTIONS,
  REGRESSION_TOLERANCE,
  allMetrics,
  coherenceMetrics,
  findRegressions,
  formatMetrics,
  narrativeMetrics,
  structureMetrics,
  timeWentBackwards,
  type EvalTurn,
  type Metric,
  type MetricDirection,
  type MetricFamily,
  type Regression,
} from "./metrics";
