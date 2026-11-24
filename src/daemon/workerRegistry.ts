import { randomUUID } from 'crypto'
import { lstat, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import {
  BridgeHeadlessPermanentError,
  type HeadlessBridgeOpts,
  runBridgeHeadless,
} from '../bridge/bridgeMain.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  clearOAuthTokenCache,
  getClaudeAIOAuthTokens,
  getClaudeAIOAuthTokensAsync,
  handleOAuth401Error,
} from '../utils/auth.js'
import { computeNextCronRun, parseCronExpression } from '../utils/cron.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage, getErrnoCode } from '../utils/errors.js'

/**
 * Exit codes the supervisor uses to decide retry vs park.
 * Permanent errors (trust not accepted, no git repo for worktree) use
 * EXIT_CODE_PERMANENT so the supervisor doesn't waste cycles retrying.
 */
export const EXIT_CODE_PERMANENT = 78 // EX_CONFIG from sysexits.h
export const EXIT_CODE_TRANSIENT = 1
export const EXIT_CODE_BAD_CONFIG = 2

const MAX_DAEMON_CONFIG_BYTES = 1_048_576
const MAX_SCHEDULED_TIMEOUT_MINUTES = 10_080
const AUTH_401_TIMEOUT_MS = 30_000
const PROACTIVE_REFRESH_LEAD_MS = 240_000
const PROACTIVE_REFRESH_MAX_DELAY_MS = 86_400_000
const KEYCHAIN_RECHECK_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Strict Zod Schemas for Official 2.1.328 WORKER_KINDS
// (`chunk@302225311.js @12000-16600`, `chunk@302217298.js @1400-1800`)
// ---------------------------------------------------------------------------

export const HeartbeatWorkerConfigSchema = z
  .object({
    intervalSeconds: z.number().positive().default(30),
  })
  .strict()

export type HeartbeatWorkerConfig = z.infer<typeof HeartbeatWorkerConfigSchema>

const SCHEDULED_PERMISSION_MODES = [
  'dontAsk',
  'auto',
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'bubble',
] as const

export const ScheduledTaskConfigSchema = z
  .object({
    id: z.string().min(1),
    cron: z.string().refine(expr => parseCronExpression(expr) !== null, {
      message: 'invalid 5-field cron expression',
    }),
    prompt: z.string().min(1),
    directory: z.string().min(1),
    enabled: z.boolean().default(true),
    permissionMode: z
      .enum(SCHEDULED_PERMISSION_MODES)
      .transform(mode => (mode === 'bubble' ? 'default' : mode))
      .default('dontAsk'),
    model: z.string().optional(),
    runTimeoutMinutes: z
      .number()
      .positive()
      .max(MAX_SCHEDULED_TIMEOUT_MINUTES)
      .default(30),
    maxQueued: z.number().int().positive().default(1),
  })
  .strict()

export type ScheduledTaskConfig = z.infer<typeof ScheduledTaskConfigSchema>

export const ScheduledWorkerConfigSchema = z
  .object({
    tasks: z
      .array(ScheduledTaskConfigSchema)
      .default([])
      .refine(tasks => new Set(tasks.map(t => t.id)).size === tasks.length, {
        message: 'task ids must be unique',
      }),
    maxConcurrent: z.number().int().positive().default(1),
  })
  .strict()

export type ScheduledWorkerConfig = z.infer<typeof ScheduledWorkerConfigSchema>

export const RemoteControlWorkerConfigSchema = z
  .object({
    dir: z.string(),
    name: z.string().optional(),
    spawnMode: z.enum(['same-dir', 'worktree']).default('same-dir'),
    capacity: z.number().int().positive().default(32),
    permissionMode: z.string().optional(),
    sandbox: z.boolean().optional(),
    sessionTimeoutSeconds: z.number().int().positive().optional(),
    createSessionOnStart: z.boolean().default(false),
  })
  .strict()

export type RemoteControlWorkerConfig = z.infer<
  typeof RemoteControlWorkerConfigSchema
>

export type DaemonWorkerKind = 'heartbeat' | 'scheduled' | 'remoteControl'

function singleOrArray<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .optional()
    .transform((val): z.infer<T>[] =>
      val === undefined ? [] : Array.isArray(val) ? val : [val],
    )
}

export const DaemonConfigSchema = z.object({
  $schema: z.string().optional(),
  heartbeat: singleOrArray(HeartbeatWorkerConfigSchema),
  scheduled: singleOrArray(ScheduledWorkerConfigSchema),
  remoteControl: singleOrArray(RemoteControlWorkerConfigSchema),
})

export type DaemonConfig = z.infer<typeof DaemonConfigSchema>

