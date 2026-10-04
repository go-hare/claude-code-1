/**
 * densable 2.1.283 leftover unique wrap (no fleet compositor / Far key store).
 *
 * Gold SEA `/tmp/official-283/package/claude` — wrap twins only.
 * KEEP: zo EVo staysAttached: true (owned by cloudSession.ts; do not invert).
 *
 * gold `Fi` @202283734 · gold `AWt` @202284437 · gold `kWt` @202284645
 * gold `Eo` @202280662 · gold `RWt` @202285771 · gold `xWt` @202287816
 * gold `Zi` @202288489 · gold `PWt` @202288606 · gold `iKr` @202290825
 * gold `IWt` @202291200 · gold `AVo` @202293959 · gold `kVo` @202294334
 * gold `Xe` @202333532 · gold `jt` @202333608 · gold leftover `_jt` `consent.attach_sync.title` + unique `consent.sync.title` (leftoverCloudCopy.ts)
 * leftover `Eo` @202280653 unique timeout/disconnected/tengu_device_hooks_* (leftoverCloudCopy.ts)
 * leftover Qs-adj `Ee`/`lt`/`ut` @202362116 (leftoverCloudCopy.ts; keep `applyInterruptCancelQueued`)
 * leftover `on` @202405797 sync question abandoned · leftover print-arm @202463137 (leftoverCloudCopy.ts)
 * gold `Ze` @202334992
 * gold `class tt` @202335088 · gold `Ts` @202344277 · gold `Hs` @202344734
 * gold `Kt` @202345363 · gold `Ls` @202345448 · gold `xs` @202345676
 * gold `Us` @202345967 · gold `Gt` @202346212 · gold `et` @202346304
 * gold `Qs` @202358474 (`cancel_queued`; wrap-hole not-delivered copy) · gold `Js` @202373828 · gold `Nt` @202327058 (clip; wrap-hole agent_request)
 * gold `__n` @202419110 · gold `Bar` @196066607 · gold `zbe` @196066774
 * gold `ype` @196067729 · gold `jGt` @185893074 · gold `HGt` @185892587
 * gold `x2o` @185902119 · gold `Dae` @185902771 · gold `eSn` @200263182
 * gold `fVt` @200265467 · gold `p7r` @200266307
 * gold `HWt` @202291265 · gold `Rt` @202303237 · gold `class st` @202335343
 * gold `bSn` @202277620 · gold `qn` @202305373 · gold `Li` @202277796
 * gold `_s` @202329864 · gold `Os` @202334745 · gold `As` @202334800
 * leftover `PWt`/`TXn`/`v`/`Ke`/`st`/`dt`/`tn` unique logs (leftoverHeadlessCopy.ts)
 * leftover `Yo` @202433401 compositor BODY leftoverHeadlessAttach.ts
 * leftover `tn.initializeWorker` @202378433 compositor BODY leftoverHeadlessWorker.ts
 * leftover `tn` remaining methods leftoverHeadlessClient.ts (drainOutbound/emit/closeFromSignal/closeTransport/tearDown/end/settleOpener/openSession/refuseWhileClosing/logEnded/logWorkerInit/markWorkerReady/attach)
 * leftover `m_n` unique initializeWorker log tengu_remote_headless_client_worker_initialize — keep SDK `{done}` host
 * leftover `_o` @202276282 TIe/RIe wrap leftoverTulip.ts
 * leftover `gPe` default wrap leftoverHeadlessManager.ts
 * (re-exported from leftoverHookWait.ts · leftoverCloudCopy.ts · leftoverHeadlessCopy.ts · leftoverHeadlessAttach.ts · leftoverHeadlessClient.ts · leftoverTulip.ts · leftoverHeadlessManager.ts)
 */
import { getOauthAccountInfo } from 'src/utils/auth.js'
import { errorMessage } from 'src/utils/errors.js'
import { logForDebugging } from 'src/utils/debug.js'
import { sleep } from 'src/utils/sleep.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isViolinWoodEnabled } from './violinWood.js'
import {
  logRemoteCreatePermissionModeNotTaken,
  logRemoteCreatePermissionModeTaken,
} from './leftoverHeadlessCopy.js'
import {
  type AttachDeviceBinding,
  CLOUD_SYNC_CONSENT_KIND,
  DEVICE_MCP_CONSENT_KIND,
  formatCloudSessionId,
  type HeadlessCloudDialogs,
  type HeadlessCloudNotApplied,
  type HeadlessCloudNotice,
  isCloudEgressAllowed,
  isDirSyncConsentFolder,
  resolveBindAccount,
  type RepositoryTrustState,
  UNATTENDED_SERVING_CONSENT_KIND,
} from './cloudSession.js'

/** gold `Ihe` @179058401 — AWt description cap. */
const HOOK_DESCRIPTION_CAP = 2000
/** gold `ji` @202284200 — AWt content_digest. */
const CONTENT_DIGEST_RE = /^[0-9a-f]{64}$/
/** gold `zCe`/`yI` @182120555 — iKr grace before refusing send. */
const PERMISSION_MODE_SAVE_GRACE_MS = 2000
/** gold `zi` @202288000 — PWt set_permission_mode timeout. */
const PERMISSION_MODE_PUSH_TIMEOUT_MS = 300_000
/** gold `Bi` @202288010 */
const PERMISSION_MODE_PUSH_RETRY_MS = [400, 1200] as const
/** gold `Gi` @202288020 */
const PERMISSION_MODE_PUSH_RETRY_WINDOW_MS = 5000
/** gold `qje` @191133040 — zN clip used by et. */
const CLOUD_ENVELOPE_STRING_CAP = 200
/** gold `Ds` @202334700 — tt emitted uuid ceiling. */
const EMITTED_UUID_CEILING = 200_000
/** gold `Nt` @202327058 clip. */
const HEADLESS_ERROR_CLIP = 64

/** gold `C7n` @202288040 */
export const PERMISSION_MODE_PUSH_GAVE_UP_IDLE =
  "Switch permission modes away and back once to keep this session's mode: it couldn't be saved on the server, so the session may fall back to default after idling."
/** gold `Ki` @202288150 */
export const PERMISSION_MODE_PUSH_GAVE_UP =
  "Switch permission modes away and back once: this session's mode couldn't be saved on the server."
/** gold `Ji` @202288230 */
export const PERMISSION_MODE_PUSH_SESSION_INACTIVE =
  "This session's permission mode couldn't be saved: the server says the session isn't active. Switch modes away and back once it is."

/** gold `Lre.kind` @202287586 */
export const CLOUD_SYNC_OFFLINE_KIND = 'cloud_sync_offline'
/** densable `Lre.result` @202287582 */
export const CLOUD_SYNC_OFFLINE_RESULTS = ['continue', 'unanswered'] as const
/** densable `Lre.default` @202287582 */
export const CLOUD_SYNC_OFFLINE_DEFAULT = 'unanswered' as const

/** gold Di `sync_offline.title` @181891599 */
export const CLOUD_SYNC_OFFLINE_TITLE = 'File sync is offline for this session'
/** gold Di `sync_offline.body` @181891599 */
export const CLOUD_SYNC_OFFLINE_BODY =
  'Changes are no longer being copied between this project directory and the cloud session until service is restored. Your session will continue without file sync and Claude will run its tools on your local files only instead.'

/** gold `Je` @202344550 */
export const UNSUPPORTED_PEER_CONTENT_OMITTED =
  '[unsupported content from another client omitted]'

/** gold `IWt` @202291200 */
export const HEADLESS_CLOUD_WATCHDOG_WARNING =
  'Cloud session may be unresponsive. Attempting to reconnect…'

const PEER_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

/** gold `x8` @183020072 — k7n/ht prefix. */
const PEER_ARRIVED_PREFIX = 'A message arrived from '
/** gold `kAe` @182392216 */
const PEER_OTHER_SESSION_PREFIX = 'Another Claude session sent a message'
/** gold `Wee` @182395028 */
const PEER_ACTIVITY_PREFIXES = [
  'Another Claude session sent a message while you were working:.',
  'Another Claude session sent a message:.',
  'A peer session sent a message while you were working:.',
] as const

