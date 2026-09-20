/** densable leftover SendFeedback / feedbackDrafts constants (247=246). */

export const SEND_FEEDBACK_TOOL_NAME = 'SendFeedback'

export const FEEDBACK_DRAFTS_DEFAULT = 'notify' as const
export type FeedbackDraftsSetting = 'notify' | 'quiet' | 'off'

export const FEEDBACK_TYPES = ['bug', 'idea', 'missing_capability'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const FEEDBACK_TRIGGERS = [
  'tool_error',
  'user_frustration',
  'missing_capability',
  'model_judgment',
  'exit_nudge',
] as const
export type FeedbackTrigger = (typeof FEEDBACK_TRIGGERS)[number]

export const FEEDBACK_FAILURE_MODES = [
  'instruction_following',
  'destructive_actions',
  'code_quality',
  'repetition_and_looping',
  'model_regression',
  'overconfidence_and_hallucination',
  'context_and_memory',
  'overeager',
  'over_correction',
  'stopping_short',
  'dispute_or_decline',
  'subagent_overspawn',
  'tone_or_preachiness',
  'excessive_questions',
  'unwanted_scope',
  'other',
] as const
export type FeedbackFailureMode = (typeof FEEDBACK_FAILURE_MODES)[number]

export const FEEDBACK_TASK_CATEGORIES = [
  'code_edit',
  'debug',
  'explain',
  'plan',
  'shell',
  'search',
  'review',
  'other',
] as const
export type FeedbackTaskCategory = (typeof FEEDBACK_TASK_CATEGORIES)[number]

export const FEEDBACK_THINKING_TYPES = [
  'adaptive',
  'enabled',
  'disabled',
] as const
export type FeedbackThinkingType = (typeof FEEDBACK_THINKING_TYPES)[number]

/** densable FKe */
export const MAX_KEPT_FEEDBACK_DRAFTS = 10
/** densable NKe */
export const MAX_FEEDBACK_DRAFT_BYTES = 32768
/** densable Sfs days → wfs ms */
export const FEEDBACK_DRAFT_TTL_DAYS = 30
export const FEEDBACK_DRAFT_TTL_MS =
  FEEDBACK_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000
/** densable gfs / yfs — LKe clamp */
export const DEFAULT_MAX_TOOL_CALLS_PER_SESSION = 10
export const MAX_TOOL_CALLS_PER_SESSION_CAP = 50
/** densable hfs / _fs — tgr clamp */
export const DEFAULT_MAX_DRAFT_PROMPTS_PER_SESSION = 3
export const MAX_DRAFT_PROMPTS_PER_SESSION_CAP = 20
/** densable Bfs — request ids kept on the tool call */
export const TOOL_CALL_REQUEST_ID_WINDOW = 3
/** densable Tfs — request ids persisted on the draft */
export const DRAFT_REQUEST_ID_WINDOW = 5
/** densable kfs */
export const MAX_DETAILS_BYTES = 10240
/** densable vfs — jKe title render / persist */
export const MAX_TITLE_CHARS = 200
/** densable Efs — model */
export const MAX_MODEL_CHARS = 64
/** densable igr — cli_version */
export const MAX_CLI_VERSION_CHARS = 32
/** densable agr — os */
export const MAX_OS_CHARS = 64
/** densable lgr — cwd */
export const MAX_CWD_CHARS = 512
/** densable Cfs — area */
export const MAX_AREA_CHARS = 64
/** densable Pfs — effort */
export const MAX_EFFORT_CHARS = 16
/** densable xfs — Iz integer ceiling */
export const MAX_COUNTED_INT = 1_000_000
/** densable Egr / lLt — details preview */
export const DETAILS_PREVIEW_CHARS = 160
export const DETAILS_PREVIEW_LINES = 4
/** densable leftover Fqe `cDt` / `mDt` / `pDt` / `fDt` */
export const FEEDBACK_TURNOFF_PROMPT_DECLINE_CAP = 2
export const FEEDBACK_CARD_SENT_HOLD_MS = 1500
export const FEEDBACK_NOTICE_SHOW_DELAY_MS = 1000
export const FEEDBACK_TURNOFF_CONFIRM_HOLD_MS = 5000
/** densable leftover Fqe `dDt` */
export const FEEDBACK_NOTICE_TYPE_LABELS = {
  bug: 'Bug report',
  idea: 'Product feedback',
  missing_capability: 'Feature request',
} as const
/** densable De */
export const FEEDBACK_PAYLOAD_RESERVE_BYTES = 65536
/**
 * densable F — imported in the official ee module; unique nearby reserve is
 * De=65536. Leftover-wired 1 MiB upload budget (not found as a local literal).
 */
export const FEEDBACK_PAYLOAD_BUDGET_BYTES = 1_048_576
/** densable write mode 384 */
export const FEEDBACK_DRAFT_FILE_MODE = 384
/** densable leftover Es / q — ot `E(f,q)` tail cap */
export const FEEDBACK_TRANSCRIPT_SUBMIT_TAIL_BYTES = 4_194_304
/** densable leftover rgr — Nfs `readTail` cap */
export const FEEDBACK_TRANSCRIPT_AVAIL_TAIL_BYTES = 262_144

export const FEEDBACK_DRAFT_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
export const FEEDBACK_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
export const FEEDBACK_PROJECT_DIR_KEY_RE = /^[A-Za-z0-9-]{1,255}$/

/** densable 3p transcript markers (gold-sendfeedback leftover). */
export const THIRD_PARTY_TRANSCRIPT_MARKERS = [
  'msg_bdrk_',
  'msg_vrtx_',
  'bolt-inf-',
  'toolu_bdrk_',
  'toolu_vrtx_',
  'srvtoolu_bdrk_',
  'srvtoolu_vrtx_',
  'req_bdrk_',
  'req_vrtx_',
] as const

export const FEEDBACK_PROVIDER_LABELS: Record<string, string> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Claude Platform on AWS',
  anthropicGoogleCloud: 'Claude Platform on Google Cloud',
  mantle: 'Amazon Bedrock (Mantle)',
  gateway: 'an API gateway',
}