export function emptyDaemonConfig(): DaemonConfig {
  return DaemonConfigSchema.parse({})
}

export function getDefaultDaemonConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'daemon.json')
}

export type LoadDaemonConfigResult =
  | { ok: true; config: DaemonConfig; unknownKeys: string[]; existed: boolean }
  | { ok: false; error: string }

/**
 * Official `IEt(jsonPath)` (`chunk@302243130.js @1216`):
 * Load and strictly validate `daemon.json`. Missing file (`ENOENT`) yields
 * an empty valid config so the supervisor falls back gracefully.
 */
export async function loadDaemonConfig(
  jsonPath: string,
): Promise<LoadDaemonConfigResult> {
  let raw: string
  try {
    const st = await lstat(jsonPath)
    if (!st.isFile() || st.size > MAX_DAEMON_CONFIG_BYTES) {
      return {
        ok: false,
        error: `${jsonPath} is not a regular file (or exceeds 1MiB)`,
      }
    }
    raw = await readFile(jsonPath, 'utf8')
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') {
      return {
        ok: true,
        config: emptyDaemonConfig(),
        unknownKeys: [],
        existed: false,
      }
    }
    return {
      ok: false,
      error: `failed to read ${jsonPath}: ${errorMessage(err)}`,
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { ok: false, error: `failed to parse ${jsonPath} as JSON` }
  }

  const parsed = DaemonConfigSchema.safeParse(parsedJson)
  if (!parsed.success) {
    return {
      ok: false,
      error: `config validation failed: ${parsed.error.message}`,
    }
  }

  const knownKeys = new Set(Object.keys(DaemonConfigSchema.shape))
  const unknownKeys =
    typeof parsedJson === 'object' && parsedJson !== null
      ? Object.keys(parsedJson).filter(key => !knownKeys.has(key))
      : []

  return { ok: true, config: parsed.data, unknownKeys, existed: true }
}

export interface DaemonConfigDiff {
  stop: Array<{ id: string; kind: DaemonWorkerKind; previousConfig: unknown }>
  start: Array<{ id: string; kind: DaemonWorkerKind; config: unknown }>
  restart: Array<{
    id: string
    kind: DaemonWorkerKind
    config: unknown
    previousConfig: unknown
  }>
}

function stableConfigEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Official `uqi(prev, next)` (`chunk@302243130.js @2852`):
 * Diff two validated `daemon.json` configs to determine which `${kind}:${i}`
 * workers to stop, start, or restart on hot-reload.
 */
export function diffDaemonConfig(
  prev: DaemonConfig,
  next: DaemonConfig,
): DaemonConfigDiff {
  const diff: DaemonConfigDiff = { stop: [], start: [], restart: [] }
  const kinds: DaemonWorkerKind[] = ['heartbeat', 'scheduled', 'remoteControl']
  for (const kind of kinds) {
    const prevList = prev[kind] ?? []
    const nextList = next[kind] ?? []
    const len = Math.max(prevList.length, nextList.length)
    for (let i = 0; i < len; i++) {
      const id = `${kind}:${i}`
      const before = prevList[i]
      const after = nextList[i]
      if (before !== undefined && after === undefined) {
        diff.stop.push({ id, kind, previousConfig: before })
      } else if (before === undefined && after !== undefined) {
        diff.start.push({ id, kind, config: after })
      } else if (
        before !== undefined &&
        after !== undefined &&
        !stableConfigEqual(before, after)
      ) {
        diff.restart.push({
          id,
          kind,
          config: after,
          previousConfig: before,
        })
      }
    }
  }
  return diff
}

// ---------------------------------------------------------------------------
// Supervisor ↔ Worker OAuth IPC Coordinator — Official `K9i` & `ke`
// (`chunk@302225311.js @1900-11500`)
// ---------------------------------------------------------------------------

export type SupervisorToWorkerIpcMessage =
  | { type: 'token_update'; accessToken: string }
  | { type: 'auth_401_result'; refreshed: boolean; requestId: string }
  | { type: 'shutdown'; cause?: 'upgrade' | 'reload' | 'yield' }

export type WorkerToSupervisorIpcMessage = {
  type: 'auth_401'
  failedToken: string
  requestId: string
}

export function isSupervisorAuthIpcMessage(
  msg: unknown,
): msg is
  | { type: 'token_update'; accessToken: string }
  | { type: 'auth_401_result'; refreshed: boolean; requestId: string } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    ((msg as { type: unknown }).type === 'token_update' ||
      (msg as { type: unknown }).type === 'auth_401_result')
  )
}

export function isAuth401IpcRequest(
  msg: unknown,
): msg is WorkerToSupervisorIpcMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === 'auth_401' &&
    typeof (msg as { failedToken?: unknown }).failedToken === 'string' &&
    typeof (msg as { requestId?: unknown }).requestId === 'string'
  )
}

