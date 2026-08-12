/**
 * densable 2.1.224 #28 — `replBridgePlaceholders` + FLp / BLp / ULp / RLb.
 *
 * When Remote Control mints a server session, register it as a "placeholder"
 * owned by this process. On later mint/reattach, sweep GlobalConfig for
 * orphaned placeholders (dead pid / recycled pid) whose server session was
 * never touched (created_at === updated_at) and archive them.
 *
 * densable names:
 *   FLp registerBridgePlaceholder
 *   BLp removeBridgePlaceholder
 *   ULp sweepBridgePlaceholders
 *   RLb process one entry
 *   ALb isPlaceholderOrphanOwner
 *   NLp isPlaceholderSweepEnabled
 *   MLp stripBridgeSessionPrefix
 *   Npa isArchiveSuccessStatus
 *   $Lp serial config write queue
 *   Zxr archive wrapper → BLp on success (wired in remoteBridgeCore)
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  getProcessLstartString,
  isProcessRunning,
  processLstartMatches,
} from '../utils/genericProcessUtils.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'
import { sleep } from '../utils/sleep.js'

/** densable vLb — min age before a placeholder is eligible for sweep. */
export const PLACEHOLDER_MIN_AGE_MS = 300_000
/** densable ELb — drop map entry after this age even if archive kept. */
export const PLACEHOLDER_MAX_AGE_MS = 2_592_000_000
/** densable HLp — max placeholders retained in GlobalConfig. */
export const PLACEHOLDER_CAP = 20
/** densable wLb — delay before first sweep in a process. */
export const PLACEHOLDER_SWEEP_START_DELAY_MS = 15_000
/** densable CLb — valid session id shape. */
export const PLACEHOLDER_ID_RE = /^(session|cse)_[A-Za-z0-9_-]+$/

export type BridgePlaceholderEntry = {
  pid: number
  /** densable procStart — process lstart / win32 creation token. */
  procStart?: string
  createdAt: number
}

export type PlaceholderArchiveStatus =
  | number
  | 'invalid'
  | 'timeout'
  | 'error'
  | 'no_token'
  | string

export type SweepBridgePlaceholdersOpts = {
  baseUrl: string
  getAccessToken: () => string | undefined
  /** densable skipSessionId — current live session (do not archive). */
  skipSessionId?: string
  archive: (sessionId: string) => Promise<PlaceholderArchiveStatus>
  /** Override densable wLb (tests use 0). */
  startDelayMs?: number
  /**
   * densable XBo — fetch session timestamps. Injectable for tests.
   * Default: GET /v1/sessions/{id} via createSession helper.
   */
  fetchSession?: (sessionId: string) => Promise<{
    session: {
      created_at?: string
      updated_at?: string
    } | null
    notFound: boolean
  }>
}

/** densable Lpa — serialise GlobalConfig mutations for placeholders. */
let writeQueue: Promise<unknown> = Promise.resolve()
/** densable LLp — once-per-process sweep gate. */
let sweepStarted = false

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn)
  // Keep the chain alive even if a write rejects.
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** densable MLp — strip session_/cse_ for skip comparison. */
export function stripBridgeSessionPrefix(id: string): string {
  return id.replace(/^(session_|cse_)/, '')
}

/**
 * densable Npa — archive HTTP status is "success enough" to drop the map entry.
 * invalid → true; number <500 except 401/408/429 → true.
 */
export function isArchiveSuccessStatus(
  status: PlaceholderArchiveStatus,
): boolean {
  if (status === 'invalid') return true
  return (
    typeof status === 'number' &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  )
}

/** densable NLp — gate on essential-traffic + GrowthBook. */
export async function isPlaceholderSweepEnabled(): Promise<boolean> {
  if (isEssentialTrafficOnly()) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_bridge_placeholder_sweep',
    true,
  )
}

/**
 * densable ALb — true when the recorded owner process is gone or recycled.
 * dead pid (ESRCH via kill 0) → orphan; running but lstart mismatch → orphan.
 */
export async function isPlaceholderOrphanOwner(
  entry: BridgePlaceholderEntry,
): Promise<boolean> {
  if (!isProcessRunning(entry.pid)) return true
  return !(await processLstartMatches(entry.pid, entry.procStart))
}

/**
 * densable FLp — register current process as owner of sessionId.
 * Skips when sweep gate is off. Cap 20 newest; log evictions.
 */
export function registerBridgePlaceholder(sessionId: string): Promise<void> {
  return enqueueWrite(async () => {
    if (!sessionId || !PLACEHOLDER_ID_RE.test(sessionId)) return
    if (!(await isPlaceholderSweepEnabled())) return
    const procStart = await getProcessLstartString(process.pid)
    const entry: BridgePlaceholderEntry = {
      pid: process.pid,
      procStart,
      createdAt: Date.now(),
    }
    saveGlobalConfig((cfg: GlobalConfig) => {
      const rows = Object.entries(cfg.replBridgePlaceholders ?? {}).filter(
        ([id]) => id !== sessionId,
      )
      rows.push([sessionId, entry])
      rows.sort((a, b) => b[1].createdAt - a[1].createdAt)
      const evicted = rows.slice(PLACEHOLDER_CAP)
      if (evicted.length > 0) {
        logForDebugging(
          `[bridge:placeholder] evicting ${evicted.length} record(s) past cap: ${evicted.map(([id]) => id).join(', ')}`,
        )
      }
      return {
        ...cfg,
        replBridgePlaceholders: Object.fromEntries(
          rows.slice(0, PLACEHOLDER_CAP),
        ),
      }
    })
  })
}

