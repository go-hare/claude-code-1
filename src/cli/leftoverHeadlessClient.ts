/**
 * densable 2.1.283 leftover `tn` remaining compositor BODY.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `tn.drainOutbound` @202380196 · `tn.emit` @202380366
 *   leftover `tn.closeFromSignal` @202377840 · `tn.closeTransport` @202397544
 *   leftover `tn.tearDown` @202398197 · `tn.end` @202400327
 *   leftover `tn.settleOpener` @202378138 · `tn.openSession` @202384459
 *   leftover `tn.refuseWhileClosing` @202381897 · `tn.logEnded` @202398752
 *   leftover `tn.logWorkerInit` @202395409 · `tn.markWorkerReady` @202396589
 *   leftover `tn.attach` @202385551 BODY 8835 B next `goLive`
 *
 * CALL leftoverHeadlessCopy logs 1:1. Default attach instantiates existing
 * HeadlessCloudFrames / HeadlessCloudLiveness / HeadlessCloudFeatureHandles
 * (gold `st`/`ot`/`Ce` hosts). Default `gPe` wraps existing
 * RemoteSessionManager via leftoverHeadlessManager (orgUuid+token; else stub).
 * NEVER `export class tn` / `export class gPe`. Keep SDK `{done}` host
 * (`HeadlessCloudSdkHost` / `startHeadlessCloudSession`) on cloudSession.
 * No CLAUDE_CODE_NO_DEVICE_PROOF / FOCUS_IN / settings.set / tengu_violin_amati.
 *
 * ALREADY LANDED (do not replace): leftoverHeadlessWorker
 * initializeHeadlessCloudWorker + applyHeadlessOpeningRequests;
 * leftoverHeadlessAttach attachHeadlessCloudSession.
 */
import { randomUUID } from 'crypto'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import { truncateCodeUnitsSafe } from 'src/utils/stringUtils.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { setSdkOauthTokenRefreshCallback } from 'src/utils/sdkOauthTokenRefresh.js'
import {
  CLOUD_CLIENT_IS_CLOSING,
  type CloudDisconnectCode,
  type HeadlessCloudExit,
  type HeadlessCloudExitReason,
  headlessCloudExitFromReason,
} from './cloudRefuse.js'
import { CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED } from './leftoverCloudCopy.js'
import {
  CLOUD_SESSION_LOST_RECONNECTING,
  logHeadlessAttachPreflightFailed,
  logHeadlessBuiltInToolNamesUnread,
  logHeadlessDiscardedSessionNotReleased,
  logHeadlessDroppedFrameAfterStdoutClosed,
  logHeadlessIgnoringFrameWhileClosing,
  logHeadlessNotPassingOwnQuestionDialog,
  logHeadlessNotPassingUndeclaredDialog,
  logHeadlessRereadingServeOnlyLinkThrew,
  logHeadlessSettlingOpenerWorkFailed,
  logHeadlessStreamError,
  logHeadlessTransportCloseFailed,
  cloudSessionWaitingUndeclaredDialogCopy,
} from './leftoverHeadlessCopy.js'
import {
  applyHeadlessOpeningRequests,
  initializeHeadlessCloudWorker,
  type HeadlessOpeningRequest,
  type HeadlessWorkerClock,
  type HeadlessWorkerInitializeReason,
  type HeadlessWorkerManager,
} from './leftoverHeadlessWorker.js'
import { createHeadlessRemoteManager } from './leftoverHeadlessManager.js'
import {
  HeadlessCloudFeatureHandles,
  HeadlessCloudFrames,
  HeadlessCloudLiveness,
} from './cloudSession.js'
import {
  CLOUD_MESSAGE_NOT_DELIVERED,
  groupNotApplied,
  isHeadlessHostDialogKind,
  pushCreatePermissionMode,
} from './leftoverUnique.js'

/** gold `ho` next to leftover `tn` */
const defaultClock: HeadlessWorkerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

/** gold `Yt` / `ao` / `Zt` / `Jt` / `uo` / `lo` / `co` / `ro` */
const TRANSPORT_STOP_MS = 1000
const FEATURES_DISPOSE_MS = 500
const END_INFLIGHT_MS = 5000
const SIGNAL_SETTLE_MS = 850
const SIGNAL_OPENER_MS = SIGNAL_SETTLE_MS - 100
const END_OPENER_MS = END_INFLIGHT_MS - 250
const FLUSH_SENDS_MS = 1000
const RECONNECT_NOTICE_MS = 5000

/** gold `Ee` leftover Qs-adj @202362116 — tearDown/end close why. */
const CLOSED_WHY = CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED

/** gold `BT` @178307431 — leftover `Beo` skill bucket. */
const SKILL_TOOL_PREFIX = 'skill__'
/** gold `g` @191133400 — leftover `Beo` built-in name cap. */
const WORKER_INIT_BUILTIN_SHOW = 400
const WORKER_INIT_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/
const WORKER_INIT_BUCKETS = [
  'mcp_tool',
  'skill_tool',
  'dynamic_tool',
  'other_tool',
] as const

export type HeadlessClientPhase =
  | 'pre_session'
  | 'awaiting_worker'
  | 'live'
  | 'ending'
  | 'ended'

export type HeadlessClientFrame = {
  type: string
  [key: string]: unknown
}

export type HeadlessClientIo = {
  outbound: {
    enqueue: (frame: HeadlessClientFrame) => void
    done: () => void
    [Symbol.asyncIterator]?: () => AsyncIterator<HeadlessClientFrame>
  }
  write?: (frame: HeadlessClientFrame) => Promise<void>
}

export type HeadlessClientOutbound = {
  stats: {
    sends: number
    forwards: number
    maxQueued: number
  }
  queuedCount: number
  queuedSendUuids?: () => string[]
  close: (why: string, reason: string) => void
  answerForwardsInFlight: (why: string) => void
  abandonPostsInFlight: (why: string) => void
  settleOwedEchoes: () => void
  holdLaterSendsBehind: (work: Promise<unknown>) => void
  sendBehindGates?: (
    send: () => Promise<unknown>,
    opts?: { messageUuid?: string },
  ) => Promise<unknown>
  noteOwnUuid?: (uuid: string, content: unknown) => void
  synthesizeMissedEchoes?: () => number
  flush?: () => Promise<void>
}

export type HeadlessClientManager = HeadlessWorkerManager & {
  connect?: () => void
  disconnect: () => void
  reconnect?: () => void
  releaseHeldSends: (
    timeoutMs?: number,
    opts?: { exiting?: boolean; final?: boolean; keepWithheld?: boolean },
  ) => Promise<unknown>
  flushSends: (timeoutMs: number) => Promise<unknown>
  sendControlRequest?: (request: { subtype: string }) => Promise<unknown>
  addSendGate?: (
    gate: (item: unknown) => Promise<unknown>,
    opts?: { onRelease?: string; onExit?: string },
  ) => (() => void) | undefined
  sendBehindGates?: (
    send: () => Promise<unknown>,
    opts?: { messageUuid?: string; submittedAtMs?: number },
  ) => Promise<unknown>
  heldSendCount?: () => number
  chainedSendCount?: () => number
}

export type HeadlessClientHostRequests = {
  issuePendingInterrupt: (manager: HeadlessClientManager) => Promise<unknown>
  interruptIssued: Promise<unknown>
  sendPendingInterrupt?: (manager: HeadlessClientManager) => Promise<unknown>
}