export function isShutdownIpcMessage(
  msg: unknown,
): msg is { type: 'shutdown'; cause?: 'upgrade' | 'reload' | 'yield' } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === 'shutdown'
  )
}

export interface IpcWorkerPeer {
  send?: (msg: SupervisorToWorkerIpcMessage) => unknown
  on(event: 'message', listener: (msg: unknown) => void): unknown
  removeListener(event: 'message', listener: (msg: unknown) => void): unknown
}

export interface SupervisorAuthManager {
  readonly ready: Promise<void>
  getAccessToken(): string | undefined
  attachWorker(worker: IpcWorkerPeer): void
  detachWorker(worker: IpcWorkerPeer): void
  broadcastTokenUpdate(accessToken: string): void
  handleWorkerAuth401(failedToken: string): Promise<boolean>
  dispose(): void
}

export interface SupervisorAuthManagerOptions {
  signal: AbortSignal
  log?: (msg: string) => void
  readTokens?: () => Promise<{
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
  } | null>
  refreshIfNeeded?: () => Promise<boolean>
  handle401?: (failedToken: string) => Promise<boolean>
  clearCache?: () => void
  recheckIntervalMs?: number
}

/**
 * Official `K9i` (`chunk@302225311.js @1900-8800`):
 * Supervisor-side OAuth IPC coordinator. Broadcasts `token_update` to attached
 * child workers, coordinates `auth_401` / `auth_401_result` handshakes, and
 * schedules proactive refreshes.
 */