/**
 * densable BLp — drop sessionId from GlobalConfig.replBridgePlaceholders.
 * Called after successful archive (Zxr path) and when sweep decides remove.
 */
export function removeBridgePlaceholder(sessionId: string): Promise<void> {
  return enqueueWrite(async () => {
    if (!sessionId) return
    saveGlobalConfig((cfg: GlobalConfig) => {
      if (!cfg.replBridgePlaceholders?.[sessionId]) return cfg
      const next = { ...cfg.replBridgePlaceholders }
      delete next[sessionId]
      return { ...cfg, replBridgePlaceholders: next }
    })
  })
}

/**
 * densable XBo subset — GET session with notFound for 404.
 * Uses compat /v1/sessions path (same as archive).
 */
async function defaultFetchSession(
  sessionId: string,
  opts: { baseUrl: string; getAccessToken: () => string | undefined },
): Promise<{
  session: { created_at?: string; updated_at?: string } | null
  notFound: boolean
}> {
  const { getBridgeSessionWithNotFound } = await import('./createSession.js')
  return getBridgeSessionWithNotFound(sessionId, {
    baseUrl: opts.baseUrl,
    getAccessToken: opts.getAccessToken,
  })
}

/**
 * densable RLb — process one placeholder entry.
 * keep | remove (caller deletes map key on remove).
 */
async function processPlaceholderEntry(
  sessionId: string,
  entry: BridgePlaceholderEntry,
  opts: SweepBridgePlaceholdersOpts,
): Promise<'keep' | 'remove'> {
  if (!(await isPlaceholderOrphanOwner(entry))) return 'keep'

  const fetchSession =
    opts.fetchSession ??
    ((id: string) =>
      defaultFetchSession(id, {
        baseUrl: opts.baseUrl,
        getAccessToken: opts.getAccessToken,
      }))

  const { session, notFound } = await fetchSession(sessionId)
  if (notFound) return 'remove'
  if (!session) return 'keep'
  if (!session.created_at || !session.updated_at) {
    logForDebugging(
      `[bridge:placeholder] session GET carried no timestamps for ${sessionId}; keeping`,
    )
    return 'keep'
  }
  // Touched session — drop map entry without archiving.
  if (session.updated_at !== session.created_at) return 'remove'

  const status = await opts.archive(sessionId)
  if (!isArchiveSuccessStatus(status)) {
    logForDebugging(
      `[bridge:placeholder] archive failed for ${sessionId} status=${String(status)}`,
      { level: 'error' },
    )
    // densable logFeatureBad("bridge_placeholder_sweep", ...)
    return 'keep'
  }
  // densable logFeatureOk + BLp happens via archive wrapper (Zxr) or here if
  // archive callback already removed — still return remove for map cleanup.
  logForDebugging(
    `[bridge:placeholder] archived orphaned placeholder ${sessionId} (status=${String(status)})`,
  )
  return 'remove'
}

/**
 * densable ULp — once-per-process delayed sweep of orphaned placeholders.
 * Fire-and-forget; errors are logged, never thrown to caller.
 */
export function sweepBridgePlaceholders(
  opts: SweepBridgePlaceholdersOpts,
): Promise<void> {
  if (sweepStarted) return Promise.resolve()
  sweepStarted = true
  return (async () => {
    await sleep(opts.startDelayMs ?? PLACEHOLDER_SWEEP_START_DELAY_MS)
    if (!(await isPlaceholderSweepEnabled())) return
    const map = getGlobalConfig().replBridgePlaceholders
    if (!map) return

    const skipRaw = opts.skipSessionId
      ? stripBridgeSessionPrefix(opts.skipSessionId)
      : undefined
    const toRemove: string[] = []

    for (const [id, entry] of Object.entries(map)) {
      const age = Date.now() - entry.createdAt
      // densable: Math.abs(s)<vLb || MLp(o)===r → continue
      if (Math.abs(age) < PLACEHOLDER_MIN_AGE_MS) continue
      if (stripBridgeSessionPrefix(id) === skipRaw) continue
      if (!PLACEHOLDER_ID_RE.test(id)) {
        toRemove.push(id)
        continue
      }
      const decision = await processPlaceholderEntry(id, entry, opts)
      if (decision === 'remove' || age > PLACEHOLDER_MAX_AGE_MS) {
        toRemove.push(id)
      }
    }

    if (toRemove.length > 0) {
      await enqueueWrite(async () => {
        saveGlobalConfig((cfg: GlobalConfig) => {
          if (!cfg.replBridgePlaceholders) return cfg
          const next = { ...cfg.replBridgePlaceholders }
          for (const id of toRemove) delete next[id]
          return { ...cfg, replBridgePlaceholders: next }
        })
      })
    }
  })().catch(err => {
    logForDebugging(`[bridge:placeholder] sweep failed: ${errorMessage(err)}`, {
      level: 'error',
    })
  })
}

/** Test helper — reset once-per-process gate + write queue. */
export function resetBridgePlaceholdersForTests(): void {
  sweepStarted = false
  writeQueue = Promise.resolve()
}
