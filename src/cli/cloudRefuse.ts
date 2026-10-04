/**
 * densable 2.1.283 leftover wrap from cloudSession.ts (no fleet compositor).
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * gold `Xt` @202401109 · gold `eo` @202373966 · gold `Le` @202419370
 * gold `mo` @202401343 · gold `go` @202401514 · gold `_o` @202401624
 * gold `yo` @202402087 · gold `So` @202402208 · gold `Co` @202402514
 * gold `nn` @202402594 · gold `sn` @202402903 · gold `wo` @202403574
 * gold `bo` @202403725 · gold `pt` @202374487 · gold `_T` @181178659
 * gold `qo` @202416455
 *
 * Semantic English exports only; minify names stay in comments.
 */
import { errorMessage } from 'src/utils/errors.js'
import { logForDebugging } from 'src/utils/debug.js'
import { truncateCodeUnitsSafe } from 'src/utils/stringUtils.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  type HeadlessCloudNotApplied,
  isDirSyncConsentFolder,
} from './cloudSession.js'
import {
  CLOUD_SYNC_OFFLINE_KIND,
  cloudSyncOfflineCopy,
} from './leftoverUnique.js'

/** densable `Lre.result` @202287582 */
const CLOUD_SYNC_OFFLINE_RESULTS = ['continue', 'unanswered'] as const
/** densable `Lre.default` @202287582 */
const CLOUD_SYNC_OFFLINE_DEFAULT = 'unanswered' as const