const BASH_RESULT_PREFIXES = [
  '<bash-stdout',
  '<bash-stderr',
  '<local-command-stdout',
  '<local-command-stderr',
] as const

const BASH_RESULT_INCLUDES = [
  '<bash-input>',
  '<user-memory-input>',
  '<mcp-resource-update',
  '<mcp-polling-update',
] as const

const CLOUD_SESSION_FEATURE_KEYS = [
  'settings',
  'hooks',
  'plugins',
  'tools',
] as const

/**
 * gold `Fi` @202283734 — forwarded-hook outcome → tengu ok/sad/bad.
 * Not first `Fi` @175490813.
 */
export function classifyForwardedHookOutcome(
  outcome: string,
): 'ok' | 'sad' | 'bad' | string | null {
  switch (outcome) {
    case 'answered':
    case 'event_mismatch':
    case 'condition_false':
    case 'cancelled':
    case 'muted':
      return 'ok'
    case 'not_mine':
    case 'cached':
    case 'withdrawn_replay':
    case 'same_invocation':
      return null
    case 'unknown_id':
    case 'replay_mismatch':
    case 'event_name_mismatch':
    case 'input_too_large':
    case 'overloaded':
    case 'stale':
    case 'invalid_input':
    case 'unsupported_kind':
    case 'no_roots':
    case 'untrusted':
    case 'in_reach_refused':
    case 'pin_refused':
    case 'pin_changed':
    case 'pin_unreadable':
    case 'untranslated_skipped':
    case 'condition_error':
    case 'no_slot':
    case 'too_late':
    case 'run_error':
    case 'unattested':
      return 'sad'
    case 'staging_failed':
    case 'decide_error':
      return 'bad'
    default:
      return outcome
  }
}

/** gold `yB` @179060044 — non-empty trimmed description. */
function isNonEmptyHookDescription(description: string): boolean {
  return description.replace(/\s+/g, ' ').trim() !== ''
}

/**
 * gold `AWt` @202284437 — digest-only hook input (`content_digest` sha256).
 */
export function isDigestOnlyHookInput(e: {
  description?: string
  input: Record<string, unknown>
}): boolean {
  const n = e.description
  const r = e.input
  const s = Object.keys(r)
  const h = r.content_digest
  return (
    n !== undefined &&
    n.length <= HOOK_DESCRIPTION_CAP &&
    isNonEmptyHookDescription(n) &&
    s.length === 1 &&
    typeof h === 'string' &&
    CONTENT_DIGEST_RE.test(h)
  )
}

/**
 * gold `kWt` @202284645 — folder-relation judge wrap.
 * No inventory tracker: `syncElsewhere!==false` → `"unknown"` (gold first return).
 */
export function createLaunchFolderJudge(opts: {
  launchDir: string
  syncElsewhere?: boolean
}): { judge: () => Promise<'unknown' | 'outside'> } {
  return {
    async judge() {
      if (opts.syncElsewhere !== false) return 'unknown'
      return 'unknown'
    },
  }
}

/**
 * gold `Eo` @202280662 — memory/create sender wrap.
 * No `$Eo` fleet compositor / storageV5 engine.
 */
export function createMemorySender(_opts: {
  launchDir: string
  memory?: unknown
  cloudSessionId?: string
  session?: unknown
  sendControlRequest?: (subtype: string, body: unknown) => Promise<unknown>
  syncRoot?: unknown
  servingMuted?: boolean
  onLine?: (line: string) => void
  storageV5?: unknown
}): {
  unregister: (reason?: string) => void
  servingMute: (muted: boolean) => void
} {
  return {
    unregister: () => {},
    servingMute: () => {},
  }
}

/**
 * leftover `RWt` @202285762 unique tokens — keep createBoundCreatePack host.
 * Gold: `stopped_while_running` / `onWorkerUp:O("worker_up")` next to
 * `[RemoteSessionManager] Cannot send: not connected`.
 */
export const STOPPED_WHILE_RUNNING = 'stopped_while_running'
/** leftover `RWt` @202285762 unique `onWorkerUp:O("worker_up")`. */
export const WORKER_UP = 'worker_up'

/**
 * gold `RWt` @202285771 — create session + sender wrap.
 * Default sender is `Eo`; no RemoteSessionManager compositor.
 * gold `Li` @202277796 waiter factory is `createForwardedHookWait`
 * (copy + seams; no hook fleet).
 */
export function createBoundCreatePack(opts: {
  launchDir: string
  memory?: unknown
  cloudSessionId?: string
  createSender?: typeof createMemorySender
  isServingMuted?: () => boolean
  manager?: () => {
    sendControlRequest: (a: string, b: unknown) => Promise<unknown>
  } | null
  syncRoot?: unknown
  onLine?: (line: string) => void
  storageV5?: unknown
}): {
  sender: ReturnType<typeof createMemorySender>
  servingMuted: boolean
} {
  const s = opts.isServingMuted ?? (() => false)
  const h = s()
  const createSender = opts.createSender ?? createMemorySender
  const sender = createSender({
    launchDir: opts.launchDir,
    memory: opts.memory,
    cloudSessionId: opts.cloudSessionId,
    sendControlRequest: (j, A) => {
      const L = opts.manager?.()
      if (L === null || L === undefined) {
        return Promise.reject(
          Error('[RemoteSessionManager] Cannot send: not connected'),
        )
      }
      return L.sendControlRequest(j, A)
    },
    syncRoot: opts.syncRoot,
    servingMuted: h,
    onLine: opts.onLine,
    storageV5: opts.storageV5,
  })
  return { sender, servingMuted: h }
}

/** gold `Hoe` @195753406 — lastError clip 200 + ellipsis. */
function clipOfflineError(r: string): string {
  return r.length <= CLOUD_ENVELOPE_STRING_CAP
    ? r
    : `${r.slice(0, CLOUD_ENVELOPE_STRING_CAP - 1)}…`
}

/**
 * gold `xWt` @202287816 — `cloud_sync_offline` copy.
 */
export function cloudSyncOfflineCopy(opts: {
  folder: string
  attempts: number
  lastError?: string
}): {
  folder: string
  title: string
  body: string
  attempts: number
  lastError?: string
} {
  const s =
    opts.lastError === undefined
      ? undefined
      : clipOfflineError(opts.lastError.replace(/\s+/g, ' ').trim())
  return {
    folder: opts.folder,
    title: CLOUD_SYNC_OFFLINE_TITLE,
    body: CLOUD_SYNC_OFFLINE_BODY,
    attempts: opts.attempts,
    ...(s !== undefined && s !== '' && { lastError: s }),
  }
}

/**
 * gold `Zi` @202288489 — retryable permission-mode POST.
 */
export function isRetryablePermissionModePost(e: {
  outcome: string
  cause?: string
  status?: number
}): boolean {
  return (
    e.outcome === 'failed' &&
    (e.cause === 'network' ||
      (e.cause === 'http' &&
        e.status !== undefined &&
        (e.status >= 500 || e.status === 429)))
  )
}

export type PermissionModePostResult = {
  outcome: string
  cause?: string
  status?: number
}

/**
 * gold `PWt` @202288606 — create `set_permission_mode` push wrap.
 * Posts via `manager.postControlRequest` / `sendPayloadToRemoteSession`.
 */
