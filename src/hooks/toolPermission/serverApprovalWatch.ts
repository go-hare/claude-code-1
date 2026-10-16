import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  createDesignProjectGrantWatcher,
  designSessionState,
} from '../../services/designProjectGrant.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import type { ToolStateSlots } from '../../utils/toolState.js'

/**
 * densable 2.1.289 Lyo — `tengu_omelette_grant_watch`, official default false.
 */
const GRANT_WATCH_GATE = 'tengu_omelette_grant_watch'

const INITIAL_MS = 3000
const MAX_MS = 15000

export type ServerApprovalWatch = {
  kind: 'design_project_grant'
  projectId: string
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * densable dialog loop at the permission prompt (EXE ~208105044).
 * The first poll only records a baseline (nwo returns false); later polls
 * that see a newer grant call onApproved. Plan mode parks and keeps waiting.
 */
export async function runServerApprovalWatch(opts: {
  poll: () => Promise<boolean>
  signal: AbortSignal
  shouldStop: () => boolean
  isPlanMode: () => boolean
  onApproved: () => void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}): Promise<void> {
  const sleep = opts.sleep ?? sleepAbortable
  let approved = await opts.poll()
  let delay = INITIAL_MS
  while (!approved && !opts.shouldStop() && !opts.signal.aborted) {
    await sleep(delay, opts.signal)
    if (opts.shouldStop() || opts.signal.aborted) return
    approved = await opts.poll()
    if (!approved) {
      delay = Math.min(Math.round(delay * 1.5), MAX_MS)
      continue
    }
    if (opts.isPlanMode()) {
      logForDebugging(
        'Server approval observed but parked: session is in plan mode',
      )
      approved = false
      delay = Math.min(Math.round(delay * 1.5), MAX_MS)
      continue
    }
    if (opts.shouldStop()) return
    opts.onApproved()
    return
  }
}

export function startDesignProjectGrantWatch(opts: {
  watch: ServerApprovalWatch | undefined
  context: { toolState?: ToolStateSlots; credentials?: unknown }
  signal: AbortSignal
  shouldStop: () => boolean
  isPlanMode: () => boolean
  onApproved: () => void
}): void {
  const watch = opts.watch
  if (!watch || watch.kind !== 'design_project_grant') return
  if (getFeatureValue_CACHED_MAY_BE_STALE(GRANT_WATCH_GATE, false) !== true) {
    return
  }
  const watcher = createDesignProjectGrantWatcher(
    designSessionState(opts.context),
    watch.projectId,
    opts.context.credentials,
  )
  void runServerApprovalWatch({
    poll: () => watcher.poll(),
    signal: opts.signal,
    shouldStop: opts.shouldStop,
    isPlanMode: opts.isPlanMode,
    onApproved: opts.onApproved,
  }).catch(error => {
    logEvent('tengu_feature_bad', {
      feature_name:
        'permission_server_approval_watch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'watcher_stopped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logForDebugging(`Server-approval watcher stopped (${errorMessage(error)})`)
  })
}