/** gold `Hkn` @191133048 — notice map cap */
const HEADLESS_CLOUD_NOTICE_MAP_CAP = 8
/** gold `qje` @191133048 — notice / Hoe cap */
const HEADLESS_CLOUD_NOTICE_TEXT_CAP = 200
/** gold `F` @191133048 — Fbe cap */
const HEADLESS_CLOUD_EXIT_MESSAGE_CAP = 2048
/** gold `H` @191133048 — Sh default cap */
const HEADLESS_CLOUD_SCRUB_CAP = 512
const HEADLESS_CLOUD_ZWJ_KEEP = 8
/** gold `V` @191133048 */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: gold V @191133048 keeps ZWJ
const HEADLESS_CLOUD_ZWJ_RE = /[\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu
/** gold `W` @191133048 */
const HEADLESS_CLOUD_CONTROL_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: gold W @191133048 keeps ZWJ
  /(?:(?![\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029])+/gu
/** gold `wo` path scrub @202403574 */
const HEADLESS_CLOUD_PATH_SCRUB_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\s]+/gu
const HEADLESS_CLOUD_LS_TREE_RE =
  /(?:^|\0)100(?:644|755) blob [0-9a-f]{40,64} +(\d+)\t/g

/** gold `vae` / `uCe` @181393255 — mutually exclusive notice keys */
const SERVED_TOOLS_MUTED_NOTICE_KEY = 'served-tools-muted'
const SERVED_TOOLS_UNMUTED_NOTICE_KEY = 'served-tools-unmuted'

/** gold `_` @191134376 */
const CLOUD_SESSION_DISCONNECTED_PREFIX = 'Cloud session disconnected'

const DIR_SYNC_ENGINE_REASONS = [
  'not_seeded',
  'not_opted_in',
  'lookup_failed',
  'seeded_elsewhere',
  'engine_declined',
  'engine_unavailable',
  'created_empty_unfilled',
] as const

type HeadlessCloudDialogs = {
  kinds: Set<string>
  request: (
    kind: {
      kind: string
      result?: readonly string[]
      default?: string
    },
    payload: unknown,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ answer: string; answered: boolean }>
}

export type HeadlessCloudDialogArm =
  | 'declare_dialog_kinds'
  | 'rearm_parked_prompt'

export type HeadlessCloudExitReason =
  | 'stdin_eof'
  | 'end_session'
  | 'tool_host_ended'
  | 'disconnected'
  | 'rejected_options'
  | 'open_failed'
  | 'output_failed'

export type CloudDisconnectCode =
  | 'stream_closed'
  | 'untrusted_device'
  | 'session_stale_relogin'
  | 'attach_rejected'
  | 'invalid_session_id'
  | 'request_rejected'
  | 'malformed_response'

export type HeadlessCloudExit = {
  exitCode: number
  reason: HeadlessCloudExitReason
  message?: string
  disconnectCode?:
    | 'stream_closed'
    | 'untrusted_device'
    | 'session_stale_relogin'
}

export type HeadlessCloudNoticeRow = { key: string; text: string }

/** gold `re` — UTF-16 code-unit slice. */
function headlessCloudTruncate(text: string, max: number): string {
  return truncateCodeUnitsSafe(text, max)
}

/** gold `Hoe` @195753406 */
function clipNoticeText(text: string): string {
  if (text.length <= HEADLESS_CLOUD_NOTICE_TEXT_CAP) return text
  return `${headlessCloudTruncate(text, HEADLESS_CLOUD_NOTICE_TEXT_CAP - 1)}…`
}

/** gold `Sh` @191133200 */
function scrubControlText(
  value: unknown,
  max = HEADLESS_CLOUD_SCRUB_CAP,
): string {
  let kept = 0
  return headlessCloudTruncate(
    errorMessage(value)
      .replace(HEADLESS_CLOUD_CONTROL_RE, ' ')
      .replace(HEADLESS_CLOUD_ZWJ_RE, ch =>
        kept++ < HEADLESS_CLOUD_ZWJ_KEEP ? ch : '',
      )
      .trim(),
    max,
  )
}

/** gold `Fbe` @191133277 */
function clipExitMessage(value: unknown): string {
  return scrubControlText(value, HEADLESS_CLOUD_EXIT_MESSAGE_CAP)
}

/** gold `Be` @202307676 — notice text trim at sentence/word. */
function trimNoticeText(text: string): string {
  if (headlessCloudTruncate(text, HEADLESS_CLOUD_NOTICE_TEXT_CAP) === text) {
    return text
  }
  const n = headlessCloudTruncate(text, HEADLESS_CLOUD_NOTICE_TEXT_CAP)
  const s = Math.max(
    n.lastIndexOf(' — '),
    n.lastIndexOf('; '),
    n.lastIndexOf('. '),
  )
  const r = s > 0 ? s : n.lastIndexOf(' ')
  return (r > 0 ? n.slice(0, r) : n).trimEnd()
}

/** gold `Okn` @191134411 */
function normalizeDisconnectCode(
  code: CloudDisconnectCode | undefined,
): 'stream_closed' | 'untrusted_device' | 'session_stale_relogin' {
  switch (code) {
    case 'untrusted_device':
    case 'session_stale_relogin':
      return code
    case 'invalid_session_id':
    case 'request_rejected':
    case 'malformed_response':
    case undefined:
      return 'stream_closed'
    default:
      return 'stream_closed'
  }
}

/** gold `Dkn` @191134605 */
function disconnectCopy(
  code:
    | 'stream_closed'
    | 'untrusted_device'
    | 'session_stale_relogin'
    | 'attach_rejected',
): string {
  switch (code) {
    case 'stream_closed':
      return `${CLOUD_SESSION_DISCONNECTED_PREFIX} (stream_closed): this machine is no longer attached. If the session still exists it keeps running in the cloud; open it again to re-attach.`
    case 'untrusted_device':
      return `${CLOUD_SESSION_DISCONNECTED_PREFIX} (untrusted_device): the server no longer accepts this machine's device proof. Sign in again on this machine, then open the session again.`
    case 'session_stale_relogin':
      return `${CLOUD_SESSION_DISCONNECTED_PREFIX} (session_stale_relogin): the sign-in on this machine has expired. Sign in again on this machine, then open the session again.`
    case 'attach_rejected':
      return `${CLOUD_SESSION_DISCONNECTED_PREFIX} (attach_rejected): this cloud session can no longer be attached to (it may have been archived). Start a new cloud session instead.`
  }
}

/**
 * gold `Xt` @202401109
 * FULL: `Cloud session ${id} no longer uses this computer${suffix}; stopping.`
 */
export function cloudSessionNoLongerUsesThisComputer(
  sessionId: string,
  detail?: string,
): string {
  const suffix =
    detail === undefined || detail === ''
      ? ''
      : ` (${scrubControlText(headlessCloudTruncate(detail, 64))})`
  return `Cloud session ${sessionId} no longer uses this computer${suffix}; stopping.`
}

/**
 * gold `mo` @202401343 — create without initialPrompt + kinds →
 * declare_dialog_kinds; attach with workerAwaitsAnswer → rearm_parked_prompt.
 */
export function headlessCreateDialogKindHint(
  opened: {
    entry: 'create' | 'attach'
    initialPrompt?: unknown
    workerAwaitsAnswer?: boolean
  },
  kinds: readonly string[],
): HeadlessCloudDialogArm | null {
  if (opened.entry === 'create') {
    return opened.initialPrompt === undefined && kinds.length > 0
      ? 'declare_dialog_kinds'
      : null
  }
  return opened.workerAwaitsAnswer === true ? 'rearm_parked_prompt' : null
}

/**
 * gold `go` @202401514 — retryable http 5xx/429/408.
 */
export function isRetryableCloudHttp(event: {
  outcome?: string
  cause?: string
  status?: number
}): boolean {
  return (
    event.outcome === 'failed' &&
    event.cause === 'http' &&
    event.status !== undefined &&
    (event.status >= 500 || event.status === 429 || event.status === 408)
  )
}

/**
 * gold `_o` @202401624 — stdin_eof / end_session exit 0; disconnect 1.
 */
export function headlessCloudExitFromReason(
  reason: HeadlessCloudExitReason,
  message?: string,
  disconnectCode?: CloudDisconnectCode,
): HeadlessCloudExit {
  const r =
    disconnectCode === undefined
      ? normalizeDisconnectCode(undefined)
      : normalizeDisconnectCode(disconnectCode)
  switch (reason) {
    case 'stdin_eof':
    case 'end_session':
      return message === undefined
        ? { exitCode: 0, reason }
        : { exitCode: 0, reason, message }
    case 'tool_host_ended':
      return {
        exitCode: 0,
        reason,
        message: clipExitMessage(message ?? reason),
      }
    case 'disconnected':
      return {
        exitCode: 1,
        reason,
        disconnectCode: r,
        message: scrubControlText(message ?? disconnectCopy(r)),
      }
    case 'rejected_options':
    case 'open_failed':
      return {
        exitCode: 1,
        reason,
        message: clipExitMessage(message ?? reason),
      }
    case 'output_failed':
      return {
        exitCode: 1,
        reason,
        message: scrubControlText(message ?? reason),
      }
  }
}

/**
 * gold `yo` @202402087 — request subtype.
 */
export function controlRequestSubtype(item: object): unknown {
  const n = 'request' in item ? item.request : undefined
  return typeof n === 'object' && n !== null && 'subtype' in n
    ? n.subtype
    : undefined
}

/**
 * gold `So` @202402208 — not_applied_lost / not_applied_kept / preference.
 */
export function notAppliedLostKept(
  entries: readonly HeadlessCloudNotApplied[],
): {
  not_applied_lost: HeadlessCloudNotApplied[]
  not_applied_kept: HeadlessCloudNotApplied[]
  not_applied_preference: HeadlessCloudNotApplied[]
} {
  return {
    not_applied_lost: entries.filter(({ kind }) => kind === 'lost'),
    not_applied_kept: entries.filter(({ kind }) => kind === 'kept'),
    not_applied_preference: entries.filter(({ kind }) => kind === 'preference'),
  }
}

/**
 * gold `Co` @202402514 — engine parse; unknown → `"engine"`.
 */
export function parseDirSyncEngine(
  reason: string | undefined,
): string | undefined {
  if (reason === undefined) return
  return DIR_SYNC_ENGINE_REASONS.find(known => known === reason) ?? 'engine'
}

/**
 * gold `nn` @202402594 — notice map, cap 8, muted/unmuted exclusive.
 */
export function headlessNoticeMap(): {
  add: (key: string, text: string) => void
  list: () => HeadlessCloudNoticeRow[]
  onChanged: (listener: () => void) => () => void
} {
  const e = new Map<string, string>()
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    add(key, text) {
      const h = trimNoticeText(text)
      if (e.get(key) === h) return
      if (key === SERVED_TOOLS_MUTED_NOTICE_KEY) {
        e.delete(SERVED_TOOLS_UNMUTED_NOTICE_KEY)
      } else if (key === SERVED_TOOLS_UNMUTED_NOTICE_KEY) {
        e.delete(SERVED_TOOLS_MUTED_NOTICE_KEY)
      }
      e.set(key, h)
      const g = e.keys().next()
      if (e.size > HEADLESS_CLOUD_NOTICE_MAP_CAP && g.done !== true) {
        e.delete(g.value)
      }
      emit()
    },
    list: () => [...e].map(([key, text]) => ({ key, text })),
    onChanged: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * gold `wo` @202403574 — Fe-like path/error scrub then Hoe.
 */
export function scrubDirSyncPath(err: unknown): string {
  const n = errorMessage(err).replace(HEADLESS_CLOUD_PATH_SCRUB_RE, ' ').trim()
  return clipNoticeText(n)
}

/**
 * gold `sn` @202402903 — tengu_dir_sync_offline_told. Wrap dialogs host.
 */
export async function tellDirSyncOffline(
  dialogs: HeadlessCloudDialogs | undefined,
  opts: {
    folder: string
    attempts: number
    lastError?: unknown
    signal?: AbortSignal
  },
): Promise<{ acknowledged: boolean }> {
  const surface =
    'sdk_host' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const told = (via: string) => {
    logEvent('tengu_dir_sync_offline_told', {
      via: via as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      attempts: opts.attempts,
      surface,
    })
    if (via === 'dialog') {
      logEvent('tengu_feature_ok', {
        feature_name:
          'remote_sync_offline_dialog' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      logEvent('tengu_feature_bad', {
        feature_name:
          'remote_sync_offline_dialog' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          via as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }
  try {
    if (
      dialogs === undefined ||
      !dialogs.kinds.has(CLOUD_SYNC_OFFLINE_KIND) ||
      !isDirSyncConsentFolder(opts.folder)
    ) {
      told('not_shown')
      return { acknowledged: false }
    }
    const { answer, answered } = await dialogs.request(
      {
        kind: CLOUD_SYNC_OFFLINE_KIND,
        result: CLOUD_SYNC_OFFLINE_RESULTS,
        default: CLOUD_SYNC_OFFLINE_DEFAULT,
      },
      cloudSyncOfflineCopy({
        folder: opts.folder,
        attempts: opts.attempts,
        ...(opts.lastError !== undefined && {
          lastError: scrubDirSyncPath(opts.lastError),
        }),
      }),
      { signal: opts.signal },
    )
    const b = answered && answer === 'continue'
    told(b ? 'dialog' : 'dialog_unanswered')
    return { acknowledged: b }
  } catch (err) {
    logForDebugging(
      `[headlessCloud] could not ask the host about file sync going offline: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    told('failed')
    return { acknowledged: false }
  }
}

/**
 * gold `bo` @202403725 — git ls-tree --long size parse.
 */
export function parseGitLsTreeSizes(stdout: string): {
  fileCount: number
  totalBytes: number
} {
  return [...stdout.matchAll(HEADLESS_CLOUD_LS_TREE_RE)].reduce(
    (n, [, s]) => ({
      fileCount: n.fileCount + 1,
      totalBytes: n.totalBytes + Number(s),
    }),
    { fileCount: 0, totalBytes: 0 },
  )
}

/**
 * gold `pt` @202374487 / gold `_T` @181178659 — timeout Error eo instanceof-checks.
 */
export class HeadlessCloudControlTimeoutError extends Error {
  subtype: string
  constructor(subtype: string, timeoutMs: number) {
    super(
      `control_request '${subtype}' got no response after ${timeoutMs / 1000}s — the worker may still apply it`,
    )
    this.subtype = subtype
  }
}

/** leftover `eo` @202373966 unique `po` copy — keep timeout `cloudSessionDidNotAnswerInTime`. */
export const CLOUD_CLIENT_IS_CLOSING = 'the cloud client is closing'

/**
 * gold `eo` @202373966
 * `the cloud session did not answer ${subtype} in time; it may still apply it`
 */
export function cloudSessionDidNotAnswerInTime(err: unknown): string {
  if (err instanceof HeadlessCloudControlTimeoutError) {
    return `the cloud session did not answer ${err.subtype} in time; it may still apply it`
  }
  const n = errorMessage(err)
  if (n.startsWith('[RemoteSessionManager]')) {
    logForDebugging(`[headlessCloudClient] forward failed: ${n}`)
    return 'the cloud session is not connected'
  }
  return scrubControlText(n)
}

/**
 * gold `Le` @202419370 — `[headlessCloud] ${e}` plus TTY stderr write.
 */
export function writeHeadlessCloudStderr(e: string): void {
  logForDebugging(`[headlessCloud] ${e}`)
  if (process.stderr.isTTY) {
    process.stderr.write(`${e}\n`)
  }
}

export type ServeOnlyLinkSnapshot = {
  session_status?: string
  bound_device_uuid?: unknown
}

/**
 * gold `qo` @202416455 — re-read serve-only link; catch keeps it.
 * FULL: `[headlessCloud] re-reading the serve-only link failed (keeping it): ${l(s)}`
 */
export async function serveOnlyLinkStillBound(
  deviceUuid: string,
  reRead: () => Promise<ServeOnlyLinkSnapshot>,
): Promise<boolean | undefined> {
  try {
    const s = await reRead()
    return (
      s.session_status !== 'archived' &&
      typeof s.bound_device_uuid === 'string' &&
      s.bound_device_uuid.toLowerCase() === deviceUuid.toLowerCase()
    )
  } catch (err) {
    logForDebugging(
      `[headlessCloud] re-reading the serve-only link failed (keeping it): ${errorMessage(err)}`,
    )
    return
  }
}
