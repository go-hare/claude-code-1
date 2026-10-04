/**
 * densable 2.1.283 leftover unique copy wrap (no fleet compositor / Far key store).
 *
 * Gold SEA `/tmp/official-283/package/claude` + `/tmp/gold-leftover-remaining.txt`.
 * gold `xo` @202278654 (`tengu_device_hook_served` IN BODY) · unique `cloud-transcript.jsonl` @202279438
 * gold leftover `Eo` @202280653 timeout/disconnected/tengu_device_hooks_* / saved-answer-ignored
 * gold `qt` @202326531 pack 365 B · gold `gs` @202326896 `failed_host_error`
 * gold `_jt` @202330701 `consent.attach_sync.*` + unique `consent.sync.title` / `.body` / `.detail` @202330897
 * gold `bXn` @202348264 `[ede_diagnostic]` · gold `ot` `The cloud session failed to start.`
 * gold `ie` @202352615 timer · gold `at` `dropping control_request without request_id or request`
 * leftover Qs-adj `Ee`/`lt`/`ut` @202362116 / 202362175 / 202362259 (keep Qs `cancel_queued` host)
 * gold `on` @202404306 `ccr_dir_sync_mode_prompt` · unique `[headlessCloud] sync question abandoned` @202405797
 * gold leftover `Yo` @202433401 COMPOSITOR BODY leftoverHeadlessAttach.ts — unique copy `attach_dir_sync_elsewhere_unknown` here
 * gold `Tn` @202441256 `untrusted device`
 * leftover `b_n` @202419732 unique `Tgt("policy_invalid")` — keep qqr seam on cloudSession
 * leftover print-arm @202463137 `claude -p --cloud needs a task`
 *
 * Semantic English exports; minify names stay in comments.
 */
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

/** gold leftover `xo` @202278654 IN BODY */
export const TENGU_DEVICE_HOOK_SERVED = 'tengu_device_hook_served'
/** gold leftover `xo` @202278654 */
export const DEVICE_HOOKS_SERVE = 'device_hooks_serve'
/** gold leftover `xo` @202278654 */
export const DEVICE_HOOKS_SERVE_THREW = 'serve_threw'
/** gold leftover `xo` @202278654 */
export const DEVICE_HOOK_SESSION_CREATED_FOR_ATTACH =
  '[deviceHooks] device hook session created for this attach'
/** gold leftover `xo` unique `emptyTranscriptPath` @202279438 — filename only, no hook fleet. */
export const CLOUD_TRANSCRIPT_JSONL = 'cloud-transcript.jsonl'

/** gold leftover `xo` @202278654 `emptyTranscriptPath:()=>R.placeholder("cloud-transcript.jsonl")` */
export function emptyTranscriptPath(): string {
  return CLOUD_TRANSCRIPT_JSONL
}

/** gold leftover `Eo` @202280653 `throw Error("timeout: no answer from the cloud worker in time")` */
export const CLOUD_WORKER_TIMEOUT_NO_ANSWER =
  'timeout: no answer from the cloud worker in time'
/** gold leftover `Eo` @202280653 `throw Error("disconnected: the session stream is not connected")` */
export const SESSION_STREAM_NOT_CONNECTED =
  'disconnected: the session stream is not connected'
/** gold leftover `Eo` @202280653 */
export const TENGU_DEVICE_HOOKS_CONSENT_NOTICE =
  'tengu_device_hooks_consent_notice'
/** gold leftover `Eo` @202280653 `i("tengu_device_hooks_client_register", …)` */
export const TENGU_DEVICE_HOOKS_CLIENT_REGISTER =
  'tengu_device_hooks_client_register'
/** gold leftover `Eo` @202280653 */
export const TENGU_DEVICE_HOOKS_LAPSE_LINE = 'tengu_device_hooks_lapse_line'
/** gold leftover `Eo` @202280653 */
export const TENGU_DEVICE_HOOKS_REACH_PINNED = 'tengu_device_hooks_reach_pinned'
/** gold leftover `Eo` @202280653 */
export const TENGU_DEVICE_HOOKS_SOURCE_PINNED =
  'tengu_device_hooks_source_pinned'