export function pushCreatePermissionMode(opts: {
  manager: {
    postControlRequest: (
      req: { subtype: 'set_permission_mode'; mode: string },
      extra: {
        answerExpected: boolean
        background: boolean
        timeoutMs: number
        signal: AbortSignal
      },
    ) => {
      posted: Promise<PermissionModePostResult>
      response: Promise<unknown>
    }
  }
  mode: string
  surface: string
  sessionId: string
  superseded: () => boolean
  observedMode?: () => string | undefined
  seededModeReported?: () => boolean
  onRefused?: (posted: Promise<PermissionModePostResult>) => void
  onGaveUp?: (copy: string) => void
  onTaken?: () => void
  linkDown?: () => boolean
  now?: () => number
  delay?: (ms: number) => Promise<void>
}): Promise<PermissionModePostResult> {
  const now = opts.now ?? Date.now
  const delay = opts.delay ?? sleep
  const x = (T: Record<string, unknown>) => {
    logEvent('tengu_remote_create_permission_mode_push', {
      surface:
        opts.surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      mode: opts.mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      kind: String(
        T.kind,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      posted_mode: String(
        T.postedMode,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      outcome: String(
        T.outcome,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  const P = (): boolean => {
    const T = opts.observedMode?.()
    return (
      opts.superseded() ||
      (T !== undefined &&
        T !== opts.mode &&
        (T !== 'default' || (opts.seededModeReported?.() ?? false)))
    )
  }
  const O = async (
    T: string,
    j: string,
    A = now(),
    L = 1,
  ): Promise<{
    result: PermissionModePostResult
    response: Promise<unknown> | null
  }> => {
    const U = new AbortController()
    const N = opts.manager.postControlRequest(
      { subtype: 'set_permission_mode', mode: T },
      {
        answerExpected: false,
        background: true,
        timeoutMs: PERMISSION_MODE_PUSH_TIMEOUT_MS,
        signal: U.signal,
      },
    )
    N.response.catch(() => {})
    const V = await N.posted
    x({ ...V, kind: j, postedMode: T, attempt: L })
    if (V.outcome === 'accepted') return { result: V, response: N.response }
    U.abort()
    if (P()) {
      x({ kind: j, postedMode: T, outcome: 'superseded' })
      return { result: V, response: null }
    }
    const B = PERMISSION_MODE_PUSH_RETRY_MS[L - 1]
    if (
      B !== undefined &&
      isRetryablePermissionModePost(V) &&
      now() - A < PERMISSION_MODE_PUSH_RETRY_WINDOW_MS
    ) {
      await delay(B)
      if (!P()) return O(T, j, A, L + 1)
      x({ kind: j, postedMode: T, outcome: 'superseded' })
      return { result: V, response: null }
    }
    x({ kind: j, postedMode: T, outcome: 'gave_up' })
    if (!(V.outcome === 'failed' && V.cause === 'closed')) {
      opts.onGaveUp?.(
        V.outcome === 'session_inactive'
          ? PERMISSION_MODE_PUSH_SESSION_INACTIVE
          : j === 'push'
            ? PERMISSION_MODE_PUSH_GAVE_UP_IDLE
            : PERMISSION_MODE_PUSH_GAVE_UP,
      )
    }
    return { result: V, response: null }
  }
  return O(opts.mode, 'push').then(({ result: V, response: N }) => {
    if (V.outcome === 'accepted' && N) {
      N.then(
        () => {
          x({ kind: 'push', postedMode: opts.mode, outcome: 'taken' })
          opts.onTaken?.()
          logRemoteCreatePermissionModeTaken(opts.mode)
        },
        (j: unknown) => {
          logRemoteCreatePermissionModeNotTaken(opts.mode, j)
          x({ kind: 'push', postedMode: opts.mode, outcome: 'unanswered' })
        },
      )
    }
    void opts.onRefused
    void opts.linkDown
    return V
  })
}

/**
 * gold `iKr` @202290825 — hold send until create mode is saved, else grace `zCe`.
 */
export function holdUntilPermissionModeSaved(opts: {
  posted: Promise<PermissionModePostResult>
  mode: string
  latch: { notTakenAtMs?: number }
  retire: () => void
  now?: () => number
}): (arg?: {
  submittedAtMs?: number
}) => Promise<{ go: false; reason: string } | undefined> {
  const h = opts.now ?? Date.now
  const g = opts.posted.then(
    v => v.outcome === 'accepted',
    () => false,
  )
  void g.then(v => {
    if (v) opts.retire()
    else opts.latch.notTakenAtMs ??= h()
  })
  return async ({ submittedAtMs: v } = {}) => {
    const w = v ?? h()
    if (await g) return
    if (w - (opts.latch.notTakenAtMs ?? w) < PERMISSION_MODE_SAVE_GRACE_MS) {
      return {
        go: false,
        reason: `the session's ${opts.mode} permission mode couldn't be saved on the server first`,
      }
    }
    opts.retire()
    return
  }
}

/**
 * gold `AVo` @202293959 — bound device id when wood ∧ egress.
 */
export async function boundDeviceIdIfEgressAllowed(
  e: Promise<{ archived: boolean; boundDeviceId?: string }>,
  seams: {
    isEnabled?: () => Promise<boolean>
    isEgressAllowed?: () => boolean
  } = {},
): Promise<string | undefined> {
  e.catch(() => {})
  const o = seams.isEnabled ?? isViolinWoodEnabled
  const d = seams.isEgressAllowed ?? isCloudEgressAllowed
  if (!(await o().catch(() => false))) return
  const { archived: s, boundDeviceId: n } = await e
  if (s) return
  try {
    return d() ? n : undefined
  } catch {
    return
  }
}

/**
 * gold `f` @202294226 — served-tools owner from attach binding.
 */
export function servedToolsOwner(opts: {
  viewerOnly: boolean
  binding: AttachDeviceBinding
}): { owner: boolean; deviceId?: string } {
  return !opts.viewerOnly && opts.binding.status === 'bound'
    ? { owner: true, deviceId: opts.binding.deviceId }
    : { owner: false }
}

/**
 * gold `kVo` @202294334 — servedToolsAttachOptions wrap.
 * No bun-chunk plumbing compositor.
 */
export async function servedToolsAttachOptions(opts: {
  sessionId: string
  binding: Promise<AttachDeviceBinding>
  deviceBridge?: unknown
  onNotice?: (line: string) => void
  repositoryTrust?: unknown
}): Promise<{
  owner: () => { owner: boolean; deviceId?: string }
  sessionId: string
  deviceBridge?: unknown
  onNotice?: (line: string) => void
  repositoryTrust?: unknown
}> {
  const r = await opts.binding.then(
    a => servedToolsOwner({ viewerOnly: false, binding: a }),
    () => ({ owner: false as const }),
  )
  return {
    owner: () => r,
    sessionId: opts.sessionId,
    ...(opts.deviceBridge !== undefined && { deviceBridge: opts.deviceBridge }),
    ...(opts.onNotice && { onNotice: opts.onNotice }),
    ...(opts.repositoryTrust !== undefined && {
      repositoryTrust: opts.repositoryTrust,
    }),
  }
}

/** gold `Nt` @202327058 — clip (different leftover `Nt` than agent_request). */
export function truncateHeadlessError(e: string): string {
  return e.length <= HEADLESS_ERROR_CLIP ? e : e.slice(0, HEADLESS_ERROR_CLIP)
}

/**
 * leftover `Nt` @202327058 unique `Ke.log` — keep `truncateHeadlessError`.
 * Gold: `i("tengu_remote_headless_client_agent_request",{subtype,outcome,latency_ms,reasked})`.
 */
export function logRemoteHeadlessClientAgentRequest(opts: {
  subtype: string
  outcome: string
  latencyMs: number
  reasked?: boolean
}): void {
  logEvent('tengu_remote_headless_client_agent_request', {
    subtype:
      opts.subtype as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome:
      opts.outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    latency_ms: opts.latencyMs,
    reasked: opts.reasked === true,
  })
}

/**
 * gold leftover `_jt` @202330701 Di key on leftoverUnique host-dialog (Xe/jt).
 * Title/body/detail copy lives in leftoverCloudCopy.ts — no dialog compositor.
 */
export {
  CONSENT_ATTACH_SYNC_TITLE_KEY,
  CONSENT_SYNC_BODY_KEY,
  CONSENT_SYNC_DETAIL_KEY,
  CONSENT_SYNC_TITLE_KEY,
} from './leftoverCloudCopy.js'

/**
 * gold `Xe` @202333532 — host-dialog kinds QUe/Lre/be/Cgt.
 */
export function isHeadlessHostDialogKind(kind: string): boolean {
  return (
    kind === CLOUD_SYNC_CONSENT_KIND ||
    kind === CLOUD_SYNC_OFFLINE_KIND ||
    kind === UNATTENDED_SERVING_CONSENT_KIND ||
    kind === DEVICE_MCP_CONSENT_KIND
  )
}

/**
 * gold `jt` @202333608 — host dialog dispatcher wrapping `dialogs.request`.
 */
export function createHeadlessHostDialogDispatcher(opts: {
  io: {
    requestUserDialog: (
      kind: string,
      payload: unknown,
      extra?: { signal?: AbortSignal },
    ) => Promise<{ behavior: string; result?: unknown }>
  }
  declaredKinds: Set<string>
  clock?: { now: () => number }
}): (
  dialog: { kind: string; default: unknown },
  payload: unknown,
  extra?: { signal?: AbortSignal },
) => Promise<{ answer: unknown; answered: boolean }> {
  const s = opts.clock ?? { now: () => Date.now() }
  return async (h, g, v) => {
    const w = s.now()
    const b = (q: string) => {
      logEvent('tengu_remote_headless_client_host_dialog', {
        dialog_kind:
          h.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        outcome:
          q as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        latency_ms: (s.now() - w) as never,
      })
    }
    const E = { answer: h.default, answered: false }
    if (!opts.declaredKinds.has(h.kind)) {
      b('undeclared')
      return E
    }
    if (g === null || typeof g !== 'object') {
      b('invalid_payload')
      return E
    }
    let A: { behavior: string; result?: unknown }
    try {
      A = await opts.io.requestUserDialog(h.kind, g, { signal: v?.signal })
    } catch (q) {
      logForDebugging(
        `[headlessCloudClient] host dialog ${h.kind} failed: ${errorMessage(q)}`,
      )
      A = { behavior: 'cancelled' }
    }
    if (A.behavior === 'cancelled') {
      b('cancelled')
      return E
    }
    if (A.result === undefined) {
      b('invalid_result')
      return E
    }
    b('answered')
    return { answer: A.result, answered: true }
  }
}

/** gold `Ze` @202334992 — partial-frame (different leftover `Ze` than dropped key). */
export function isHeadlessPartialFrame(e: {
  type?: string
  subtype?: string
}): boolean {
  return (
    e.type === 'stream_event' ||
    (e.type === 'system' && e.subtype === 'thinking_tokens')
  )
}

/**
 * leftover `Ze` @202334992 unique st.handle drop log — keep `isHeadlessPartialFrame`.
 * Gold: `[headlessCloudClient] dropped a cloud_session key on a ${type} frame from source=`.
 */
export function logDroppedCloudSessionKey(
  frameType: string,
  source?: string,
): void {
  const typeClip = frameType.length <= 40 ? frameType : frameType.slice(0, 40)
  const sourceClip = (source ?? 'unknown').slice(0, 40)
  logForDebugging(
    `[headlessCloudClient] dropped a cloud_session key on a ${typeClip} frame from source=${sourceClip}`,
    { level: 'warn' },
  )
}

/** gold `class tt` @202335088 — emitted uuid LRU. */
export class HeadlessEmittedUuidSet {
  ceiling: number
  uuids = new Set<string>()
  constructor(e: number = EMITTED_UUID_CEILING) {
    this.ceiling = e
  }
  add(e: string): void {
    if (this.uuids.has(e)) return
    if (this.uuids.size >= this.ceiling) {
      const n = this.uuids.values().next().value
      if (n !== undefined) this.uuids.delete(n)
    }
    this.uuids.add(e)
  }
  has(e: string): boolean {
    return this.uuids.has(e)
  }
}

/** gold `Kt` @202345363 */
export function isToolUseBlock(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'type' in e &&
    (e as { type?: unknown }).type === 'tool_use'
  )
}

/** gold `Re` @202064346 visible tags — fPe/Ls. */
function looksLikeToolResultText(e: string): boolean {
  if (BASH_RESULT_PREFIXES.some(p => e.startsWith(p))) return true
  if (
    (e.startsWith(PEER_ARRIVED_PREFIX) ||
      e.startsWith(PEER_OTHER_SESSION_PREFIX)) &&
    e.startsWith('<', e.indexOf('.') + 1)
  ) {
    return true
  }
  const n = PEER_ACTIVITY_PREFIXES.find(s => e.startsWith(s))
  if (n !== undefined && e.startsWith('<', n.length)) return true
  return BASH_RESULT_INCLUDES.some(p => e.includes(p))
}

/** gold `fPe` @202065022 */
function peerContentLooksLikeToolResult(e: {
  tool_use_result?: unknown
  message?: { content?: unknown }
}): boolean {
  if (e.tool_use_result !== undefined) return true
  const n = e.message?.content
  if (typeof n === 'string') return looksLikeToolResultText(n)
  return (
    Array.isArray(n) &&
    n.some(
      s =>
        typeof s === 'object' &&
        s !== null &&
        'type' in s &&
        ((s as { type?: unknown }).type === 'tool_result' ||
          ((s as { type?: unknown }).type === 'text' &&
            'text' in s &&
            typeof (s as { text?: unknown }).text === 'string' &&
            looksLikeToolResultText((s as { text: string }).text))),
    )
  )
}

/** gold `xXe` @202065200 */
function peerContentHasUnreadableBlock(e: {
  message?: { content?: unknown }
}): boolean {
  const n = e.message?.content
  return (
    Array.isArray(n) &&
    !n.every(
      s =>
        typeof s === 'object' &&
        s !== null &&
        ((s as { type?: unknown }).type !== 'text' ||
          typeof (s as { text?: unknown }).text === 'string'),
    )
  )
}

/** gold `A7n` @202065471 */
function peerContentNeverStreams(e: {
  tool_use_result?: unknown
  message?: { content?: unknown }
}): boolean {
  return peerContentLooksLikeToolResult(e) || peerContentHasUnreadableBlock(e)
}

/** gold `ht` @202065600 / `k7n` @202065509 */
function peerTextLooksUnreliable(e: string): boolean {
  const n = e.indexOf('.')
  return (
    (n === -1 || n === e.length - 1) &&
    (e.startsWith(PEER_ARRIVED_PREFIX) ||
      e.startsWith(PEER_OTHER_SESSION_PREFIX) ||
      PEER_ACTIVITY_PREFIXES.some(s => e.startsWith(s.trimEnd())))
  )
}

function peerContentUnreliable(e: {
  message?: { content?: unknown }
}): boolean {
  if (peerContentNeverStreams(e)) return true
  const n = e.message?.content
  const texts =
    typeof n === 'string'
      ? [n]
      : Array.isArray(n)
        ? n.flatMap(r =>
            typeof r === 'object' &&
            r !== null &&
            (r as { type?: unknown }).type === 'text' &&
            typeof (r as { text?: unknown }).text === 'string'
              ? [(r as { text: string }).text]
              : [],
          )
        : []
  return texts.some(peerTextLooksUnreliable)
}

/**
 * gold `Ls` @202345448 — multi-text that concatenates to a tool-result blob.
 */
export function isPeerToolResultTextBlob(e: unknown[]): boolean {
  const n = e.flatMap(s =>
    typeof s === 'object' &&
    s !== null &&
    'type' in s &&
    (s as { type?: unknown }).type === 'text' &&
    'text' in s &&
    typeof (s as { text?: unknown }).text === 'string'
      ? [(s as { text: string }).text]
      : [],
  )
  return (
    n.length > 1 &&
    ['', '.', ' '].some(s =>
      peerContentLooksLikeToolResult({ message: { content: n.join(s) } }),
    )
  )
}

/** gold `xs` @202345676 */
export function peerImageSource(e: unknown): {
  type: 'base64'
  media_type: string
  data: string
} | null {
  if (typeof e !== 'object' || e === null || !('source' in e)) return null
  const n = (e as { source?: unknown }).source
  if (
    typeof n !== 'object' ||
    n === null ||
    !('type' in n) ||
    (n as { type?: unknown }).type !== 'base64' ||
    !('data' in n) ||
    typeof (n as { data?: unknown }).data !== 'string'
  ) {
    return null
  }
  const s = PEER_IMAGE_MEDIA_TYPES.find(
    r => 'media_type' in n && (n as { media_type?: unknown }).media_type === r,
  )
  return s === undefined
    ? null
    : { type: 'base64', media_type: s, data: (n as { data: string }).data }
}

/**
 * gold `Hs` @202344734 — strip unsupported peer content.
 */
export function stripUnsupportedPeerContent(e: unknown): {
  content: unknown
  omitted: number
  omittedToolUse: boolean
} {
  if (typeof e === 'string') {
    return { content: e, omitted: 0, omittedToolUse: false }
  }
  if (!Array.isArray(e)) {
    return {
      content: [{ type: 'text', text: UNSUPPORTED_PEER_CONTENT_OMITTED }],
      omitted: 1,
      omittedToolUse: isToolUseBlock(e),
    }
  }
  const n = e
  const s = n.some(isToolUseBlock)
  if (isPeerToolResultTextBlob(n)) {
    return {
      content: [{ type: 'text', text: UNSUPPORTED_PEER_CONTENT_OMITTED }],
      omitted: n.length,
      omittedToolUse: s,
    }
  }
  const r = n.flatMap(g => {
    if (typeof g !== 'object' || g === null || !('type' in g)) return []
    if (
      (g as { type?: unknown }).type === 'text' &&
      'text' in g &&
      typeof (g as { text?: unknown }).text === 'string'
    ) {
      return [{ type: 'text' as const, text: (g as { text: string }).text }]
    }
    const v =
      (g as { type?: unknown }).type === 'image' ? peerImageSource(g) : null
    return v === null ? [] : [{ type: 'image' as const, source: v }]
  })
  const h = n.length - r.length
  return {
    content:
      h > 0
        ? [...r, { type: 'text', text: UNSUPPORTED_PEER_CONTENT_OMITTED }]
        : r,
    omitted: h,
    omittedToolUse: s,
  }
}

/** gold `Us` @202345967 */
export function isIsoTimestamp(e: unknown): e is string {
  return (
    typeof e === 'string' &&
    e.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(e) &&
    !Number.isNaN(Date.parse(e))
  )
}

/**
 * gold `Ts` @202344277 — reshape peer user prompt, wrapping Hs/Us.
 */
export function reshapePeerUserPrompt(
  e: {
    uuid?: unknown
    timestamp?: unknown
    message?: { content?: unknown }
  },
  opts: { keepUuid: boolean; sessionId: string },
): {
  prompt: Record<string, unknown>
  omitted: number
  omittedToolUse: boolean
} {
  const r = opts.keepUuid && typeof e.uuid === 'string' ? e.uuid : null
  const {
    content: h,
    omitted: g,
    omittedToolUse: v,
  } = stripUnsupportedPeerContent(e.message?.content)
  return {
    prompt: {
      type: 'user',
      ...(r !== null && { uuid: r }),
      session_id: opts.sessionId,
      message: { role: 'user', content: h },
      parent_tool_use_id: null,
      ...(isIsoTimestamp(e.timestamp) && { timestamp: e.timestamp }),
    },
    omitted: g,
    omittedToolUse: v,
  }
}

/** gold `zN` @191133054 — clip 200. */
function clipEnvelopeString(e: string): string {
  return e.length <= CLOUD_ENVELOPE_STRING_CAP
    ? e.trim()
    : e.trim().slice(0, CLOUD_ENVELOPE_STRING_CAP)
}

/**
 * gold `Gt` @202346212 — drop undefined entries.
 */
export function definedEntryMap(
  e: Record<string, unknown>,
): Map<string, unknown> {
  return new Map(
    Object.entries(e).flatMap(([n, s]) =>
      s === undefined ? [] : [[n, s] as [string, unknown]],
    ),
  )
}

/** gold `qs` @202347929 */
function cloudSessionFeatureBag(
  e: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    CLOUD_SESSION_FEATURE_KEYS.flatMap(s => {
      const r = e[s]
      if (typeof r !== 'object' || r === null) return []
      const bag = r as {
        state?: unknown
        source?: unknown
        reason?: unknown
        message?: unknown
      }
      return [
        [
          s,
          {
            ...(typeof bag.state === 'string' && {
              state: clipEnvelopeString(bag.state),
            }),
            ...(typeof bag.source === 'string' && {
              source: clipEnvelopeString(bag.source),
            }),
            ...(typeof bag.reason === 'string' && {
              reason: clipEnvelopeString(bag.reason),
            }),
            ...(typeof bag.message === 'string' && {
              message: clipEnvelopeString(bag.message),
            }),
          },
        ],
      ]
    }),
  )
}

/**
 * gold `et` @202346304 — reshape fetchSession device/dir-sync envelope.
 * `cse_` → `session_` via `formatCloudSessionId`.
 */
export function reshapeCloudSessionEnvelope(e: {
  id: string
  device: {
    status: string
    reason?: string
    message?: string
    display_name?: string
  }
  directory_sync: {
    state: string
    reason?: string
    message?: string
    first_upload?: unknown
    synced_files?: unknown
    other_window?: unknown
    muted?: unknown
    started_from_upload?: unknown
    direction?: unknown
    file_mode?: unknown
    file_mode_source?: unknown
  }
  host?: {
    handle: string
    working_dir: string
    platform: string
    cli_version?: string
  }
  serving?: {
    state: string
    reason?: string
    policy?: unknown
    channel?: unknown
  }
  calls?: {
    live: Array<Record<string, unknown>>
    recent: Array<Record<string, unknown>>
  }
  notices?: Array<{ key: string; text: string }>
  settings?: unknown
  hooks?: unknown
  plugins?: unknown
  tools?: unknown
}): Record<string, unknown> {
  const n = formatCloudSessionId(e.id)
  const s = e.directory_sync
  return {
    ...e,
    id: n,
    device:
      e.device.status === 'unbound'
        ? {
            ...e.device,
            reason:
              e.device.reason !== undefined
                ? clipEnvelopeString(e.device.reason)
                : e.device.reason,
            message:
              e.device.message !== undefined
                ? clipEnvelopeString(e.device.message)
                : e.device.message,
          }
        : {
            ...e.device,
            ...(e.device.display_name !== undefined && {
              display_name: clipEnvelopeString(e.device.display_name),
            }),
          },
    directory_sync: {
      state: s.state,
      ...(s.reason !== undefined && { reason: clipEnvelopeString(s.reason) }),
      ...(s.message !== undefined && {
        message: clipEnvelopeString(s.message),
      }),
      ...(s.first_upload !== undefined && { first_upload: s.first_upload }),
      ...(s.synced_files !== undefined && { synced_files: s.synced_files }),
      ...(s.other_window !== undefined && { other_window: s.other_window }),
      ...(s.muted !== undefined && { muted: s.muted }),
      ...(s.started_from_upload !== undefined && {
        started_from_upload: s.started_from_upload,
      }),
      ...(s.direction !== undefined && { direction: s.direction }),
      file_mode: s.file_mode,
      file_mode_source: s.file_mode_source,
    },
    ...(e.host !== undefined && {
      host: {
        handle: clipEnvelopeString(e.host.handle),
        working_dir: clipEnvelopeString(e.host.working_dir),
        platform: clipEnvelopeString(e.host.platform),
        ...(e.host.cli_version !== undefined && {
          cli_version: clipEnvelopeString(e.host.cli_version),
        }),
      },
    }),
    ...(e.serving !== undefined && {
      serving: {
        state: e.serving.state,
        ...(e.serving.reason !== undefined && { reason: e.serving.reason }),
        policy: e.serving.policy,
        channel: e.serving.channel,
      },
    }),
    ...cloudSessionFeatureBag(e as Record<string, unknown>),
  }
}

/** leftover `Qs` @202358474 unique `Xs` copy — keep `applyInterruptCancelQueued`. */
export const CLOUD_MESSAGE_NOT_DELIVERED =
  'Your message was not delivered to the cloud session'

/** leftover Qs-adj `Ee`/`lt`/`ut` @202362116 — copies in leftoverCloudCopy.ts. */
export {
  CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED,
  CLOUD_CLIENT_CLOSED_BEFORE_SEND_CONFIRMED,
  CONTENT_BLOCK_MUST_BE_OBJECT_TEXT_STRING,
} from './leftoverCloudCopy.js'

/**
 * gold `Qs` @202358474 — stamp `cancel_queued` onto interrupt.
 */
export function applyInterruptCancelQueued<T extends { subtype?: string }>(
  e: { cancel_queued?: boolean } | null,
  n: T,
): T & { cancel_queued?: true } {
  return e !== null &&
    'cancel_queued' in e &&
    e.cancel_queued === true &&
    n.subtype === 'interrupt'
    ? { ...n, cancel_queued: true }
    : n
}

/**
 * gold `Js` @202373828 — bash → streams; tool-result → never; peer chatter → unreliable.
 */
export function classifyToolProgressStream(e: {
  kind?: string
  content?: unknown
}): 'streams' | 'never' | 'unreliable' {
  if (e.kind === 'bash') return 'streams'
  const n = { message: { content: e.content } }
  return peerContentNeverStreams(n)
    ? 'never'
    : peerContentUnreliable(n)
      ? 'unreliable'
      : 'streams'
}

/**
 * gold `__n` @202419110 — stamp `not_applied` onto opened session.cloudSession().
 */
export function stampOpenedCloudSessionNotApplied<
  T extends {
    kind: string
    session?: {
      notices?: HeadlessCloudNotice[]
      cloudSession: () => Record<string, unknown>
    }
  },
>(
  e: T,
  n: {
    notices: HeadlessCloudNotice[]
    entries: HeadlessCloudNotApplied[]
  },
): T {
  if (
    e.kind !== 'opened' ||
    n.entries.length === 0 ||
    e.session === undefined
  ) {
    return e
  }
  const s = e.session
  return {
    ...e,
    session: {
      ...s,
      notices: [...(s.notices ?? []), ...n.notices],
      cloudSession: () => ({
        ...s.cloudSession(),
        not_applied: n.entries.map(({ kind: r, name: h }) => ({
          name: h,
          kind: r,
        })),
      }),
    },
  }
}

/**
 * gold `Bar` @196066607 — env UUID only when host auth source is env/fd.
 */
export async function envAccountUuidIfHostAuth(
  source: () =>
    | Promise<'env' | 'fd' | 'stored' | string>
    | 'env'
    | 'fd'
    | 'stored'
    | string,
): Promise<string | undefined> {
  const e = process.env.CLAUDE_CODE_ACCOUNT_UUID?.toLowerCase()
  if (e === undefined) return
  try {
    const n = await source()
    return n === 'env' || n === 'fd' ? e : undefined
  } catch {
    return
  }
}

/**
 * gold `zbe` @196066774 — Uar(stored, Bar).
 */
export async function resolveBindAccountFromHost(opts?: {
  storedAccountUuid?: string
  hostAuthSource?: () => Promise<'env' | 'fd' | 'stored' | string>
}): Promise<ReturnType<typeof resolveBindAccount>> {
  let e: string | undefined
  try {
    e = opts?.storedAccountUuid ?? getOauthAccountInfo()?.accountUuid
  } catch {
    e = undefined
  }
  return resolveBindAccount({
    storedAccountUuid: e,
    hostAccountUuid: await envAccountUuidIfHostAuth(
      opts?.hostAuthSource ?? (async () => 'stored'),
    ),
  })
}

/**
 * gold `ype` @196067729 — extra bind refuse reason for home launch.
 * No windows-profile compositor: `{}`.
 */
export function launchedFromHomeRefuseExtra(
  reason: string,
  _folder?: string,
): Record<string, string> {
  if (reason !== 'launched_from_home') return {}
  return {}
}

/** gold `fFn` @185893376 */
export const CLOUD_RESTRICTED_SESSION_ERROR =
  'Cloud sessions cannot be created from a --restricted session: they would not enforce it.'

/**
 * gold `jGt` @185893074 — create-session API error class.
 */
export function classifyCloudCreateApiError(
  e: unknown,
):
  | 'authentication_error'
  | 'invalid_request_error'
  | 'permission_error'
  | 'api_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'billing_error'
  | 'overloaded_error'
  | 'request_too_large'
  | 'other'
  | undefined {
  if (typeof e !== 'string' || e === '') return
  switch (e) {
    case 'authentication_error':
    case 'invalid_request_error':
    case 'permission_error':
    case 'api_error':
    case 'not_found_error':
    case 'rate_limit_error':
    case 'billing_error':
    case 'overloaded_error':
    case 'request_too_large':
      return e
    default:
      return 'other'
  }
}

/**
 * gold `HGt` @185892587 — `tengu_ccr_session_link` after create.
 */
export function noteCcrSessionLink(opts: {
  sessionId: string
  source: string
  endpoint: string
  grouped?: boolean
  effortLevel?: string
}): void {
  logEvent('tengu_ccr_session_link', {
    ccr_session_id:
      opts.sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      opts.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    create_endpoint:
      opts.endpoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    grouped: Boolean(opts.grouped) as never,
    ...(opts.effortLevel !== undefined && {
      create_effort_level:
        opts.effortLevel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}

/**
 * gold `x2o` @185902119 — flatten prompt to text.
 */
export function flattenCloudPromptText(
  e:
    | string
    | ReadonlyArray<{ type?: string; text?: unknown }>
    | null
    | undefined,
): string {
  if (typeof e === 'string') return e
  if (!e) return ''
  return e
    .filter(n => n.type === 'text' && typeof n.text === 'string')
    .map(n => n.text as string)
    .join(' ')
}

/**
 * gold `Dae` @185902771 — skip device bind (`tengu_device_bind_skipped`).
 */
export function skipDeviceBind(reason: string): {
  skipped: true
  reason: string
} {
  logEvent('tengu_device_bind_skipped', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { skipped: true, reason }
}

/**
 * gold `eSn` @200263182 — `[remote-tools] ${e}: ${o}` logger.
 */
export function remoteToolsLog(scope: string): (e: string, o: string) => void {
  return (e, o) => {
    logForDebugging(`[remote-tools] ${e}: ${o}`)
    void scope
  }
}

/**
 * gold `fVt` @200265467 — can_use_tool bag with suppress/default_to_no.
 */
export function servedCanUseToolAsk(e: {
  subtype: string
  tool_name: string
  input: unknown
  tool_use_id: string
  mcp_server?: string
  title?: string
  display_name?: string
  description?: string
  agent_id?: string
}): Record<string, unknown> {
  return {
    subtype: e.subtype,
    tool_name: e.tool_name,
    input: e.input,
    tool_use_id: e.tool_use_id,
    ...(e.mcp_server !== undefined && { mcp_server: e.mcp_server }),
    ...(e.title !== undefined && { title: e.title }),
    ...(e.display_name !== undefined && { display_name: e.display_name }),
    ...(e.description !== undefined && { description: e.description }),
    ...(e.agent_id !== undefined && { agent_id: e.agent_id }),
    suppress_always_allow_rule: true,
    default_to_no: true,
    requires_user_interaction: true,
  }
}

/** gold Di keys `p7r` @200266307 */
export const REPOSITORY_TRUST_STATE_COPY_KEYS = {
  trusted: 'repository_trust.state.trusted',
  no_repository: 'repository_trust.state.no_repository',
  declined: 'repository_trust.state.declined',
  not_marked: 'repository_trust.state.not_marked',
} as const

/**
 * gold `p7r` @200266307 — `Di[\`repository_trust.state.${e}\`]`.
 * Locale table is packed in gold; wrap returns the gold key.
 */
export function repositoryTrustStateCopyKey(e: RepositoryTrustState): string {
  return REPOSITORY_TRUST_STATE_COPY_KEYS[e]
}

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
const HEADLESS_CLOUD_ZWJ_RE = /[\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu
/** gold `W` @191133048 */
const HEADLESS_CLOUD_CONTROL_RE =
  /(?:(?![\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029])+/gu
/** gold `wo` path scrub @202403574 */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: gold wo @202403574
const HEADLESS_CLOUD_PATH_SCRUB_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\s]+/gu
const HEADLESS_CLOUD_LS_TREE_RE =
  /(?:^|\0)100(?:644|755) blob [0-9a-f]{40,64} +(\d+)\t/g
/** gold `vae` / `uCe` @181393255 — mutually exclusive notice keys */
export const SERVED_TOOLS_MUTED_NOTICE_KEY = 'served-tools-muted'
export const SERVED_TOOLS_UNMUTED_NOTICE_KEY = 'served-tools-unmuted'
/** gold `_` @191134376 */
export const CLOUD_SESSION_DISCONNECTED_PREFIX = 'Cloud session disconnected'
const DIR_SYNC_ENGINE_REASONS = [
  'not_seeded',
  'not_opted_in',
  'lookup_failed',
  'seeded_elsewhere',
  'engine_declined',
  'engine_unavailable',
  'created_empty_unfilled',
] as const

function headlessCloudTruncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/**
 * gold `Le` @202419370 — `[headlessCloud] ${e}` plus TTY stderr write.
 */
export function logHeadlessCloudLine(e: string): void {
  logForDebugging(`[headlessCloud] ${e}`)
  if (process.stderr.isTTY) {
    process.stderr.write(`${e}\n`)
  }
}

/** gold `Hoe` @195753406 */
function Hoe(text: string): string {
  if (text.length <= HEADLESS_CLOUD_NOTICE_TEXT_CAP) return text
  return `${headlessCloudTruncate(text, HEADLESS_CLOUD_NOTICE_TEXT_CAP - 1)}…`
}

/** gold `Sh` @191133200 */
function Sh(value: unknown, max = HEADLESS_CLOUD_SCRUB_CAP): string {
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
function Fbe(value: unknown): string {
  return Sh(value, HEADLESS_CLOUD_EXIT_MESSAGE_CAP)
}

/** gold `Be` @202307676 — notice text trim at sentence/word. */
function Be(text: string): string {
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

export type CloudDisconnectCode =
  | 'stream_closed'
  | 'untrusted_device'
  | 'session_stale_relogin'
  | 'attach_rejected'
  | 'invalid_session_id'
  | 'request_rejected'
  | 'malformed_response'

/** gold `Okn` @191134411 */
export function cloudDisconnectCode(
  code: CloudDisconnectCode | undefined,
): 'stream_closed' | 'untrusted_device' | 'session_stale_relogin' {
  switch (code) {
    case 'untrusted_device':
    case 'session_stale_relogin':
      return code
    default:
      return 'stream_closed'
  }
}

/** gold `Dkn` @191134605 */
export function cloudDisconnectCopy(
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
 * `Cloud session ${e} no longer uses this computer${s}; stopping.`
 */
export function cloudSessionNoLongerUsesThisComputer(
  sessionId: string,
  detail?: string,
): string {
  const s =
    detail === undefined || detail === ''
      ? ''
      : ` (${Sh(headlessCloudTruncate(detail, 64))})`
  return `Cloud session ${sessionId} no longer uses this computer${s}; stopping.`
}

export type HeadlessCloudDialogArm =
  | 'declare_dialog_kinds'
  | 'rearm_parked_prompt'

/**
 * gold `mo` @202401343 — create without initialPrompt + kinds → declare_dialog_kinds;
 * attach with workerAwaitsAnswer → rearm_parked_prompt.
 */
export function headlessCloudDialogArm(
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
export function isRetryableHeadlessHttp(event: {
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

export type HeadlessCloudExitReason =
  | 'stdin_eof'
  | 'end_session'
  | 'tool_host_ended'
  | 'disconnected'
  | 'rejected_options'
  | 'open_failed'
  | 'output_failed'

export type HeadlessCloudExit = {
  exitCode: number
  reason: HeadlessCloudExitReason
  message?: string
  disconnectCode?: ReturnType<typeof cloudDisconnectCode>
}

/**
 * gold `_o` @202401624 — stdin_eof / end_session exit 0; disconnect 1.
 */
export function headlessCloudExit(
  reason: HeadlessCloudExitReason,
  message?: string,
  disconnectCode?: CloudDisconnectCode,
): HeadlessCloudExit {
  const r =
    disconnectCode === undefined
      ? cloudDisconnectCode(undefined)
      : cloudDisconnectCode(disconnectCode)
  switch (reason) {
    case 'stdin_eof':
    case 'end_session':
      return message === undefined
        ? { exitCode: 0, reason }
        : { exitCode: 0, reason, message }
    case 'tool_host_ended':
      return { exitCode: 0, reason, message: Fbe(message ?? reason) }
    case 'disconnected':
      return {
        exitCode: 1,
        reason,
        disconnectCode: r,
        message: Sh(message ?? cloudDisconnectCopy(r)),
      }
    case 'rejected_options':
    case 'open_failed':
      return { exitCode: 1, reason, message: Fbe(message ?? reason) }
    case 'output_failed':
      return { exitCode: 1, reason, message: Sh(message ?? reason) }
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
export function groupNotApplied(entries: readonly HeadlessCloudNotApplied[]): {
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
export function parseDirSyncEngineReason(
  reason: string | undefined,
): string | undefined {
  if (reason === undefined) return
  return DIR_SYNC_ENGINE_REASONS.find(known => known === reason) ?? 'engine'
}

export type HeadlessCloudNoticeRow = { key: string; text: string }

/**
 * gold `nn` @202402594 — notice map, cap 8, muted/unmuted exclusive.
 */
export function createHeadlessCloudNoticeMap(): {
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
      const h = Be(text)
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
export function scrubHeadlessPathError(err: unknown): string {
  const n = errorMessage(err).replace(HEADLESS_CLOUD_PATH_SCRUB_RE, ' ').trim()
  return Hoe(n)
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
          lastError: scrubHeadlessPathError(opts.lastError),
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
 * gold `_T` @181178659 — unique timeout Error eo instanceof-checks.
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

/**
 * gold `pt` @202374487 — unique empty Error subclass.
 */
export class HeadlessCloudForwardCancelledError extends Error {}

/** leftover `eo` @202373966 unique `po` copy — keep timeout `headlessCloudForwardError`. */
export const CLOUD_CLIENT_IS_CLOSING = 'the cloud client is closing'

/**
 * gold `eo` @202373966
 * `the cloud session did not answer ${e.subtype} in time; it may still apply it`
 */
export function headlessCloudForwardError(err: unknown): string {
  if (err instanceof HeadlessCloudControlTimeoutError) {
    return `the cloud session did not answer ${err.subtype} in time; it may still apply it`
  }
  const n = errorMessage(err)
  if (n.startsWith('[RemoteSessionManager]')) {
    logForDebugging(`[headlessCloudClient] forward failed: ${n}`)
    return 'the cloud session is not connected'
  }
  return Sh(n)
}

export {
  FORWARDED_HOOK_INTERNAL_ERROR_RETRY,
  HEADLESS_CLOUD_FRAME_KEEP,
  HEADLESS_SERVICE_EVENT_NAMES,
  completeHostAllowWithShownInput,
  createForwardedHookWait,
  isFailedForwardedHookCall,
  isHeadlessServiceEvent,
  isReplayedForwardedHookCall,
  isShownHostInput,
  lookupHeadlessCloudFrameKeep,
  shownInputForTool,
  unrefTimeout,
} from './leftoverHookWait.js'

export {
  ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN,
  CCR_DIR_SYNC_MODE_PROMPT,
  CLOUD_ATTACH_SYNC_CONSENT_COPY,
  CLOUD_PRINT_NEEDS_TASK,
  CLOUD_SESSION_FAILED_TO_START,
  CLOUD_SYNC_CONSENT_COPY,
  CLOUD_TRANSCRIPT_JSONL,
  CLOUD_WORKER_TIMEOUT_NO_ANSWER,
  CONSENT_ATTACH_SYNC_BODY,
  CONSENT_ATTACH_SYNC_BODY_KEY,
  CONSENT_ATTACH_SYNC_DETAIL,
  CONSENT_ATTACH_SYNC_DETAIL_KEY,
  CONSENT_ATTACH_SYNC_TITLE,
  CONSENT_SYNC_BODY,
  CONSENT_SYNC_DETAIL,
  CONSENT_SYNC_TITLE,
  DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST,
  EDE_DIAGNOSTIC_PREFIX,
  emptyTranscriptPath,
  FAILED_HOST_ERROR,
  HEADLESS_CLOUD_SYNC_QUESTION_ABANDONED,
  logSyncQuestionAbandoned,
  savedHooksAnswerIgnoredUnlocated,
  savedHooksAnswerIgnoredWritable,
  SESSION_STREAM_NOT_CONNECTED,
  TENGU_DEVICE_HOOK_SERVED,
  TENGU_DEVICE_HOOKS_CLIENT_REGISTER,
  TENGU_DEVICE_HOOKS_CONSENT_NOTICE,
  TENGU_DEVICE_HOOKS_LAPSE_LINE,
  TENGU_DEVICE_HOOKS_REACH_PINNED,
  TENGU_DEVICE_HOOKS_SOURCE_PINNED,
  UNTRUSTED_DEVICE,
  attachDirSyncElsewhereUnknownReason,
  classifyAttachDirSyncElsewhereUnknown,
  isFailedHostError,
  logCcrDirSyncModePrompt,
  logDeviceHookServed,
  logDroppedControlRequestWithoutIdOrRequest,
  POLICY_INVALID_REASON,
  stripEdeDiagnosticErrors,
} from './leftoverCloudCopy.js'

export {
  CLOUD_SESSION_LOST_RECONNECTING,
  classifyRemoteControlRefusal,
  cloudSessionDidNotAcceptOptionalCopy,
  cloudSessionDidNotAcceptRequiredCopy,
  cloudSessionDidNotApplyCreatePermissionModeCopy,
  cloudSessionWaitingUndeclaredDialogCopy,
  headlessAgentReusesFinishedRequestIdCopy,
  headlessConsumedOwnEchoCopy,
  headlessDroppedUnknownFrameCopy,
  headlessHostCouldNotAnswerCopy,
  headlessNotPassingOwnQuestionDialogCopy,
  headlessNotPassingUndeclaredDialogCopy,
  logDeviceBindAttachBindingCheckFailed,
  logDeviceBindAttachRegistrationStartFailed,
  logHeadlessAgentReusesFinishedRequestId,
  logHeadlessAttachPreflightFailed,
  logHeadlessBuiltInToolNamesUnread,
  logHeadlessClientInitializeNotAnswered,
  logHeadlessConsumedOwnEcho,
  logHeadlessCouldNotAnnounceSweptCommand,
  logHeadlessCreatePermissionModeNotApplied,
  logHeadlessDiscardedSessionNotReleased,
  logHeadlessDroppedFrameAfterStdoutClosed,
  logHeadlessDroppedUnknownControlResponse,
  logHeadlessDroppedUnknownFrame,
  logHeadlessHostCouldNotAnswer,
  logHeadlessIgnoringFrameWhileClosing,
  logHeadlessIgnoringHostFrame,
  logHeadlessInterruptNotDispatched,
  logHeadlessNotPassingOwnQuestionDialog,
  logHeadlessNotPassingUndeclaredDialog,
  logHeadlessOpeningRequestFailed,
  logHeadlessRereadingServeOnlyLinkThrew,
  logHeadlessSettlingOpenerWorkFailed,
  logHeadlessStreamError,
  logHeadlessTransportCloseFailed,
  logHeadlessWorkerTookClientInitialize,
  logRemoteHeadlessClientWorkerInitialize,
  logRemoteCreatePermissionModeDefaultNotTaken,
  logRemoteCreatePermissionModeNotTaken,
  logRemoteCreatePermissionModeTaken,
  remoteCreatePermissionModeDefaultNotTakenCopy,
  remoteCreatePermissionModeNotTakenCopy,
  remoteCreatePermissionModeTakenCopy,
} from './leftoverHeadlessCopy.js'

export {
  applyHeadlessOpeningRequests,
  attachHeadlessCloudSession,
  attachStreamStandsFailedCopy,
  filterSupportedDialogKindsForInitialize,
  headlessWorkerInitializeReason,
  initializeHeadlessCloudWorker,
  isRetryableWorkerInitializePost,
  noteHeadlessUndeclaredDialog,
} from './leftoverHeadlessAttach.js'

export {
  attachHeadlessCloudClientSession,
  closeFromSignal,
  closeTransport,
  createHeadlessCloudClient,
  drainOutbound,
  emitHeadlessFrame,
  endHeadlessCloudClient,
  formatHeadlessWorkerInitLine,
  headlessControlErrorFrame,
  headlessInformationalFrame,
  logEnded,
  logWorkerInit,
  markWorkerReady,
  openSession,
  refuseWhileClosing,
  settleOpener,
  tearDown,
} from './leftoverHeadlessClient.js'

export {
  BRIDGE_ATTESTATION_MALFORMED_CONFIG_PREFIX,
  DEFAULT_TOOL_HOST_ATTESTATION_POLICY,
  DEVICE_ATTESTATION_STATUSES,
  SERVED_CALLS_UNATTESTED_COPY,
  SERVED_CALLS_UNATTESTED_NOTICE_KEY,
  TOOL_HOST_ATTESTATION_TULIP_THREW,
  assessToolHostAttestation,
  attestToolHostStatus,
  gradeToolHostAttestation,
  isToolHostAttestationHeldBack,
  leftoverHookAttestationBag,
  meetsAttestationLevel,
  normalizeDeviceAttestationStatus,
  notifyServedCallsUnattested,
  parseBridgeAttestationEnforceConfig,
  readToolHostAttestationPolicy,
  isPolicyEnforcedOrHintedByRefusedCache,
  leftoverPolicyLimitsHost,
  dropLeftoverPolicyHints,
  hintFromRefusedPolicyBody,
  isEnforceOrRequirePolicyKey,
  isKnownPolicyLimitsKey,
  isPolicyLimitsAllowed,
  leftoverAnonymousHipaaStampBody,
  leftoverBuildHipaaStamp,
  leftoverHashPrincipalDescriptor,
  leftoverHipaaEvidence,
  leftoverHipaaEvidenceBlocks,
  leftoverPersistHipaaStamp,
  leftoverPolicyLimitsPrincipal,
  leftoverRemoveHipaaStamp,
  isServerPopulatedPolicyKey,
  isTranscriptScanPolicyKey,
  lookupPolicyLimitsEntry,
  POLICY_LIMITS_CATALOG,
  policyDeniedByTaints,
  policyDeniedUnderPairs,
  policyHardBlockUnderPairs,
  policyLimitsFeatureCopy,
  evaluatePolicyLimitsAgainst,
  REQUIRE_TRUSTED_DEVICES,
  unspecifiedToolHostAttestationBag,
} from './leftoverTulip.js'

export {
  LeftoverSseFrameBuffer,
  REMOTE_CONTROL_CLOSED,
  cloudSessionEventsStreamUrl,
  createCloudSessionEventsClient,
  createCloudSessionStreamController,
  createHeadlessRemoteManager,
  emptyHeadlessManager,
  handleCloudSessionFrame,
  isSendGateWithhold,
  leftoverDeliverCloudSessionFrame,
  leftoverParseSseBlock,
  leftoverSseFindFrameDelim,
  leftoverSseNewlineWidth,
  postCloudSessionEvents,
  readCloudSessionEventsStream,
  runSendGate,
  wrapRemoteSessionManager,
  wrapSendGateWithheld,
} from './leftoverHeadlessManager.js'