export function createSupervisorAuthManager(
  opts: SupervisorAuthManagerOptions,
): SupervisorAuthManager {
  const { signal } = opts
  const log = opts.log ?? (() => {})
  const readTokens =
    opts.readTokens ?? (async () => getClaudeAIOAuthTokensAsync())
  const refreshIfNeeded =
    opts.refreshIfNeeded ?? (async () => checkAndRefreshOAuthTokenIfNeeded())
  const handle401 =
    opts.handle401 ?? (async (tok: string) => handleOAuth401Error(tok))
  const clearCache = opts.clearCache ?? clearOAuthTokenCache
  const recheckIntervalMs =
    opts.recheckIntervalMs ?? KEYCHAIN_RECHECK_INTERVAL_MS

  const workers = new Set<IpcWorkerPeer>()
  let currentToken: string | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let recheckTimer: ReturnType<typeof setInterval> | null = null

  function broadcastTokenUpdate(accessToken: string): void {
    currentToken = accessToken
    const msg: SupervisorToWorkerIpcMessage = {
      type: 'token_update',
      accessToken,
    }
    for (const worker of workers) {
      try {
        worker.send?.(msg)
      } catch {
        // worker channel closed
      }
    }
  }

  function clearTimers(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    if (recheckTimer) {
      clearInterval(recheckTimer)
      recheckTimer = null
    }
  }

  function scheduleProactiveRefresh(expiresAt: number | null): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    if (!expiresAt || signal.aborted) return
    const delay = Math.min(
      Math.max(expiresAt - Date.now() - PROACTIVE_REFRESH_LEAD_MS, 5_000),
      PROACTIVE_REFRESH_MAX_DELAY_MS,
    )
    refreshTimer = setTimeout(() => {
      void runProactiveRefresh()
    }, delay)
    refreshTimer.unref?.()
  }

  async function syncFromStore(): Promise<void> {
    const tokens = await readTokens()
    if (tokens?.accessToken && tokens.accessToken !== currentToken) {
      broadcastTokenUpdate(tokens.accessToken)
    }
    scheduleProactiveRefresh(tokens?.expiresAt ?? null)
  }

  function startKeychainRecheck(failedToken?: string): void {
    if (recheckTimer || signal.aborted) return
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    recheckTimer = setInterval(() => {
      if (signal.aborted) return
      void (async () => {
        try {
          clearCache()
          const tokens = await readTokens()
          if (
            tokens?.accessToken &&
            tokens.accessToken !== failedToken &&
            (!tokens.expiresAt || tokens.expiresAt > Date.now())
          ) {
            await syncFromStore()
            if (currentToken && recheckTimer) {
              clearInterval(recheckTimer)
              recheckTimer = null
              log('auth: token found via keychain re-check')
            }
          } else if (tokens?.refreshToken && (await refreshIfNeeded())) {
            await syncFromStore()
            if (currentToken && recheckTimer) {
              clearInterval(recheckTimer)
              recheckTimer = null
              log('auth: token refreshed via keychain re-check retry')
            }
          }
        } catch (err) {
          log(`auth: keychain re-check error: ${errorMessage(err)}`)
        }
      })()
    }, recheckIntervalMs)
    recheckTimer.unref?.()
  }

  async function runProactiveRefresh(): Promise<void> {
    if (signal.aborted) return
    try {
      const prevToken = currentToken
      const refreshed = await refreshIfNeeded()
      clearCache()
      const tokens = await readTokens()
      const expiresAt = tokens?.expiresAt ?? null
      if (
        tokens?.accessToken &&
        (refreshed || tokens.accessToken !== prevToken) &&
        (expiresAt === null ||
          expiresAt > Date.now() + PROACTIVE_REFRESH_LEAD_MS)
      ) {
        await syncFromStore()
        return
      }
      if (tokens?.accessToken && expiresAt !== null && expiresAt > Date.now()) {
        scheduleProactiveRefresh(
          Date.now() + 60_000 + PROACTIVE_REFRESH_LEAD_MS,
        )
        return
      }
      currentToken = undefined
      startKeychainRecheck(tokens?.accessToken ?? prevToken)
    } catch (err) {
      log(`auth: proactive refresh error: ${errorMessage(err)}`)
      scheduleProactiveRefresh(Date.now() + 60_000 + PROACTIVE_REFRESH_LEAD_MS)
    }
  }

  async function handleWorkerAuth401(failedToken: string): Promise<boolean> {
    log('auth: handling 401')
    try {
      if (await handle401(failedToken)) {
        clearCache()
        await syncFromStore()
        log('auth: 401 recovery succeeded')
        return true
      }
      currentToken = undefined
      clearCache()
      const tokens = await readTokens()
      if (tokens?.accessToken && tokens.accessToken !== failedToken) {
        await syncFromStore()
        return true
      }
      startKeychainRecheck(failedToken)
      return false
    } catch (err) {
      log(`auth: 401 handler error: ${errorMessage(err)}`)
      return false
    }
  }

  const onWorkerMessage = (msg: unknown): void => {
    if (!isAuth401IpcRequest(msg)) return
    const { failedToken, requestId } = msg
    handleWorkerAuth401(failedToken)
      .then(refreshed => {
        const reply: SupervisorToWorkerIpcMessage = {
          type: 'auth_401_result',
          refreshed,
          requestId,
        }
        for (const worker of workers) {
          try {
            worker.send?.(reply)
          } catch {
            // worker channel closed
          }
        }
      })
      .catch(() => {
        const reply: SupervisorToWorkerIpcMessage = {
          type: 'auth_401_result',
          refreshed: false,
          requestId,
        }
        for (const worker of workers) {
          try {
            worker.send?.(reply)
          } catch {
            // worker channel closed
          }
        }
      })
  }

  const ready = (async () => {
    if (signal.aborted) return
    try {
      const tokens = await readTokens()
      if (tokens?.accessToken) {
        currentToken = tokens.accessToken
        scheduleProactiveRefresh(tokens.expiresAt ?? null)
      }
      await refreshIfNeeded().catch(() => false)
      await syncFromStore()
    } catch (err) {
      log(`auth: init error: ${errorMessage(err)}`)
    }
    if (!signal.aborted && !currentToken) {
      startKeychainRecheck()
    }
  })()

  signal.addEventListener('abort', clearTimers, { once: true })

  return {
    ready,
    getAccessToken: () => currentToken,
    attachWorker(worker: IpcWorkerPeer) {
      workers.add(worker)
      worker.on('message', onWorkerMessage)
      if (currentToken) {
        try {
          worker.send?.({
            type: 'token_update',
            accessToken: currentToken,
          } satisfies SupervisorToWorkerIpcMessage)
        } catch {
          // ignore
        }
      }
    },
    detachWorker(worker: IpcWorkerPeer) {
      worker.removeListener('message', onWorkerMessage)
      workers.delete(worker)
    },
    broadcastTokenUpdate,
    handleWorkerAuth401,
    dispose() {
      clearTimers()
      for (const worker of workers) {
        worker.removeListener('message', onWorkerMessage)
      }
      workers.clear()
    },
  }
}

export interface WorkerAuthClient {
  getAccessToken(): string | undefined
  reportAuth401(failedToken: string): Promise<boolean>
  dispose(): void
}

/**
 * Official `ke(initialAccessToken)` (`chunk@302225311.js @10500-11500`):
 * Worker-side IPC auth client. Receives `token_update` pushes from the
 * supervisor and routes `reportAuth401` over Node IPC when connected.
 */
