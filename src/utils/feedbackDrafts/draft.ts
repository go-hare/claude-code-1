import { randomUUID } from 'crypto'
import { basename, dirname } from 'path'
import {
  DRAFT_REQUEST_ID_WINDOW,
  FEEDBACK_DRAFT_ID_RE,
  FEEDBACK_FAILURE_MODES,
  FEEDBACK_PROJECT_DIR_KEY_RE,
  FEEDBACK_SESSION_ID_RE,
  FEEDBACK_TASK_CATEGORIES,
  FEEDBACK_THINKING_TYPES,
  FEEDBACK_TRIGGERS,
  FEEDBACK_TYPES,
  MAX_AREA_CHARS,
  MAX_CLI_VERSION_CHARS,
  MAX_COUNTED_INT,
  MAX_CWD_CHARS,
  MAX_DETAILS_BYTES,
  MAX_EFFORT_CHARS,
  MAX_MODEL_CHARS,
  MAX_OS_CHARS,
  MAX_TITLE_CHARS,
  type FeedbackFailureMode,
  type FeedbackTaskCategory,
  type FeedbackThinkingType,
  type FeedbackTrigger,
  type FeedbackType,
} from './constants.js'

export type FeedbackTranscriptRef = {
  session_file: string
  message_range: [number, number] | null
  project_dir_key?: string
}

export type FeedbackDraft = {
  draft_id: string
  created_at: string
  source_session_id: string
  cwd: string
  model: string
  cli_version: string
  os: string
  request_ids: string[]
  type: FeedbackType
  title: string
  details: string
  area?: string
  failure_mode?: FeedbackFailureMode
  task_category?: FeedbackTaskCategory
  trigger: FeedbackTrigger
  effort?: string
  thinking_type?: FeedbackThinkingType
  thinking_budget?: number
  message_count?: number
  assistant_turn_count?: number
  subagent_count?: number
  transcript_ref: FeedbackTranscriptRef | null
  status: 'queued' | 'submitted' | 'discarded' | 'expired'
  /** list-time leftover Nfs; stripped before persist */
  transcriptAvailable?: boolean
}

export type CreateFeedbackDraftInput = {
  type: FeedbackType
  title: string
  details: string
  area?: string
  failureMode?: FeedbackFailureMode
  taskCategory?: FeedbackTaskCategory
  trigger: FeedbackTrigger
  requestIds: string[]
  sessionId: string
  cwd: string
  model: string
  cliVersion: string
  os: string
  effort?: string
  thinkingType?: FeedbackThinkingType
  thinkingBudget?: number
  messageCount?: number
  assistantTurnCount?: number
  subagentCount?: number
  transcriptFile?: string
}

/** densable leftover Uee */
export function truncateGraphemes(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function truncateBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let out = value
  while (out.length > 0 && Buffer.byteLength(out, 'utf8') > maxBytes) {
    out = out.slice(0, Math.floor(out.length * 0.95) || out.length - 1)
  }
  return out
}

function optionalBoundedString(
  value: string | undefined,
  max: number,
): string | undefined {
  if (value === undefined) return
  const next = truncateGraphemes(asString(value).trim(), max)
  return next === '' ? undefined : next
}

function asCountedInt(value: number | undefined): number | undefined {
  return value !== undefined &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_COUNTED_INT
    ? value
    : undefined
}

/** densable leftover $fs */
export function projectDirKeyFromTranscriptFile(
  transcriptFile: string,
): string | undefined {
  const key = basename(dirname(transcriptFile))
  return FEEDBACK_PROJECT_DIR_KEY_RE.test(key) ? key : undefined
}

export function isFeedbackDraftId(value: string): boolean {
  return FEEDBACK_DRAFT_ID_RE.test(value)
}

export function isFeedbackSessionId(value: string): boolean {
  return FEEDBACK_SESSION_ID_RE.test(value)
}

/** densable leftover _gr */
export function createFeedbackDraft(
  input: CreateFeedbackDraftInput,
  now: Date = new Date(),
): FeedbackDraft {
  const projectDirKey = input.transcriptFile
    ? projectDirKeyFromTranscriptFile(input.transcriptFile)
    : undefined
  return {
    draft_id: randomUUID(),
    created_at: now.toISOString(),
    source_session_id: input.sessionId,
    cwd: truncateGraphemes(asString(input.cwd).trim(), MAX_CWD_CHARS),
    model: truncateGraphemes(asString(input.model), MAX_MODEL_CHARS),
    cli_version: truncateGraphemes(
      asString(input.cliVersion).trim(),
      MAX_CLI_VERSION_CHARS,
    ),
    os: truncateGraphemes(asString(input.os).trim(), MAX_OS_CHARS),
    request_ids: input.requestIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(-DRAFT_REQUEST_ID_WINDOW),
    type: input.type,
    title: truncateGraphemes(asString(input.title), MAX_TITLE_CHARS),
    details: truncateBytes(
      asString(input.details)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line)
        .join('\n'),
      MAX_DETAILS_BYTES,
    ),
    area: optionalBoundedString(input.area, MAX_AREA_CHARS),
    failure_mode: input.failureMode,
    task_category: input.taskCategory,
    trigger: input.trigger,
    effort: optionalBoundedString(input.effort, MAX_EFFORT_CHARS),
    thinking_type: input.thinkingType,
    thinking_budget: asCountedInt(input.thinkingBudget),
    message_count: asCountedInt(input.messageCount),
    assistant_turn_count: asCountedInt(input.assistantTurnCount),
    subagent_count: asCountedInt(input.subagentCount),
    transcript_ref: input.transcriptFile
      ? {
          session_file: input.transcriptFile,
          message_range: null,
          ...(projectDirKey !== undefined && {
            project_dir_key: projectDirKey,
          }),
        }
      : null,
    status: 'queued',
  }
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return (
    typeof value === 'string' &&
    (FEEDBACK_TYPES as readonly string[]).includes(value)
  )
}

export function isFeedbackTrigger(value: unknown): value is FeedbackTrigger {
  return (
    typeof value === 'string' &&
    (FEEDBACK_TRIGGERS as readonly string[]).includes(value)
  )
}

export function isFeedbackFailureMode(
  value: unknown,
): value is FeedbackFailureMode {
  return (
    typeof value === 'string' &&
    (FEEDBACK_FAILURE_MODES as readonly string[]).includes(value)
  )
}

export function isFeedbackTaskCategory(
  value: unknown,
): value is FeedbackTaskCategory {
  return (
    typeof value === 'string' &&
    (FEEDBACK_TASK_CATEGORIES as readonly string[]).includes(value)
  )
}

export function isFeedbackThinkingType(
  value: unknown,
): value is FeedbackThinkingType {
  return (
    typeof value === 'string' &&
    (FEEDBACK_THINKING_TYPES as readonly string[]).includes(value)
  )
}