/**
 * gold leftover `Eo` @202280653 saved-answer-ignored writable template 1:1.
 * `The saved answer about this machine's hooks is ignored here: this cloud session can itself write ${j}. Decide for it in /hooks.`
 */
export function savedHooksAnswerIgnoredWritable(path: string): string {
  return `The saved answer about this machine's hooks is ignored here: this cloud session can itself write ${path}. Decide for it in /hooks.`
}

/**
 * gold leftover `Eo` @202280653 saved-answer-ignored unlocated template 1:1.
 * `The saved answer about this machine's hooks is ignored here: ${j} could not be located to check who can write it. Decide for this session in /hooks.`
 */
export function savedHooksAnswerIgnoredUnlocated(path: string): string {
  return `The saved answer about this machine's hooks is ignored here: ${path} could not be located to check who can write it. Decide for this session in /hooks.`
}

/** gold leftover `qt` @202326531 BODY is a 365 B pack; unique token is `var gs` @202326896 */
export const FAILED_HOST_ERROR = 'failed_host_error'

/** gold Di key leftover `_jt` @202330701 */
export const CONSENT_ATTACH_SYNC_TITLE_KEY = 'consent.attach_sync.title'
/** gold Di key leftover `_jt` @202330701 */
export const CONSENT_ATTACH_SYNC_BODY_KEY = 'consent.attach_sync.body'
/** gold Di key leftover `_jt` @202330701 */
export const CONSENT_ATTACH_SYNC_DETAIL_KEY = 'consent.attach_sync.detail'

/** gold Di `consent.attach_sync.title` */
export const CONSENT_ATTACH_SYNC_TITLE =
  'Keep this folder in sync with the cloud session?'
/** gold Di `consent.attach_sync.body` */
export const CONSENT_ATTACH_SYNC_BODY =
  "This folder is a checkout of the repository the cloud session works in. If you allow it, Claude Code keeps the two in step while this computer is attached: your changes here (including uncommitted ones) are copied into the session's checkout, and Claude's changes there are copied into this folder. Your own edits are never overwritten: when both sides changed a file, yours keeps its name and Claude's version is saved beside it. Your answer is remembered for this folder, and it is the same answer asked for when you start a new cloud session from this folder (claude --cloud): after a Yes, those sessions sync this folder's files into the cloud too, without asking again."
/** gold Di `consent.attach_sync.detail` */
export const CONSENT_ATTACH_SYNC_DETAIL =
  "Secrets, credentials, and gitignored files are never synced, files under .claude and .mcp.json are never written on this computer, and all synced files are encrypted at rest. Whichever you choose, files Claude reads and command output from this computer become part of the cloud session: anyone you share the session with and, on Team or Enterprise plans, your organization's admins can see them."

/** gold leftover `_jt` Di attach bag (host leftoverUnique Xe/jt — title key, no dialog compositor). */
export const CLOUD_ATTACH_SYNC_CONSENT_COPY = {
  title: CONSENT_ATTACH_SYNC_TITLE,
  body: CONSENT_ATTACH_SYNC_BODY,
  detail: CONSENT_ATTACH_SYNC_DETAIL,
} as const

/** gold leftover `_jt` @202330897 Di key `consent.sync.title` */
export const CONSENT_SYNC_TITLE_KEY = 'consent.sync.title'
/** gold leftover `_jt` @202330897 Di key `consent.sync.body` */
export const CONSENT_SYNC_BODY_KEY = 'consent.sync.body'
/** gold leftover `_jt` @202330897 Di key `consent.sync.detail` */
export const CONSENT_SYNC_DETAIL_KEY = 'consent.sync.detail'

/** gold Di `consent.sync.title` first JS Di def ~181888286 */
export const CONSENT_SYNC_TITLE = 'Sync this project directory to the cloud?'
/** gold Di `consent.sync.body` first JS Di def ~181888286 */
export const CONSENT_SYNC_BODY =
  'Allow Claude Code to sync files from this project directory into cloud sessions, so Claude can work on them in the cloud.'