export function createWorkerAuthClient(
  initialAccessToken?: string,
  ipcChannel?: {
    send: (msg: unknown) => unknown
    on: (event: 'message', listener: (msg: unknown) => void) => unknown
    off: (event: 'message', listener: (msg: unknown) => void) => unknown
    unref?: () => void
  },
): WorkerAuthClient {
  const sendFn =
    ipcChannel?.send ??
    (typeof process.send === 'function'
      ? (msg: unknown) => process.send!(msg)
      : undefined)

  if (sendFn) {
    let token = initialAccessToken
    const pending = new Map<
      string,
      {
        resolve: (refreshed: boolean) => void
        timer: ReturnType<typeof setTimeout>
      }
    >()

    const onMessage = (msg: unknown): void => {
      if (!isSupervisorAuthIpcMessage(msg)) return
      if (msg.type === 'token_update') {
        token = msg.accessToken
      } else if (msg.type === 'auth_401_result') {
        const entry = pending.get(msg.requestId)
        if (entry) {
          clearTimeout(entry.timer)
          pending.delete(msg.requestId)
          entry.resolve(msg.refreshed)
        }
      }
    }

    if (ipcChannel) {
      ipcChannel.on('message', onMessage)
      ipcChannel.unref?.()
    } else {
      process.on('message', onMessage)
      process.channel?.unref?.()
    }

    return {
      getAccessToken: () => token ?? getClaudeAIOAuthTokens()?.accessToken,
      reportAuth401(failedToken: string): Promise<boolean> {
        const requestId = randomUUID()
        const req: WorkerToSupervisorIpcMessage = {
          type: 'auth_401',
          failedToken,
          requestId,
        }
        return new Promise<boolean>(resolvePromise => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            resolvePromise(false)
          }, AUTH_401_TIMEOUT_MS)
          timer.unref?.()
          pending.set(requestId, { resolve: resolvePromise, timer })
          try {
            sendFn(req)
          } catch {
            clearTimeout(timer)
            pending.delete(requestId)
            resolvePromise(false)
          }
        })
      },
      dispose() {
        for (const entry of pending.values()) {
          clearTimeout(entry.timer)
          entry.resolve(false)
        }
        pending.clear()
        if (ipcChannel) {
          ipcChannel.off('message', onMessage)
        } else {
          process.off('message', onMessage)
        }
      },
    }
  }

  // Standalone fallback (no supervisor IPC channel)
  let token = initialAccessToken
  return {
    getAccessToken: () => token ?? getClaudeAIOAuthTokens()?.accessToken,
    async reportAuth401(failedToken: string): Promise<boolean> {
      const ok = await handleOAuth401Error(failedToken)
      if (ok) {
        clearOAuthTokenCache()
        token = getClaudeAIOAuthTokens()?.accessToken
      }
      return ok
    },
    dispose() {},
  }
}

// ---------------------------------------------------------------------------
// Abortable sleep helper
// ---------------------------------------------------------------------------

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve()
  return new Promise<void>(resolveSleep => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolveSleep()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolveSleep()
    }, ms)
    timer.unref?.()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Worker Implementations — Official 2.1.328 (`heartbeat`, `scheduled`, `remoteControl`)
// ---------------------------------------------------------------------------

/**
 * Official `xe` (`chunk@302225311.js @16600`):
 * Heartbeat worker — logs a periodic heartbeat line every `intervalSeconds`.
 */
export async function runHeartbeatWorker(
  rawConfig: unknown,
  signal: AbortSignal,
  log: (msg: string) => void = msg => console.log(msg),
): Promise<void> {
  const { intervalSeconds } = HeartbeatWorkerConfigSchema.parse(rawConfig ?? {})
  log(`heartbeat worker started (interval=${intervalSeconds}s)`)
  while (!signal.aborted) {
    await abortableSleep(intervalSeconds * 1000, signal)
    if (!signal.aborted) {
      log('heartbeat')
    }
  }
}

export interface ScheduledWorkerDeps {
  executeTask?: (
    task: ScheduledTaskConfig,
    signal: AbortSignal,
  ) => Promise<void>
}

/**
 * Official `Y9i` (`chunk@302217298.js @2800`):
 * Scheduled worker — evaluates 5-field cron schedules for configured tasks
 * with `maxConcurrent` bounding and clean abort handling.
 */