export type HeadlessClientAgentRequests = {
  settledCount: number
  cancelAll: () => void
  cancel?: (id: unknown) => void
  reinstate?: (id: unknown) => void
  passPermissionRequest?: (
    manager: HeadlessClientManager,
    request: unknown,
    id: unknown,
  ) => void
  passUserDialogRequest?: (
    manager: HeadlessClientManager,
    request: unknown,
    id: unknown,
  ) => void
}

export type HeadlessClientFrames = {
  turns: number
  maxHeld: number
  stampedSessionId?: string
  counts: {
    sessionIdChanges: number
    peerContentOmitted: number
    peerToolUseOmitted: boolean
    cloudSessionKeysDropped: number
    serviceEventsDropped: number
    unknownFramesDropped: number
    peerFramesDroppedBeforeInit: number
  }
  close: () => void
  offerSummary?: () => void
  noteCloudSessionChanged?: () => void
  releaseHeld?: () => void
}

export type HeadlessClientLiveness = {
  stats?: {
    watchdog_fires: number
    title: string
    lines_written: number
    lines_suppressed: number
  }
  halt: () => void
  stop: () => Promise<unknown>
  noteWorkerReady?: () => void
  noteProvisioning?: (a: unknown, b: unknown) => void
  attachStatusFeeds?: (feeds: unknown[], onChange: () => void) => void
  armStallWarning?: () => void
}

export type HeadlessClientFeatures = {
  adopt: (handles: unknown[]) => void
  dispose: () => Promise<unknown>
  noteWorkerInit?: (init: unknown) => void
  noteWorkerUp?: (up: unknown) => void
  noteWorkerLive?: () => void
  noteTurnInFlight?: () => void
  noteTurnEnded?: () => void
  noteSessionCleared?: (id: unknown) => void
  noteStreamConnected?: () => void
  noteSession?: (opts: {
    sessionId: string
    manager: HeadlessClientManager
  }) => void
  onEachSettled?: (cb: () => void) => void
  onEachReportChanged?: (cb: () => void) => void
  callbacks?: (ports: Record<string, unknown>) => unknown
  homeSeed?: () => unknown
  sendWait?: () => (() => Promise<unknown>) | null
  reports?: () => Record<
    string,
    { state?: string; pending?: boolean } | undefined
  >
  handles?: () => unknown[]
  statusFeeds?: () => unknown[]
}

export type HeadlessOpenedSession = {
  entry: 'create' | 'attach'
  sessionId: string
  initialPrompt?: { uuid: string; content?: unknown }
  initialSequenceNum?: number
  openingRequests?: HeadlessOpeningRequest[]
  preflightCheck?: Promise<unknown>
  controlOnly?: boolean
  hasTitle?: boolean
  notices?: Array<{ level: string; text: string }>
  featureHandles?: unknown[]
  dirSync?: {
    sync?: {
      seedGate?: (item: unknown) => Promise<unknown>
      state?: () => { state: string }
    }
    status?: unknown
  }
  getAccessToken?: () => Promise<string>
  onAuth401?: () => void
  orgUuid?: string
  eventSigner?: unknown
  workerAwaitsAnswer?: boolean
  requestedPermissionMode?: string
  onWorkerSessionId?: (id: string) => void
  onCloudSessionChanged?: (cb: () => void) => void
  stillLinkedHere?: () => Promise<boolean>
  cloudSession: () => {
    device: { status: string }
    directory_sync?: { state?: string; reason?: string }
    notices?: unknown[]
    serving?: { state?: string; reason?: string }
    not_applied?: unknown[]
  }
  createManager?: (opts: unknown, callbacks: unknown) => HeadlessClientManager
  settle?: (
    why: unknown,
  ) => Promise<{ level: string; text: string } | undefined>
  dispose?: () => Promise<unknown>
}

export type HeadlessClientConfig = {
  includePartialMessages?: boolean
  ignoredOptions?: unknown[]
  replayUserMessages?: boolean
  initializePolicy?: string
  builtInToolNames?: () => string[]
  openSession?: (
    opts: unknown,
  ) => Promise<
    | { kind: 'opened'; session: HeadlessOpenedSession }
    | { kind: 'failed'; message: string }
  >
}

/**
 * leftover `H6` @179000538 — control_response error. CALL leftoverUnique
 * `CLOUD_CLIENT_IS_CLOSING` (`po`).
 */
export function headlessControlErrorFrame(
  requestId: string,
  error: string,
  errorCode?: string,
): HeadlessClientFrame {
  return {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: requestId,
      error,
      ...(errorCode !== undefined && { error_code: errorCode }),
    },
  }
}

/** leftover `pq` @191132925 — system informational. */
export function headlessInformationalFrame(
  sessionId: string,
  level: string,
  content: string,
): HeadlessClientFrame {
  return {
    type: 'system',
    subtype: 'informational',
    level,
    content,
    uuid: randomUUID(),
    session_id: sessionId,
  }
}

function analyticsText(
  value: unknown,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return String(
    value,
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function clipRe(value: unknown, max: number): string {
  return truncateCodeUnitsSafe(String(value), max)
}

/**
 * leftover `ie(clock, work, timeoutMs)` race used by closeTransport/tearDown/end.
 */
export function raceHeadlessClockWork<T>(
  clock: HeadlessWorkerClock,
  work: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false
    const cancel = clock.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(undefined)
    }, timeoutMs)
    work.then(
      value => {
        if (settled) return
        settled = true
        cancel()
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        cancel()
        resolve(undefined)
      },
    )
  })
}

function bucketWorkerInitTool(name: string): string {
  if (name.startsWith('mcp__')) return 'mcp_tool'
  if (name.startsWith(SKILL_TOOL_PREFIX)) return 'skill_tool'
  return name.includes('__') ? 'dynamic_tool' : 'other_tool'
}

/**
 * leftover `Beo` @191133654 — CALL from leftover `tn.logWorkerInit`.
 */
export function formatHeadlessWorkerInitLine(
  init: {
    claude_code_version?: unknown
    startup_timing?: { warm_spare_claimed?: unknown }
    tools?: unknown
  },
  builtInNames: Set<string>,
): string {
  const version =
    typeof init.claude_code_version === 'string' &&
    WORKER_INIT_VERSION_RE.test(init.claude_code_version)
      ? init.claude_code_version
      : 'unknown'
  const claimed = init.startup_timing?.warm_spare_claimed
  const warm = typeof claimed === 'boolean' ? String(claimed) : 'unknown'
  const prefix = `[headlessCloudClient] worker init: claude_code_version=${version} warm_spare=${warm}`
  if (!Array.isArray(init.tools)) return `${prefix} tools=unknown`
  const names = init.tools.filter((c): c is string => typeof c === 'string')
  const known = names.filter(c => builtInNames.has(c))
  const unknown = names
    .filter(c => !builtInNames.has(c))
    .map(bucketWorkerInitTool)
  const buckets = WORKER_INIT_BUCKETS.flatMap(c => {
    const n = unknown.filter(k => k === c).length
    return n > 0 ? [`${c} x${n}`] : []
  })
  const shown = [...known.slice(0, WORKER_INIT_BUILTIN_SHOW), ...buckets].join(
    ',',
  )
  const extra =
    known.length > WORKER_INIT_BUILTIN_SHOW
      ? ` (+${known.length - WORKER_INIT_BUILTIN_SHOW} more not shown)`
      : ''
  return `${prefix} tools(${names.length})=${shown}${extra}`
}