/** gold Di `consent.sync.detail` first JS Di def ~181888286 */
export const CONSENT_SYNC_DETAIL =
  "Secrets, credentials, and gitignored files are never synced and all synced files are encrypted at rest. Whichever you choose, files Claude reads and command output from this computer become part of the cloud session: anyone you share the session with and, on Team or Enterprise plans, your organization's admins can see them."

/** gold leftover `_jt` Di create bag (lookup keys; no dialog compositor). */
export const CLOUD_SYNC_CONSENT_COPY = {
  title: CONSENT_SYNC_TITLE,
  body: CONSENT_SYNC_BODY,
  detail: CONSENT_SYNC_DETAIL,
} as const

/** gold leftover `bXn` @202348264 BODY unique */
export const EDE_DIAGNOSTIC_PREFIX = '[ede_diagnostic]'
/** gold class `ot` after leftover `bXn` @202348264 */
export const CLOUD_SESSION_FAILED_TO_START =
  'The cloud session failed to start.'

/** gold class `at.handleControlRequest` after leftover `ie` @202352615 (ie BODY is 59 B timer) */
export const DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST =
  '[headlessCloudClient] dropping control_request without request_id or request'

/** leftover Qs-adj `Ee` @202362116 — not leftover Qs `cancel_queued` host. */
export const CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED =
  'the cloud client closed before this request completed'
/** leftover Qs-adj `lt` @202362175 */
export const CONTENT_BLOCK_MUST_BE_OBJECT_TEXT_STRING =
  'every content block must be an object, and a text block must carry string text'
/** leftover Qs-adj `ut` @202362259 */
export const CLOUD_CLIENT_CLOSED_BEFORE_SEND_CONFIRMED =
  'the cloud client closed before the send was confirmed'

/** gold leftover `on` @202404306 */
export const CCR_DIR_SYNC_MODE_PROMPT = 'ccr_dir_sync_mode_prompt'
/** gold leftover `on` @202405797 unique log copy */
export const HEADLESS_CLOUD_SYNC_QUESTION_ABANDONED =
  '[headlessCloud] sync question abandoned'

/** leftover print-arm @202463137 — constant only, no print-arm compositor. */
export const CLOUD_PRINT_NEEDS_TASK =
  "Error: claude -p --cloud needs a task: pass it as the prompt, as --cloud's value, or on stdin."

/** gold leftover `Yo` @202433401 COMPOSITOR unique copy only */
export const ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN =
  'attach_dir_sync_elsewhere_unknown'
/** gold leftover `Yo` / `oi` `why:"elsewhere_unknown"` */
export const DIR_SYNC_ELSEWHERE_UNKNOWN = 'elsewhere_unknown'

/** gold leftover `Tn` @202441256 `new P(Jle(),"untrusted device")` — not Far key store */
export const UNTRUSTED_DEVICE = 'untrusted device'

/** gold `gs` after leftover `qt` @202326531 */
export const HOST_AGENT_REQUEST_OUTCOMES = [
  'answered',
  FAILED_HOST_ERROR,
  'failed_invalid_reply',
  'answer_failed',
] as const

export type HostAgentRequestOutcome = (typeof HOST_AGENT_REQUEST_OUTCOMES)[number]

export type DeviceHookServedTelemetry = {
  event?: string
  kind?: string
  outcome?: string
  exitClass?: string
  durationMs?: number
  translatedPaths?: boolean
  replay?: boolean
  blocked?: boolean
  staged?: boolean
  repinned?: boolean
  waitedMs?: number
  attestation?: {
    mode?: string
    status?: string
    verdict?: string
  }
}

/**
 * gold `xo` @202278654 telemetry — `i("tengu_device_hook_served", …)`.
 * No hook fleet.
 */