export async function runScheduledWorker(
  rawConfig: unknown,
  signal: AbortSignal,
  log: (msg: string) => void = msg => console.log(msg),
  authClient: Pick<
    WorkerAuthClient,
    'getAccessToken'
  > = createWorkerAuthClient(),
  deps?: ScheduledWorkerDeps,
): Promise<void> {
  const { tasks, maxConcurrent } = ScheduledWorkerConfigSchema.parse(
    rawConfig ?? {},
  )
  if (!authClient.getAccessToken()) {
    log('scheduled worker: not authed — run `claude auth login`')
    process.exitCode = EXIT_CODE_TRANSIENT
    return
  }

  const enabledTasks = tasks.filter(t => t.enabled)
  log(
    `scheduled worker started (${enabledTasks.length} enabled task(s), maxConcurrent=${maxConcurrent})`,
  )

  if (enabledTasks.length === 0) {
    await new Promise<void>(resolveWait => {
      if (signal.aborted) {
        resolveWait()
        return
      }
      signal.addEventListener('abort', () => resolveWait(), { once: true })
    })
    return
  }

  let runningCount = 0
  const queuedCounts = new Map<string, number>()
  const nextRunById = new Map<string, number>()
  const parsedCronById = new Map<
    string,
    NonNullable<ReturnType<typeof parseCronExpression>>
  >()

  const nowDate = new Date()
  for (const task of enabledTasks) {
    const fields = parseCronExpression(task.cron)
    if (!fields) continue
    parsedCronById.set(task.id, fields)
    const next = computeNextCronRun(fields, nowDate)
    if (next) nextRunById.set(task.id, next.getTime())
  }

  const runSingleTask = async (task: ScheduledTaskConfig): Promise<void> => {
    runningCount++
    const taskAbort = new AbortController()
    const onParentAbort = () => taskAbort.abort()
    signal.addEventListener('abort', onParentAbort, { once: true })
    const timeout = setTimeout(
      () => taskAbort.abort(),
      task.runTimeoutMinutes * 60_000,
    )
    timeout.unref?.()
    try {
      log(`[scheduled:${task.id}] start cron=${task.cron}`)
      if (deps?.executeTask) {
        await deps.executeTask(task, taskAbort.signal)
      } else {
        const { buildCliLaunch, spawnCli } = await import(
          '../utils/cliLaunch.js'
        )
        const cliArgs = [
          '-p',
          task.prompt,
          '--permission-mode',
          task.permissionMode,
          ...(task.model ? ['--model', task.model] : []),
        ]
        const launch = buildCliLaunch(cliArgs, { env: { ...process.env } })
        await new Promise<void>((resolveRun, rejectRun) => {
          const child = spawnCli(launch, {
            cwd: resolve(task.directory),
            stdio: 'ignore',
          })
          const onKill = () => {
            if (!child.killed) child.kill('SIGTERM')
          }
          taskAbort.signal.addEventListener('abort', onKill, { once: true })
          child.once('error', err => {
            taskAbort.signal.removeEventListener('abort', onKill)
            rejectRun(err)
          })
          child.once('exit', code => {
            taskAbort.signal.removeEventListener('abort', onKill)
            log(`[scheduled:${task.id}] result exit=${code ?? -1}`)
            resolveRun()
          })
        })
      }
    } catch (err) {
      log(`[scheduled:${task.id}] threw: ${errorMessage(err)}`)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onParentAbort)
      runningCount = Math.max(0, runningCount - 1)
    }
  }

  while (!signal.aborted) {
    const now = Date.now()
    let soonestMs = 1_000
    for (const task of enabledTasks) {
      const dueAt = nextRunById.get(task.id)
      const fields = parsedCronById.get(task.id)
      if (dueAt === undefined || !fields) continue
      if (dueAt <= now) {
        const next = computeNextCronRun(fields, new Date(now))
        if (next) nextRunById.set(task.id, next.getTime())
        else nextRunById.delete(task.id)

        const queued = queuedCounts.get(task.id) ?? 0
        if (runningCount < maxConcurrent) {
          void runSingleTask(task)
        } else if (queued < task.maxQueued) {
          queuedCounts.set(task.id, queued + 1)
          log(`[scheduled:${task.id}] queued (${queued + 1}/${task.maxQueued})`)
        } else {
          log(`[scheduled:${task.id}] dropped (maxConcurrent=${maxConcurrent})`)
        }
      } else {
        soonestMs = Math.min(soonestMs, Math.max(50, dueAt - now))
      }
    }
    await abortableSleep(soonestMs, signal)
  }
}

/**
 * Build a Remote Control worker config from `DAEMON_WORKER_*` env vars when
 * invoked without a stdin JSON payload.
 */