function logRemoteHeadlessClientFeature(
  kind: 'ok' | 'sad' | 'bad',
  errorCode?: string,
): void {
  const name =
    kind === 'ok'
      ? 'tengu_feature_ok'
      : kind === 'sad'
        ? 'tengu_feature_sad'
        : 'tengu_feature_bad'
  logEvent(name, {
    feature_name:
      'remote_headless_client' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(errorCode !== undefined && {
      error_code:
        errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}

export type HeadlessCloudClient = {
  phase: HeadlessClientPhase
  clock: HeadlessWorkerClock
  io: HeadlessClientIo
  outbound: HeadlessClientOutbound
  agentRequests: HeadlessClientAgentRequests
  hostRequests: HeadlessClientHostRequests
  outputOpen: boolean
  oauthBridgeInstalled: boolean
  endLogged: boolean
  containerStartFailed: boolean
  inputFailed: boolean
  signalled: boolean
  closing: boolean
  connectEpoch: number
  startedAt: number
  inputClosedAt: number | null
  hostDialogKinds: Set<string>
  dialogsNotDeclaredCount: number
  dialogsReservedCount: number
  frames: HeadlessClientFrames | null
  liveness: HeadlessClientLiveness | null
  features: HeadlessClientFeatures | null
  session: {
    manager: HeadlessClientManager
    opened: HeadlessOpenedSession
  } | null
  opened: HeadlessOpenedSession | null
  transportClosed: Promise<void> | null
  inflight: Set<Promise<unknown>>
  drained: Promise<void>
  done: Promise<HeadlessCloudExit>
  workerInitializeReason: HeadlessWorkerInitializeReason | null
  config: HeadlessClientConfig
  cancelIdleDeadline: (() => void) | null
  cancelReconnectNotice: (() => void) | null
  featureAbort: AbortController
  everConnected: boolean
  reconnectingTold: boolean
  connection: 'connecting' | 'live' | 'reconnecting' | 'closed'
  hostSentPermissionMode: boolean
  lastWorkerMode: string | undefined
  workerModesSeen: Set<string>
  endingWith: { exitCode: number; disconnectCode?: string } | null
  builtInNames: Set<string> | null
  stampedSessionId: string
  undeliveredKindsTold: Set<string>
  resolveDone: (exit: HeadlessCloudExit) => void
  unregisterCleanup: () => void
  goLive: (manager: HeadlessClientManager) => void
  armIdleDeadline: () => void
  submitUserMessage: (frame: HeadlessClientFrame) => void
  submitBashCommand: (frame: HeadlessClientFrame) => void
  releasePreSessionEchoes: (frames: HeadlessClientFrames | null) => void
  readCloudSession: () =>
    | ReturnType<HeadlessOpenedSession['cloudSession']>
    | undefined
  guarded: (fn: () => void) => void
  recheckServeOnlyLink: (opened: HeadlessOpenedSession) => void
}

export type HeadlessCloudClientSeams = {
  clock?: HeadlessWorkerClock
  io?: HeadlessClientIo
  outbound?: HeadlessClientOutbound
  agentRequests?: HeadlessClientAgentRequests
  hostRequests?: HeadlessClientHostRequests
  frames?: HeadlessClientFrames
  liveness?: HeadlessClientLiveness
  features?: HeadlessClientFeatures
  hostDialogKinds?: Iterable<string>
  stampedSessionId?: string
  goLive?: (manager: HeadlessClientManager) => void
  armIdleDeadline?: () => void
  submitUserMessage?: (frame: HeadlessClientFrame) => void
  submitBashCommand?: (frame: HeadlessClientFrame) => void
  createFrames?: (
    ports: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => HeadlessClientFrames
  createLiveness?: (
    ports: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => HeadlessClientLiveness
  createFeatures?: () => HeadlessClientFeatures
  createManager?: (opts: unknown, callbacks: unknown) => HeadlessClientManager
  pushCreatePermissionMode?: typeof pushCreatePermissionMode
  setOauthRefresh?: (cb: (() => Promise<string | null>) | null) => void
  isOwnQuestionDialogKind?: (kind: string) => boolean
}

function defaultOutbound(): HeadlessClientOutbound {
  return {
    stats: { sends: 0, forwards: 0, maxQueued: 0 },
    queuedCount: 0,
    queuedSendUuids: () => [],
    close: () => {},
    answerForwardsInFlight: () => {},
    abandonPostsInFlight: () => {},
    settleOwedEchoes: () => {},
    holdLaterSendsBehind: work => void work,
  }
}

/**
 * leftover `tn.attach` holdLaterSendsBehind → leftover `gPe.sendBehindGates`.
 * Registers `heldSends` so releaseHeldSends is not empty-only.
 */
function holdLaterSendsBehindGates(
  manager: HeadlessClientManager,
  work: Promise<unknown>,
): void {
  if (manager.sendBehindGates === undefined) {
    void work
    return
  }
  void manager.sendBehindGates(() => work)
}

function defaultAgentRequests(): HeadlessClientAgentRequests {
  return { settledCount: 0, cancelAll: () => {} }
}

function defaultHostRequests(): HeadlessClientHostRequests {
  return {
    issuePendingInterrupt: async () => {},
    interruptIssued: Promise.resolve(),
    sendPendingInterrupt: async () => {},
  }
}

function defaultIo(): HeadlessClientIo {
  const queue: HeadlessClientFrame[] = []
  return {
    outbound: {
      enqueue: frame => {
        queue.push(frame)
      },
      done: () => {},
      async *[Symbol.asyncIterator]() {
        for (const frame of queue) yield frame
      },
    },
    write: async () => {},
  }
}

export function createHeadlessCloudClient(
  config: HeadlessClientConfig = {},
  seams: HeadlessCloudClientSeams = {},
): HeadlessCloudClient {
  let resolveDone: (exit: HeadlessCloudExit) => void = () => {}
  const done = new Promise<HeadlessCloudExit>(resolve => {
    resolveDone = resolve
  })
  const clock = seams.clock ?? defaultClock
  const client: HeadlessCloudClient = {
    phase: 'pre_session',
    clock,
    io: seams.io ?? defaultIo(),
    outbound: seams.outbound ?? defaultOutbound(),
    agentRequests: seams.agentRequests ?? defaultAgentRequests(),
    hostRequests: seams.hostRequests ?? defaultHostRequests(),
    outputOpen: true,
    oauthBridgeInstalled: false,
    endLogged: false,
    containerStartFailed: false,
    inputFailed: false,
    signalled: false,
    closing: false,
    connectEpoch: 0,
    startedAt: clock.now(),
    inputClosedAt: null,
    hostDialogKinds: new Set(seams.hostDialogKinds ?? []),
    dialogsNotDeclaredCount: 0,
    dialogsReservedCount: 0,
    frames: seams.frames ?? null,
    liveness: seams.liveness ?? null,
    features: seams.features ?? null,
    session: null,
    opened: null,
    transportClosed: null,
    inflight: new Set(),
    drained: Promise.resolve(),
    done,
    workerInitializeReason: null,
    config,
    cancelIdleDeadline: null,
    cancelReconnectNotice: null,
    featureAbort: new AbortController(),
    everConnected: false,
    reconnectingTold: false,
    connection: 'connecting',
    hostSentPermissionMode: false,
    lastWorkerMode: undefined,
    workerModesSeen: new Set(),
    endingWith: null,
    builtInNames: null,
    stampedSessionId: seams.stampedSessionId ?? '',
    undeliveredKindsTold: new Set(),
    resolveDone,
    unregisterCleanup: () => {},
    goLive: manager => {
      seams.goLive?.(manager)
      client.features?.noteWorkerLive?.()
    },
    armIdleDeadline: () => {
      seams.armIdleDeadline?.()
    },
    submitUserMessage: frame => {
      seams.submitUserMessage?.(frame)
    },
    submitBashCommand: frame => {
      seams.submitBashCommand?.(frame)
    },
    releasePreSessionEchoes: () => {},
    readCloudSession: () => client.opened?.cloudSession(),
    guarded: fn => {
      try {
        fn()
      } catch (err) {
        if (isAbortError(err)) {
          logForDebugging(
            '[headlessCloudClient] session frame handling aborted',
          )
        } else {
          logForDebugging(errorMessage(err))
        }
      }
    },
    recheckServeOnlyLink: opened => {
      const still = opened.stillLinkedHere
      if (opened.controlOnly !== true || still === undefined) return
      still().then(
        linked => {
          if (linked === false && !client.closing) {
            void endHeadlessCloudClient(client, 'tool_host_ended')
          }
        },
        err => {
          logHeadlessRereadingServeOnlyLinkThrew(err)
        },
      )
    },
  }
  Object.defineProperty(client, 'closing', {
    get: () => client.phase === 'ending' || client.phase === 'ended',
    enumerable: true,
  })
  return client
}

/**
 * leftover `tn.drainOutbound` @202380196
 * catch write fail → end("output_failed", `failed to write to stdout: ${err}`)
 */
export async function drainOutbound(
  client: HeadlessCloudClient,
): Promise<void> {
  const iter = client.io.outbound[Symbol.asyncIterator]?.()
  if (iter === undefined) return
  for (;;) {
    const next = await iter.next()
    if (next.done) return
    try {
      await (client.io.write ?? (async () => {}))(next.value)
    } catch (err) {
      logForDebugging(errorMessage(err))
      await endHeadlessCloudClient(
        client,
        'output_failed',
        `failed to write to stdout: ${errorMessage(err)}`,
      )
      return
    }
  }
}

/**
 * leftover `tn.emit` @202380366
 * if !outputOpen CALL logHeadlessDroppedFrameAfterStdoutClosed(type); else enqueue
 */
export function emitHeadlessFrame(
  client: HeadlessCloudClient,
  frame: HeadlessClientFrame,
): void {
  if (!client.outputOpen) {
    logHeadlessDroppedFrameAfterStdoutClosed(frame.type)
    return
  }
  client.io.outbound.enqueue(frame)
}

/**
 * leftover `tn.closeFromSignal` @202377840
 */
export async function closeFromSignal(
  client: HeadlessCloudClient,
): Promise<void> {
  client.signalled = true
  logEnded(
    client,
    'signal',
    client.endingWith?.exitCode ?? 0,
    client.phase,
    client.endingWith?.disconnectCode,
  )
  await tearDown(client, CLOSED_WHY, 'closed')
  await raceHeadlessClockWork(
    client.clock,
    settleOpener(client, SIGNAL_OPENER_MS, 'signal'),
    SIGNAL_SETTLE_MS,
  )
  client.outbound.abandonPostsInFlight('closed')
  client.outbound.settleOwedEchoes()
}

/**
 * leftover `tn.closeTransport` @202397544 — interrupt + flushSends + disconnect seams
 */
export function closeTransport(client: HeadlessCloudClient): Promise<void> {
  if (client.transportClosed !== null) return client.transportClosed
  const session = client.session
  if (session === null) {
    client.transportClosed = raceHeadlessClockWork(
      client.clock,
      client.liveness?.stop() ?? Promise.resolve(),
      TRANSPORT_STOP_MS,
    ).then(() => {})
    return client.transportClosed
  }
  client.session = null
  client.transportClosed = (async () => {
    await client.hostRequests
      .issuePendingInterrupt(session.manager)
      .catch(() => {})
    await client.hostRequests.interruptIssued.catch(() => {})
    const stopped = raceHeadlessClockWork(
      client.clock,
      client.liveness?.stop() ?? Promise.resolve(),
      TRANSPORT_STOP_MS,
    )
    await session.manager
      .releaseHeldSends(undefined, { exiting: true, final: true })
      .catch(() => {})
    await session.manager.flushSends(FLUSH_SENDS_MS).catch(() => {})
    session.manager.disconnect()
    await stopped
  })()
  return client.transportClosed
}

/**
 * leftover `tn.tearDown` @202398197
 * CALL logHeadlessTransportCloseFailed on closeTransport catch;
 * oauthBridgeInstalled → Wmt(null) SEAM
 */
export async function tearDown(
  client: HeadlessCloudClient,
  why: string,
  reason: string,
): Promise<void> {
  client.liveness?.halt()
  client.cancelIdleDeadline?.()
  client.cancelIdleDeadline = null
  client.cancelReconnectNotice?.()
  client.cancelReconnectNotice = null
  client.featureAbort.abort()
  client.releasePreSessionEchoes(client.frames)
  client.frames?.close()
  client.outbound.close(why, reason)
  client.outbound.answerForwardsInFlight(why)
  client.agentRequests.cancelAll()
  await raceHeadlessClockWork(
    client.clock,
    client.features?.dispose() ?? Promise.resolve(),
    FEATURES_DISPOSE_MS,
  )
  await closeTransport(client).catch(err => {
    logHeadlessTransportCloseFailed(err)
  })
  if (client.oauthBridgeInstalled) setSdkOauthTokenRefreshCallback(null)
}

/**
 * leftover `tn.end` @202400327 — phase ending/ended; tearDown; logEnded; outputOpen=false
 */
export async function endHeadlessCloudClient(
  client: HeadlessCloudClient,
  reason: HeadlessCloudExitReason | 'signal',
  message?: string,
  disconnectCode?: CloudDisconnectCode | string,
): Promise<void> {
  if (client.phase === 'ending' || client.phase === 'ended') return
  const code =
    reason === 'disconnected'
      ? ((disconnectCode as CloudDisconnectCode | undefined) ?? 'stream_closed')
      : undefined
  const exit =
    reason === 'signal'
      ? { exitCode: 0, reason: 'end_session' as const, message }
      : headlessCloudExitFromReason(
          reason,
          message,
          code as CloudDisconnectCode | undefined,
        )
  const from = client.phase
  client.phase = 'ending'
  client.endingWith = { exitCode: exit.exitCode, disconnectCode: code }
  try {
    await tearDown(
      client,
      reason === 'disconnected' ? 'the cloud session disconnected' : CLOSED_WHY,
      reason === 'disconnected' ? 'disconnected' : 'closed',
    )
    await raceHeadlessClockWork(
      client.clock,
      Promise.allSettled([
        ...client.inflight,
        settleOpener(client, END_OPENER_MS, 'end'),
      ]),
      END_INFLIGHT_MS,
    )
    client.outbound.abandonPostsInFlight('closed')
    client.outbound.settleOwedEchoes()
  } catch (err) {
    if (isAbortError(err)) {
      logForDebugging('[headlessCloudClient] teardown aborted')
    } else {
      logForDebugging(errorMessage(err))
    }
    await closeTransport(client).catch(() => {})
  }
  logEnded(client, reason, exit.exitCode, from, code)
  client.outputOpen = false
  client.io.outbound.done()
  await client.drained
  client.phase = 'ended'
  client.unregisterCleanup()
  client.resolveDone(exit)
}

/**
 * leftover `tn.settleOpener` @202378138
 * CALL logHeadlessSettlingOpenerWorkFailed; tengu_remote_headless_client_seed_cut_short
 */
export function settleOpener(
  client: HeadlessCloudClient,
  budget: number,
  at: string,
): Promise<void> {
  return (client.opened?.settle?.(budget) ?? Promise.resolve(undefined)).then(
    notice => {
      if (!notice) return
      logEvent('tengu_remote_headless_client_seed_cut_short', {
        at: analyticsText(at),
      })
      emitHeadlessFrame(
        client,
        headlessInformationalFrame(
          client.stampedSessionId,
          notice.level,
          notice.text,
        ),
      )
    },
    err => {
      logHeadlessSettlingOpenerWorkFailed(err)
    },
  )
}

/**
 * leftover `tn.openSession` @202384459
 * CALL logHeadlessDiscardedSessionNotReleased;
 * "session opened after the client ended; not attaching";
 * tengu_remote_headless_client_open_discarded
 */
export async function openSession(
  client: HeadlessCloudClient,
  initialize: unknown,
  seams: HeadlessCloudClientSeams = {},
): Promise<void> {
  let opened:
    | { kind: 'opened'; session: HeadlessOpenedSession }
    | { kind: 'failed'; message: string }
  try {
    opened = (await client.config.openSession?.({
      initialize,
      signal: client.featureAbort.signal,
      dialogs: { kinds: client.hostDialogKinds },
    })) ?? { kind: 'failed', message: 'no opener' }
  } catch (err) {
    logForDebugging(errorMessage(err))
    opened = { kind: 'failed', message: errorMessage(err) }
  }
  if (client.phase !== 'pre_session' || client.signalled) {
    logForDebugging(
      '[headlessCloudClient] session opened after the client ended; not attaching',
    )
    if (opened.kind === 'opened') {
      logEvent('tengu_remote_headless_client_open_discarded', {
        entry: analyticsText(opened.session.entry),
      })
      if (opened.session.entry === 'attach') {
        opened.session.preflightCheck?.catch(() => {})
      }
      await opened.session.dispose?.().catch(err => {
        logHeadlessDiscardedSessionNotReleased(err)
      })
    }
    return
  }
  if (opened.kind === 'failed') {
    await endHeadlessCloudClient(client, 'open_failed', opened.message)
    return
  }
  try {
    attachHeadlessCloudClientSession(client, opened.session, seams)
  } catch (err) {
    logForDebugging(errorMessage(err))
    if (opened.session.entry === 'attach') {
      opened.session.preflightCheck?.catch(() => {})
    }
    client.featureAbort.abort()
    client.features = null
    await opened.session.dispose?.().catch(() => {})
    await endHeadlessCloudClient(client, 'open_failed', errorMessage(err))
  }
}

/**
 * leftover `tn.refuseWhileClosing` @202381897
 * user/bash_command/control_request (emit H6 with CLOUD_CLIENT_IS_CLOSING) /
 * default CALL logHeadlessIgnoringFrameWhileClosing
 */
export function refuseWhileClosing(
  client: HeadlessCloudClient,
  frame: HeadlessClientFrame,
): void {
  switch (frame.type) {
    case 'user':
      client.submitUserMessage(frame)
      return
    case 'bash_command':
      client.submitBashCommand(frame)
      return
    case 'control_request': {
      const requestId = 'request_id' in frame ? frame.request_id : undefined
      if (typeof requestId === 'string') {
        emitHeadlessFrame(
          client,
          headlessControlErrorFrame(requestId, CLOUD_CLIENT_IS_CLOSING),
        )
      }
      return
    }
    default:
      logHeadlessIgnoringFrameWhileClosing(frame.type)
  }
}

/**
 * leftover `tn.logEnded` @202398752 — tengu_remote_headless_client_ended bag 1:1
 */
export function logEnded(
  client: HeadlessCloudClient,
  reason: string,
  exitCode: number,
  endedFrom: string,
  disconnectCode?: string,
): void {
  if (client.endLogged) return
  client.endLogged = true
  const outbound = client.outbound.stats
  const liveness = client.liveness?.stats
  logEvent('tengu_remote_headless_client_ended', {
    reason: analyticsText(reason),
    exit_code: exitCode,
    ended_from: analyticsText(endedFrom),
    entry: analyticsText(client.opened?.entry),
    disconnect_code: analyticsText(disconnectCode),
    container_start_failed: client.containerStartFailed,
    duration_ms: client.clock.now() - client.startedAt,
    turns: client.frames?.turns ?? 0,
    sends: outbound.sends,
    forwarded: outbound.forwards,
    passed_through: client.agentRequests.settledCount,
    dialogs_not_declared: client.dialogsNotDeclaredCount,
    dialogs_reserved_dropped: client.dialogsReservedCount,
    max_queue: outbound.maxQueued,
    max_held_for_init: client.frames?.maxHeld ?? 0,
    session_id_changes: client.frames?.counts.sessionIdChanges ?? 0,
    peer_content_omitted: client.frames?.counts.peerContentOmitted ?? 0,
    peer_tool_use_omitted: client.frames?.counts.peerToolUseOmitted ?? false,
    cloud_session_keys_dropped:
      client.frames?.counts.cloudSessionKeysDropped ?? 0,
    service_events_dropped: client.frames?.counts.serviceEventsDropped ?? 0,
    unknown_frames_dropped: client.frames?.counts.unknownFramesDropped ?? 0,
    peer_frames_dropped_before_init:
      client.frames?.counts.peerFramesDroppedBeforeInit ?? 0,
    input_failed: client.inputFailed,
    watchdog_fires: liveness?.watchdog_fires ?? 0,
    title: analyticsText(liveness?.title ?? 'not_applicable'),
    lines_written: liveness?.lines_written ?? 0,
    lines_suppressed: liveness?.lines_suppressed ?? 0,
    ...(client.inputClosedAt === null
      ? {}
      : { eof_to_end_ms: client.clock.now() - client.inputClosedAt }),
  })
  if (client.containerStartFailed) {
    logRemoteHeadlessClientFeature('bad', 'container_start_failed')
  } else if (exitCode !== 0) {
    logRemoteHeadlessClientFeature('bad', reason)
  } else if (client.inputFailed) {
    logRemoteHeadlessClientFeature('sad', 'input_failed')
  } else {
    logRemoteHeadlessClientFeature('ok')
  }
}

/**
 * leftover `tn.logWorkerInit` @202395409
 * CALL logHeadlessBuiltInToolNamesUnread
 */
export function logWorkerInit(
  client: HeadlessCloudClient,
  init: {
    claude_code_version?: unknown
    startup_timing?: { warm_spare_claimed?: unknown }
    tools?: unknown
  },
): void {
  try {
    client.builtInNames ??= new Set(client.config.builtInToolNames?.() ?? [])
  } catch (err) {
    client.builtInNames = new Set()
    logHeadlessBuiltInToolNamesUnread(err)
  }
  logForDebugging(formatHeadlessWorkerInitLine(init, client.builtInNames))
}

/**
 * leftover `tn.markWorkerReady` @202396589
 * tengu_remote_headless_client_worker_ready {via, wait_ms, queued}; goLive SEAM
 */
export function markWorkerReady(
  client: HeadlessCloudClient,
  via: string,
): void {
  client.containerStartFailed ||= via === 'step_failed'
  if (client.phase !== 'awaiting_worker' || client.session === null) return
  client.phase = 'live'
  client.cancelIdleDeadline?.()
  client.cancelIdleDeadline = null
  client.liveness?.noteWorkerReady?.()
  const queued = client.outbound.queuedCount
  client.goLive(client.session.manager)
  logEvent('tengu_remote_headless_client_worker_ready', {
    via: analyticsText(via),
    wait_ms: client.clock.now() - client.connectEpoch,
    queued,
  })
}

function ownQuestionKind(
  seams: HeadlessCloudClientSeams,
  kind: string,
): boolean {
  return (seams.isOwnQuestionDialogKind ?? isHeadlessHostDialogKind)(kind)
}

/**
 * leftover `tn.attach` default `new st` — wrap existing HeadlessCloudFrames.
 * Extra count keys stay 0 until a fuller st compositor lands; peer-hold
 * comes from the gold `class st` host.
 */
function wrapHeadlessCloudFrames(
  host: HeadlessCloudFrames,
): HeadlessClientFrames {
  const extra = {
    sessionIdChanges: 0,
    peerContentOmitted: 0,
    peerToolUseOmitted: false,
    cloudSessionKeysDropped: 0,
    serviceEventsDropped: 0,
    unknownFramesDropped: 0,
  }
  return {
    get turns() {
      return host.turnCount
    },
    get maxHeld() {
      return host.maxHeldForInit
    },
    get stampedSessionId() {
      return host.stampedSessionId
    },
    get counts() {
      return {
        ...extra,
        peerFramesDroppedBeforeInit: host.peerFramesDroppedBeforeInitCount,
      }
    },
    close: () => host.close(),
    offerSummary: () => {},
    noteCloudSessionChanged: () => {},
    releaseHeld: () => {
      host.releaseHeld()
    },
  }
}

/**
 * leftover `tn.attach` default `new ot` — wrap existing HeadlessCloudLiveness.
 * `reconnect` CALL leftoverHeadlessManager wrap of gold `gPe.reconnect`.
 */
function wrapHeadlessCloudLiveness(
  host: HeadlessCloudLiveness,
): HeadlessClientLiveness {
  return {
    get stats() {
      return {
        watchdog_fires: host.watchdogFires,
        title: host.title,
        lines_written: host.linesWritten,
        lines_suppressed: 0,
      }
    },
    halt: () => host.halt(),
    stop: () => host.stop(),
    noteWorkerReady: () => host.noteWorkerReady(),
    noteProvisioning: () => {},
    attachStatusFeeds: () => {},
    armStallWarning: () => host.armStallWarning(),
  }
}

/**
 * leftover `tn.attach` default `new Ce` — wrap existing
 * HeadlessCloudFeatureHandles. `callbacks` returns ports (identity) so
 * attach still hands the gold callback bag to the manager seam.
 */
function wrapHeadlessCloudFeatures(
  host: HeadlessCloudFeatureHandles,
): HeadlessClientFeatures {
  return {
    adopt: handles =>
      host.adopt(
        handles as Parameters<HeadlessCloudFeatureHandles['adopt']>[0],
      ),
    dispose: () => host.dispose(),
    noteWorkerInit: init => host.noteWorkerInit(init),
    noteWorkerUp: up => host.noteWorkerUp(up),
    noteWorkerLive: () => host.noteWorkerLive(),
    noteTurnInFlight: () => host.noteTurnInFlight(),
    noteTurnEnded: () => host.noteTurnEnded(),
    noteSessionCleared: id => host.noteSessionCleared(id),
    noteStreamConnected: () => host.noteStreamConnected(),
    noteSession: opts => host.noteSession(opts),
    onEachSettled: cb => host.onEachSettled(cb),
    onEachReportChanged: cb => host.onEachReportChanged(cb),
    callbacks: ports => ports,
    homeSeed: () => host.homeSeed(),
    sendWait: () => host.sendWait(),
    reports: () =>
      host.reports() as ReturnType<
        NonNullable<HeadlessClientFeatures['reports']>
      >,
    handles: () => host.handles(),
    statusFeeds: () => host.statusFeeds(),
  }
}

/**
 * leftover `tn.attach` @202385551 8835 B wrap as `attachHeadlessCloudClientSession`.
 * Default `new st`/`ot`/`Ce` → existing HeadlessCloudFrames/Liveness/FeatureHandles.
 * Default `new gPe` → leftoverHeadlessManager wrap of RemoteSessionManager.
 * CALL initializeHeadlessCloudWorker.
 * CALL leftoverHeadlessCopy: not passing own-question dialog, undeclared
 * dialog, Lost the connection — reconnecting…, stream error, attach
 * preflight failed Client string. KEEP existing minify hosts.
 * Gold `onWorkerUp` i("tengu_remote_headless_client_worker_up").
 * Gold reconnect notice uses leftoverHeadlessCopy CLOUD_SESSION_LOST_RECONNECTING.
 */
export function attachHeadlessCloudClientSession(
  client: HeadlessCloudClient,
  session: HeadlessOpenedSession,
  seams: HeadlessCloudClientSeams = {},
): void {
  if (
    session.entry === 'create' &&
    session.initialPrompt !== undefined &&
    session.initialPrompt.uuid !== session.initialPrompt.uuid.toLowerCase()
  ) {
    logForDebugging(
      '[headlessCloudClient] the seeded prompt uuid is not canonical lowercase; host redeliveries of it will not be recognised and will be sent again',
      { level: 'warn' },
    )
  }
  client.connectEpoch = client.clock.now()
  const frames =
    seams.createFrames?.(
      {
        clock: client.clock,
        includePartialMessages: client.config.includePartialMessages,
        emit: (frame: HeadlessClientFrame) => emitHeadlessFrame(client, frame),
        outbound: client.outbound,
        cloudSession: () => client.readCloudSession(),
        onWorkerReady: (via: string) => markWorkerReady(client, via),
        onWorkerInit: (init: unknown) => {
          client.features?.noteWorkerInit?.(init)
          logWorkerInit(
            client,
            (init ?? {}) as {
              claude_code_version?: unknown
              startup_timing?: { warm_spare_claimed?: unknown }
              tools?: unknown
            },
          )
        },
        onTurnInFlight: () => client.features?.noteTurnInFlight?.(),
        onTurnEnded: () => client.features?.noteTurnEnded?.(),
        onWorkerUp: (up: { generation?: unknown; sessionMode?: unknown }) => {
          client.features?.noteWorkerUp?.(up)
          logEvent('tengu_remote_headless_client_worker_up', {
            generation: up.generation as number,
            session_mode: analyticsText(up.sessionMode),
          })
        },
        onWorkerSessionId: (id: string) => {
          session.onWorkerSessionId?.(id)
          client.features?.noteSessionCleared?.(id)
        },
        onProvisioning: (a: unknown, b: unknown) =>
          client.liveness?.noteProvisioning?.(a, b),
      },
      {
        entry: session.entry,
        initialSessionId: session.sessionId,
        connectEpoch: client.connectEpoch,
        writesStatusBeforeInit: session.controlOnly === true,
      },
    ) ??
    client.frames ??
    wrapHeadlessCloudFrames(
      new HeadlessCloudFrames({
        entry: session.entry,
        sessionId: session.sessionId,
      }),
    )
  client.frames = frames
  client.stampedSessionId = frames.stampedSessionId ?? session.sessionId
  client.guarded(() => session.onWorkerSessionId?.(client.stampedSessionId))
  session.notices?.forEach(notice =>
    emitHeadlessFrame(
      client,
      headlessInformationalFrame(
        client.stampedSessionId,
        notice.level,
        notice.text,
      ),
    ),
  )
  client.releasePreSessionEchoes(frames)

  const liveness =
    seams.createLiveness?.(
      {
        clock: client.clock,
        emit: (frame: HeadlessClientFrame) => emitHeadlessFrame(client, frame),
        stampedSessionId: () => client.stampedSessionId,
        reconnect: () => client.session?.manager.reconnect?.(),
        queuedSendCount: () => client.outbound.queuedSendUuids?.().length ?? 0,
        sessionId: session.sessionId,
        controlOnly: session.controlOnly === true,
      },
      {
        titleFromFirstMessage: session.entry === 'create' && !session.hasTitle,
      },
    ) ??
    client.liveness ??
    wrapHeadlessCloudLiveness(
      new HeadlessCloudLiveness(
        {
          controlOnly: session.controlOnly === true,
          queuedSendCount: () =>
            client.outbound.queuedSendUuids?.().length ??
            client.outbound.queuedCount,
          reconnect: () => client.session?.manager.reconnect?.(),
          line: (level, text) =>
            emitHeadlessFrame(
              client,
              headlessInformationalFrame(client.stampedSessionId, level, text),
            ),
        },
        {
          titleFromFirstMessage:
            session.entry === 'create' && !session.hasTitle,
        },
      ),
    )
  client.liveness = liveness
  if (client.liveness.stats === undefined) {
    client.liveness.stats = {
      watchdog_fires: 0,
      title: 'not_applicable',
      lines_written: 0,
      lines_suppressed: 0,
    }
  }

  const features =
    seams.createFeatures?.() ??
    client.features ??
    wrapHeadlessCloudFeatures(new HeadlessCloudFeatureHandles())
  client.features = features
  if (client.features.callbacks === undefined) {
    client.features.callbacks = ports => ports
  }
  features.adopt(session.featureHandles ?? [])
  features.onEachSettled?.(() => {
    if (!client.closing) {
      frames.offerSummary?.()
      frames.noteCloudSessionChanged?.()
    }
  })
  features.onEachReportChanged?.(() => {
    if (!client.closing) frames.noteCloudSessionChanged?.()
  })
  session.onCloudSessionChanged?.(() =>
    client.guarded(() => {
      if (!client.closing) frames.noteCloudSessionChanged?.()
    }),
  )

  const featureCallbacks = features.callbacks?.({
    onMessage: () => {},
    onPermissionRequest: (
      request: { tool_name?: string },
      id: unknown,
      extra?: { reinstated?: boolean },
    ) =>
      client.guarded(() => {
        if (client.session === null || client.phase === 'ending') return
        if (extra?.reinstated === true) client.agentRequests.reinstate?.(id)
        if (request.tool_name === 'repository_trust') {
          logForDebugging(
            '[headlessCloudClient] not passing a repository-trust question to the host: it does not say what is attached, or its input is not the served digest alone',
            { level: 'warn' },
          )
          return
        }
        client.agentRequests.passPermissionRequest?.(
          client.session.manager,
          request,
          id,
        )
      }),
    onPermissionCancelled: (id: unknown) => client.agentRequests.cancel?.(id),
    onUserDialogRequest: (
      request: { dialog_kind: string },
      id: unknown,
      extra?: { reinstated?: boolean },
    ) =>
      client.guarded(() => {
        if (client.session === null || client.phase === 'ending') return
        if (ownQuestionKind(seams, request.dialog_kind)) {
          client.dialogsReservedCount++
          logHeadlessNotPassingOwnQuestionDialog(request.dialog_kind)
          return
        }
        if (!client.hostDialogKinds.has(request.dialog_kind)) {
          client.dialogsNotDeclaredCount++
          logHeadlessNotPassingUndeclaredDialog(request.dialog_kind)
          emitHeadlessFrame(
            client,
            headlessInformationalFrame(
              client.stampedSessionId,
              'notice',
              cloudSessionWaitingUndeclaredDialogCopy(
                clipRe(request.dialog_kind, 64),
              ),
            ),
          )
          return
        }
        if (extra?.reinstated === true) client.agentRequests.reinstate?.(id)
        client.agentRequests.passUserDialogRequest?.(
          client.session.manager,
          request,
          id,
        )
      }),
    onUserDialogCancelled: (id: unknown) => client.agentRequests.cancel?.(id),
    onConnected: () =>
      client.guarded(() => {
        const wasConnected = client.everConnected
        client.connection = 'live'
        frames.noteCloudSessionChanged?.()
        client.features?.noteStreamConnected?.()
        client.everConnected = true
        if (wasConnected) client.recheckServeOnlyLink(session)
        client.cancelReconnectNotice?.()
        client.cancelReconnectNotice = null
        if (client.reconnectingTold) {
          client.reconnectingTold = false
          emitHeadlessFrame(
            client,
            headlessInformationalFrame(
              client.stampedSessionId,
              'notice',
              'Reconnected.',
            ),
          )
        }
      }),
    onReconnecting: () =>
      client.guarded(() => {
        client.connection = 'reconnecting'
        frames.noteCloudSessionChanged?.()
        if (
          client.closing ||
          !client.everConnected ||
          client.reconnectingTold ||
          client.cancelReconnectNotice !== null
        ) {
          return
        }
        client.cancelReconnectNotice = client.clock.setTimeout(() => {
          client.cancelReconnectNotice = null
          client.reconnectingTold = true
          emitHeadlessFrame(
            client,
            headlessInformationalFrame(
              client.stampedSessionId,
              'notice',
              CLOUD_SESSION_LOST_RECONNECTING,
            ),
          )
        }, RECONNECT_NOTICE_MS)
      }),
    onCatchUpTruncated: () =>
      client.guarded(() => {
        frames.releaseHeld?.()
        const missed = client.outbound.synthesizeMissedEchoes?.() ?? 0
        void missed
        emitHeadlessFrame(
          client,
          headlessInformationalFrame(
            client.stampedSessionId,
            'warning',
            'Some earlier messages from this session could not be loaded after reconnecting.',
          ),
        )
      }),
    onToolHostEnded: (ended: { reason?: string }) =>
      client.guarded(() => {
        if (session.controlOnly !== true) {
          logForDebugging(
            '[headlessCloudClient] tool_host_ended ignored: this client is not a serve-only helper',
          )
          return
        }
        void ended
        void endHeadlessCloudClient(client, 'tool_host_ended')
      }),
    onDisconnected: (code?: CloudDisconnectCode) => {
      void endHeadlessCloudClient(client, 'disconnected', undefined, code)
    },
    onResponseUndelivered: (_id: unknown, kind: unknown, extra?: unknown) =>
      client.guarded(() => {
        const key = String(kind ?? '')
        if (client.undeliveredKindsTold.has(key)) return
        if (client.undeliveredKindsTold.size === 0) {
          queueMicrotask(() => client.undeliveredKindsTold.clear())
        }
        client.undeliveredKindsTold.add(key)
        emitHeadlessFrame(
          client,
          headlessInformationalFrame(
            client.stampedSessionId,
            'warning',
            CLOUD_MESSAGE_NOT_DELIVERED,
          ),
        )
        void extra
      }),
    onError: (err: { message: string }) => logHeadlessStreamError(err),
  })
  void featureCallbacks

  const homeSeed = features.homeSeed?.()
  const managerOpts = {
    sessionId: session.sessionId,
    getAccessToken: session.getAccessToken,
    onAuth401: session.onAuth401,
    orgUuid: session.orgUuid,
    dirSync: session.dirSync,
    ...(session.eventSigner && { eventSigner: session.eventSigner }),
    ...(homeSeed && {
      homeSeed,
      homeSeedHoldsFirstSend: session.entry === 'create',
    }),
    ...(session.controlOnly === true && { controlOnly: true }),
    trackSendsInFlight: true,
    keepUndeliveredResponses: true,
    nameToolOnPermissionAllow: true,
    rearmRedeliveredPermissionRequests: true,
    ignoreErrorShapedDialogReplies: true,
    keepOwnModelSwitchBreadcrumb: true,
    keepStreamRedialling: session.cloudSession().device.status === 'bound',
    ...(session.entry === 'create'
      ? { initialPromptUuid: session.initialPrompt?.uuid }
      : {
          isAttachToExisting: true,
          initialSequenceNum: session.initialSequenceNum,
          preflightCheck: session.preflightCheck,
        }),
  }
  const managerCallbacks = featureCallbacks as {
    onConnected?: () => void
    onDisconnected?: (code?: unknown) => void
    onReconnecting?: () => void
    onCatchUpTruncated?: () => void
    onError?: (err: { message: string }) => void
  }
  const manager =
    session.createManager?.(managerOpts, featureCallbacks) ??
    seams.createManager?.(managerOpts, featureCallbacks) ??
    client.session?.manager ??
    createHeadlessRemoteManager(
      {
        sessionId: session.sessionId,
        getAccessToken: session.getAccessToken,
        orgUuid: session.orgUuid,
        initialPromptUuid: session.initialPrompt?.uuid,
      },
      {
        onConnected: () => managerCallbacks.onConnected?.(),
        onDisconnected: code => managerCallbacks.onDisconnected?.(code),
        onReconnecting: () => managerCallbacks.onReconnecting?.(),
        onCatchUpTruncated: () => managerCallbacks.onCatchUpTruncated?.(),
        onError: err => managerCallbacks.onError?.(err),
      },
    )
  const sendWait = features.sendWait?.()
  if (sendWait !== null && sendWait !== undefined) {
    manager.addSendGate?.(
      item =>
        Promise.race([
          sendWait(),
          (item as { released?: Promise<unknown> }).released ??
            Promise.resolve(),
        ]),
      { onRelease: 'send' },
    )
  }
  const seedGate = session.dirSync?.sync?.seedGate?.bind(session.dirSync.sync)
  if (seedGate !== undefined) {
    manager.addSendGate?.(item => seedGate(item), { onRelease: 'withhold' })
  }
  client.session = { manager, opened: session }
  client.opened = session
  features.noteSession?.({ sessionId: session.sessionId, manager })
  if (session.entry === 'create' && session.initialPrompt) {
    client.outbound.noteOwnUuid?.(
      session.initialPrompt.uuid,
      session.initialPrompt.content,
    )
  }
  const awaitingAttach =
    session.entry === 'attach' &&
    (session.preflightCheck !== undefined ||
      (session.openingRequests?.length ?? 0) > 0)
  client.phase =
    session.entry === 'create' || awaitingAttach ? 'awaiting_worker' : 'live'
  manager.connect?.()

  const requested =
    session.entry === 'create' ? session.requestedPermissionMode : undefined
  if (requested !== undefined) {
    const push = seams.pushCreatePermissionMode ?? pushCreatePermissionMode
    holdLaterSendsBehindGates(
      manager,
      push({
        manager,
        mode: requested,
        surface: 'headless',
        sessionId: session.sessionId,
        superseded: () =>
          client.session?.manager !== manager || client.hostSentPermissionMode,
        observedMode: () => client.lastWorkerMode,
        seededModeReported: () => client.workerModesSeen.has(requested),
        linkDown: () => client.connection !== 'live',
        onGaveUp: copy =>
          emitHeadlessFrame(
            client,
            headlessInformationalFrame(
              client.stampedSessionId,
              'warning',
              copy,
            ),
          ),
      }),
    )
  }

  client.workerInitializeReason = initializeHeadlessCloudWorker(
    session,
    manager,
    {
      hostDialogKinds: client.hostDialogKinds,
      isOwnQuestionDialogKind: kind => ownQuestionKind(seams, kind),
      clock: client.clock,
      closing: () => client.closing,
      holdLaterSendsBehind: work => holdLaterSendsBehindGates(manager, work),
    },
  )

  const opening = awaitingAttach
    ? (session.preflightCheck ?? Promise.resolve()).then(() =>
        applyHeadlessOpeningRequests(session.openingRequests ?? [], {
          sendControlRequest: request =>
            manager.sendControlRequest?.(request) ?? Promise.resolve(),
          emitNotice: text =>
            emitHeadlessFrame(
              client,
              headlessInformationalFrame(
                client.stampedSessionId,
                'warning',
                text,
              ),
            ),
        }),
      )
    : undefined
  liveness.attachStatusFeeds?.(
    [session.dirSync?.status, ...(features.statusFeeds?.() ?? [])],
    () => {
      if (!client.closing) {
        frames.offerSummary?.()
        frames.noteCloudSessionChanged?.()
      }
    },
  )
  if (session.entry === 'create') liveness.armStallWarning?.()
  if (client.phase === 'live') liveness.noteWorkerReady?.()
  opening?.then(
    () => markWorkerReady(client, 'preflight'),
    err => {
      logHeadlessAttachPreflightFailed(err)
      void endHeadlessCloudClient(
        client,
        'disconnected',
        errorMessage(err),
        'attach_rejected',
      )
    },
  )

  const cloud = session.cloudSession()
  const reports = features.reports?.() ?? {}
  logEvent('tengu_remote_headless_client_started', {
    entry: analyticsText(session.entry),
    device_status: analyticsText(cloud.device.status),
    sync_state: analyticsText(cloud.directory_sync?.state),
    sync_reason: analyticsText(cloud.directory_sync?.reason),
    ignored_count: (client.config.ignoredOptions ?? []).length,
    ...groupNotApplied(
      (cloud.not_applied ?? []).filter(
        (row): row is { kind: 'lost' | 'kept' | 'preference'; name: string } =>
          row !== null &&
          typeof row === 'object' &&
          (row.kind === 'lost' ||
            row.kind === 'kept' ||
            row.kind === 'preference') &&
          typeof row.name === 'string',
      ),
    ),
    replay_user_messages: Boolean(client.config.replayUserMessages),
    include_partial_messages: Boolean(client.config.includePartialMessages),
    initialize_policy: analyticsText(
      client.config.initializePolicy ?? 'strict',
    ),
    has_dir_sync: session.dirSync !== undefined,
    has_home_seed: homeSeed !== undefined,
    worker_initialize: analyticsText(client.workerInitializeReason ?? 'none'),
    machine_features: features.handles?.().length ?? 0,
    serving_state: analyticsText(cloud.serving?.state),
    serving_reason: analyticsText(cloud.serving?.reason),
    oauth_bridge: client.oauthBridgeInstalled,
    ...Object.fromEntries(
      Object.keys(reports).map(key => [
        `feature_${key}`,
        analyticsText(reports[key]?.state),
      ]),
    ),
  })
  if (client.phase === 'live') client.goLive(manager)
  else if (session.entry === 'create') client.armIdleDeadline()
}
