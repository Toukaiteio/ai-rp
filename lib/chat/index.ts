/** 会话内的操作：重新生成、编辑、分支。 */
export {
  PREVIEW_CHARS,
  planRegenerate,
  preview,
  pushSwipe,
  regenerateNote,
  restoreSwipe,
  type RegeneratePlan,
  type RetryMessage,
} from "./regenerate";
export {
  RESUMMARIZE_DISTANCE,
  STALE_LABELS,
  applyEdit,
  reportStale,
  type EditedMessage,
  type StaleKind,
  type StaleReport,
} from "./edit";
export {
  MAIN_BRANCH,
  MAIN_TITLE,
  MAX_BRANCHES,
  MAX_TITLE_CHARS,
  appendToBranch,
  branchPoint,
  createBranch,
  describeBranch,
  mainBranch,
  normalizeTree,
  removeBranch,
  resolveBranch,
  type BranchTree,
  type ChatBranch,
} from "./branch";
export {
  USER_MESSAGE_BASE64_INSTRUCTION,
  decodeMarkedBase64,
  decodeUtf8Base64,
  encodeRandomUserWords,
  encodeUtf8Base64,
  hasMarkedBase64,
  type EncodedUserMessage,
  type EncodeUserMessageOptions,
} from "./user-message-encoding";
export {
  absorbToolCall,
  historyContent,
  markPlayer,
  playerText,
  userTurnsAsMessages,
  type ChatError,
  type PendingTool,
  type Turn,
} from "./turn";