export function buildRemoteControlConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RemoteControlWorkerConfig {
  const dir = resolve(env.DAEMON_WORKER_DIR || '.')
  const spawnMode =
    env.DAEMON_WORKER_SPAWN_MODE === 'worktree' ? 'worktree' : 'same-dir'
  const capacityParsed = env.DAEMON_WORKER_CAPACITY
    ? Number.parseInt(env.DAEMON_WORKER_CAPACITY, 10)
    : undefined
  const capacity =
    capacityParsed !== undefined &&
    Number.isInteger(capacityParsed) &&
    capacityParsed > 0
      ? capacityParsed
      : 32
  const sessionTimeoutParsed = env.DAEMON_WORKER_SESSION_TIMEOUT_SECONDS
    ? Number.parseInt(env.DAEMON_WORKER_SESSION_TIMEOUT_SECONDS, 10)
    : undefined
  return RemoteControlWorkerConfigSchema.parse({
    dir,
    ...(env.DAEMON_WORKER_NAME ? { name: env.DAEMON_WORKER_NAME } : {}),
    spawnMode,
    capacity,
    ...(env.DAEMON_WORKER_PERMISSION
      ? { permissionMode: env.DAEMON_WORKER_PERMISSION }
      : {}),
    ...(env.DAEMON_WORKER_SANDBOX === '1' ? { sandbox: true } : {}),
    ...(sessionTimeoutParsed && sessionTimeoutParsed > 0
      ? { sessionTimeoutSeconds: sessionTimeoutParsed }
      : {}),
    createSessionOnStart: env.DAEMON_WORKER_CREATE_SESSION === '1',
  })
}

export interface RemoteControlWorkerDeps {
  runBridgeHeadlessImpl?: (
    opts: HeadlessBridgeOpts,
    signal: AbortSignal,
  ) => Promise<void>
  authClient?: WorkerAuthClient
  log?: (msg: string) => void
  env?: NodeJS.ProcessEnv
}

/**
 * Official `ge` (`chunk@302225311.js @12000-15800`):
 * Remote Control worker — validates config strictly and delegates to
 * `runBridgeHeadless()` (NOT `startBgManager()`).
 */
export async function runRemoteControlWorker(
  rawConfig?: unknown,
  externalSignal?: AbortSignal,
  deps?: RemoteControlWorkerDeps,
): Promise<void> {
  const log = deps?.log ?? (msg => console.log(msg))
  const env = deps?.env ?? process.env
  const config =
    rawConfig !== undefined
      ? RemoteControlWorkerConfigSchema.parse(rawConfig)
      : buildRemoteControlConfigFromEnv(env)

  if (config.sandbox) {
    log(
      'The sandbox key is not supported for Remote Control. Remove it from daemon.json.',
    )
    process.exitCode = EXIT_CODE_PERMANENT
    return
  }

  const ownsAuthClient = deps?.authClient === undefined
  const authClient = deps?.authClient ?? createWorkerAuthClient()

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  const onSignal = () => controller.abort()
  const onIpcMessage = (msg: unknown) => {
    if (isShutdownIpcMessage(msg)) controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  } else {
    process.on('SIGTERM', onSignal)
    process.on('SIGINT', onSignal)
    process.on('message', onIpcMessage)
  }

  const getAccessToken = (): string | undefined =>
    env.CLAUDE_BRIDGE_OAUTH_TOKEN || authClient.getAccessToken()

  if (!getAccessToken()) {
    log(
      '[remoteControl] Not authenticated — run `claude auth login` to start Remote Control.',
    )
    process.exitCode = EXIT_CODE_TRANSIENT
    if (ownsAuthClient) authClient.dispose()
    return
  }

  const bridgeRunner = deps?.runBridgeHeadlessImpl ?? runBridgeHeadless

  try {
    await bridgeRunner(
      {
        dir: resolve(config.dir),
        name: config.name,
        spawnMode: config.spawnMode,
        capacity: config.capacity,
        permissionMode: config.permissionMode,
        sandbox: false,
        sessionTimeoutMs:
          config.sessionTimeoutSeconds !== undefined
            ? config.sessionTimeoutSeconds * 1000
            : undefined,
        createSessionOnStart: config.createSessionOnStart,
        getAccessToken,
        onAuth401: failedToken => authClient.reportAuth401(failedToken),
        log,
      },
      controller.signal,
    )
  } catch (err) {
    if (err instanceof BridgeHeadlessPermanentError) {
      log(`[remoteControl] permanent error: ${err.message}`)
      process.exitCode = EXIT_CODE_PERMANENT
    } else {
      log(`[remoteControl] error: ${errorMessage(err)}`)
      process.exitCode = EXIT_CODE_TRANSIENT
    }
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onAbort)
    } else {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      process.off('message', onIpcMessage)
    }
    if (ownsAuthClient) authClient.dispose()
  }
}

/**
 * Dedicated background session manager worker (`--daemon-worker=bg`).
 * Keeps FleetView / control socket cleanly separated from `remoteControl`.
 */
