/**
 * Official working-sync start densable (print/sdkUrl path).
 *
 * Official gate:
 *   sdkUrl && CLAUDE_CODE_REMOTE_SESSION_ID && ENVIRONMENT_KIND === undefined
 *   && !CLAUDE_CODE_DISABLE_WORKING_SYNC
 * → lazy import startSyncedFileSyncer(SYNCED_FILE_ROOT)
 *
 * Optional CCR j6o put host densable via createWorkingFilestoreTransports when
 * requestSyncedFile / workerEpoch are provided (RemoteIO wires CCRClient).
 */

import { isWorkingSyncDisabled } from './residualUiEnvGates.js'

export type WorkingSyncStartInput = {
  sdkUrl?: string | null
  env?: NodeJS.ProcessEnv
  /**
   * Official j6o CCR request host densable. When present, startSyncedFileSyncer
   * pushes changed files via createWorkingFilestoreTransports.
   */
  requestSyncedFile?: (args: {
    method: 'put' | 'get'
    path: string
    body?: unknown
    timeoutMs?: number
    maxBodyLength?: number
    maxContentLength?: number
  }) => Promise<{
    ok: boolean
    reason?: string
    status?: number
    data?: { content?: string; content_sha256?: string }
  }>
  /** Official worker_epoch for put body. */
  workerEpoch?: number | string
  /** Optional root override (tests). */
  root?: string
}

/**
 * Official densable — whether headless print path should start working-sync.
 */
export function shouldStartWorkingSync(input: WorkingSyncStartInput): boolean {
  if (!input.sdkUrl) return false
  const env = input.env ?? process.env
  if (!env.CLAUDE_CODE_REMOTE_SESSION_ID) return false
  if (env.CLAUDE_CODE_ENVIRONMENT_KIND !== undefined) return false
  if (isWorkingSyncDisabled(env)) return false
  return true
}

/**
 * Official densable consumer — fire-and-forget start when eligible.
 * Resolves optional denser module `./syncedFileSyncer.js` if present;
 * wires j6o put transport when requestSyncedFile is provided.
 */
export function maybeStartWorkingSync(input: WorkingSyncStartInput): void {
  if (!shouldStartWorkingSync(input)) return
  void Promise.resolve()
    .then(async () => {
      try {
        const mod = await import('./syncedFileSyncer.js')
        if (typeof mod.startSyncedFileSyncer !== 'function') return
        const workerEpoch = input.workerEpoch
        if (input.requestSyncedFile) {
          const transports = mod.createWorkingFilestoreTransports({
            request: input.requestSyncedFile,
            workerEpoch: input.workerEpoch,
          })
          void mod.startSyncedFileSyncer(input.root ?? mod.SYNCED_FILE_ROOT, {
            put: transports.put,
            ...(workerEpoch !== undefined ? { workerEpoch } : {}),
          })
        } else {
          void mod.startSyncedFileSyncer(input.root ?? mod.SYNCED_FILE_ROOT, {
            ...(workerEpoch !== undefined ? { workerEpoch } : {}),
          })
        }
      } catch {
        // working_sync_import_failed
      }
    })
    .catch(() => {
      // never throw from startup hook
    })
}