export function logDeviceHookServed(served: DeviceHookServedTelemetry): void {
  logEvent(TENGU_DEVICE_HOOK_SERVED, {
    ...(served.event !== undefined && {
      event:
        served.event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(served.kind !== undefined && {
      kind:
        served.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(served.outcome !== undefined && {
      outcome:
        served.outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(served.exitClass !== undefined && {
      exit_class:
        served.exitClass as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(served.durationMs !== undefined && { duration_ms: served.durationMs }),
    ...(served.translatedPaths !== undefined && {
      translated_paths: served.translatedPaths,
    }),
    ...(served.replay !== undefined && { replay: served.replay }),
    ...(served.blocked !== undefined && { blocked: served.blocked }),
    ...(served.staged !== undefined && { staged: served.staged }),
    ...(served.repinned !== undefined && { repinned: served.repinned }),
    ...(served.waitedMs !== undefined && { waited_ms: served.waitedMs }),
    ...(served.attestation !== undefined && {
      attestation_mode:
        served.attestation.mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      request_attestation:
        served.attestation.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      attestation_verdict:
        served.attestation.verdict as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}

/**
 * gold leftover `qt` @202326531 / `gs` @202326896 — host-ask outcome token.
 */
export function isFailedHostError(outcome: string): boolean {
  return outcome === FAILED_HOST_ERROR
}

/**
 * gold leftover `bXn` @202348264 — strip `[ede_diagnostic]` result errors.
 */
export function stripEdeDiagnosticErrors<T extends { type?: string; errors?: unknown }>(
  e: T,
): T {
  if (e.type !== 'result' || !('errors' in e)) return e
  const n = e.errors
  if (!Array.isArray(n)) return e
  const s = n.filter(
    r => !(typeof r === 'string' && r.startsWith(EDE_DIAGNOSTIC_PREFIX)),
  )
  return s.length === n.length ? e : { ...e, errors: s }
}

/**
 * gold leftover `ie` @202352615 nearby class `at` — log copy 1:1 via logForDebugging.
 */
export function logDroppedControlRequestWithoutIdOrRequest(): void {
  logForDebugging(DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST)
}

/**
 * gold leftover `on` @202404306 — `p("ccr_dir_sync_mode_prompt", …)` / `_()`.
 * No dir-sync engine.
 */
export function logCcrDirSyncModePrompt(outcome?: string): void {
  logEvent(CCR_DIR_SYNC_MODE_PROMPT, {
    ...(outcome !== undefined && {
      outcome:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}

/**
 * gold leftover `on` @202405797 — `t(\`[headlessCloud] sync question abandoned: ${l(v)}\`)`.
 * Keep CCR_DIR_SYNC_MODE_PROMPT. No dir-sync engine.
 */
export function logSyncQuestionAbandoned(error: unknown): void {
  logForDebugging(
    `[headlessCloud] sync question abandoned: ${errorMessage(error)}`,
  )
}

/**
 * gold leftover `Yo` @202433401 unique copy / `oi` @202441082
 * `case"unknown":return{handle:void 0,why:"elsewhere_unknown"}`
 * Compositor BODY leftoverHeadlessAttach.ts CALLs this classify helper.
 */
export function classifyAttachDirSyncElsewhereUnknown(lookup: {
  kind?: string
  why?: string
}): boolean {
  return lookup.kind === 'unknown' || lookup.why === DIR_SYNC_ELSEWHERE_UNKNOWN
}

/**
 * gold leftover `Yo` unique copy `p("remote_headless_session","attach_dir_sync_elsewhere_unknown")`.
 */
export function attachDirSyncElsewhereUnknownReason(lookup: {
  kind?: string
  why?: string
}): typeof ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN | undefined {
  return classifyAttachDirSyncElsewhereUnknown(lookup)
    ? ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN
    : undefined
}

/**
 * leftover `b_n` @202419732 unique — gold `Tgt("policy_invalid")` when
 * `!r.valid && r.policyUnreadable`. Keep qqr seam; do not invent qqr engine.
 * Do not re-export from cloudSession (duplicate-export parse).
 */
export const POLICY_INVALID_REASON = 'policy_invalid'