export async function runBgManagerWorker(
  externalSignal?: AbortSignal,
  log: (msg: string) => void = msg => console.log(`[bg] ${msg}`),
): Promise<void> {
  const { startBgManager } = await import('./bgManager.js')

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  const onIpcMessage = (msg: unknown) => {
    if (isShutdownIpcMessage(msg)) controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onSignal, { once: true })
  } else {
    process.on('SIGTERM', onSignal)
    process.on('SIGINT', onSignal)
    process.on('message', onIpcMessage)
  }

  try {
    const manager = await startBgManager({ onLog: log })
    log('bg manager + control socket ready')

    await new Promise<void>(resolveWait => {
      if (controller.signal.aborted) {
        resolveWait()
        return
      }
      controller.signal.addEventListener('abort', () => resolveWait(), {
        once: true,
      })
    })

    await manager.close()
  } catch (err) {
    console.error(`[bg] error: ${errorMessage(err)}`)
    process.exitCode = EXIT_CODE_TRANSIENT
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onSignal)
    } else {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      process.off('message', onIpcMessage)
    }
  }
}

/**
 * Official `FDe` (`chunk@302225311.js @16500`):
 * Registry of all 3 official daemon worker kinds with strict Zod schemas.
 */
export const WORKER_KINDS = {
  heartbeat: {
    schema: HeartbeatWorkerConfigSchema,
    run: runHeartbeatWorker,
    needsOAuth: false,
  },
  scheduled: {
    schema: ScheduledWorkerConfigSchema,
    run: runScheduledWorker,
    needsOAuth: true,
  },
  remoteControl: {
    schema: RemoteControlWorkerConfigSchema,
    run: runRemoteControlWorker,
    needsOAuth: true,
  },
} as const

// ---------------------------------------------------------------------------
// Stdin JSON payload reader (supervisor pipes `{ config, initialAccessToken }`)
// ---------------------------------------------------------------------------

type WorkerStdinEnvelope = {
  config?: unknown
  initialAccessToken?: string
}

async function readStdinWorkerEnvelope(): Promise<WorkerStdinEnvelope | null> {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  try {
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }
  } catch {
    return null
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return null
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('stdin JSON payload must be an object')
  }
  const rec = parsed as Record<string, unknown>
  return {
    config: 'config' in rec ? rec.config : rec,
    initialAccessToken:
      typeof rec.initialAccessToken === 'string'
        ? rec.initialAccessToken
        : undefined,
  }
}

/**
 * Daemon worker entry point. Called from `cli.tsx` via:
 *   `claude --daemon-worker=<kind>`
 *
 * Supports official `WORKER_KINDS` (`remoteControl`, `scheduled`, `heartbeat`)
 * plus dedicated `bg` worker mode.
 */
export async function runDaemonWorker(kind?: string): Promise<void> {
  if (!kind) {
    console.error('Error: --daemon-worker requires a worker kind')
    process.exitCode = EXIT_CODE_BAD_CONFIG
    return
  }

  if (kind === 'bg') {
    await runBgManagerWorker()
    return
  }

  if (!(kind in WORKER_KINDS)) {
    console.error(`Error: unknown daemon worker kind '${kind}'`)
    process.exitCode = EXIT_CODE_BAD_CONFIG
    return
  }

  const workerKind = kind as DaemonWorkerKind

  let envelope: WorkerStdinEnvelope | null = null
  try {
    envelope = await readStdinWorkerEnvelope()
  } catch (err) {
    console.error(`invalid config JSON on stdin: ${errorMessage(err)}`)
    process.exitCode = EXIT_CODE_BAD_CONFIG
    return
  }

  const rawConfig =
    envelope?.config !== undefined
      ? envelope.config
      : workerKind === 'remoteControl'
        ? buildRemoteControlConfigFromEnv()
        : {}

  const spec = WORKER_KINDS[workerKind]
  const validated = spec.schema.safeParse(rawConfig)
  if (!validated.success) {
    console.error(`config validation failed: ${validated.error.message}`)
    process.exitCode = EXIT_CODE_BAD_CONFIG
    return
  }

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  const onMessage = (msg: unknown) => {
    if (isShutdownIpcMessage(msg)) controller.abort()
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  process.on('message', onMessage)

  const authClient = createWorkerAuthClient(envelope?.initialAccessToken)
  const log = (msg: string) => process.stdout.write(`${msg}\n`)

  try {
    switch (workerKind) {
      case 'heartbeat':
        await runHeartbeatWorker(validated.data, controller.signal, log)
        break
      case 'scheduled':
        await runScheduledWorker(
          validated.data,
          controller.signal,
          log,
          authClient,
        )
        break
      case 'remoteControl':
        await runRemoteControlWorker(validated.data, controller.signal, {
          authClient,
          log,
        })
        break
    }
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    process.off('message', onMessage)
    authClient.dispose()
  }
}
