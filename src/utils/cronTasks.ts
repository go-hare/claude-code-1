// Scheduled prompts, stored in <project>/.claude/scheduled_tasks.json.
//
// Tasks come in two flavors:
//   - One-shot (recurring: false/undefined) — fire once, then auto-delete.
//   - Recurring (recurring: true) — fire on schedule, reschedule from now,
//     persist until explicitly deleted via CronDelete or auto-expire after
//     a configurable limit (DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs).
//
// File format:
//   { "tasks": [{ id, cron, prompt, createdAt, recurring?, permanent? }] }

import { randomUUID } from 'crypto'
import { lstatSync, readFileSync, statSync } from 'fs'
import { lstat, mkdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  addSessionCronTask,
  getProjectRoot,
  getSessionCronTasks,
  getSessionId,
  removeSessionCronTasks,
} from '../bootstrap/state.js'
import { computeNextCronRun, parseCronExpression } from './cron.js'
import { logForDebugging } from './debug.js'
import { getErrnoCode } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { getProcessStartTime } from './genericProcessUtils.js'
import { safeParseJSON } from './json.js'
import { logError } from './log.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { jsonStringify } from './slowOperations.js'
import {
  CLAUDE_ATOMIC_STAGING_LEAF,
  assertDirChainReal,
  isClaudeConfigDirPath,
  writeFileAndFlush,
} from './symlinkWriteGuard.js'

export type CronTask = {
  id: string
  /** 5-field cron string (local time) — validated on write, re-validated on read. */
  cron: string
  /** Prompt to enqueue when the task fires. */
  prompt: string
  /** Epoch ms when the task was created. Anchor for missed-task detection. */
  createdAt: number
  /**
   * Epoch ms of the most recent fire. Written back by the scheduler after
   * each recurring fire so next-fire computation survives process restarts.
   * The scheduler anchors first-sight from `lastFiredAt ?? createdAt` — a
   * never-fired task uses createdAt (correct for pinned crons like
   * `30 14 27 2 *` whose next-from-now is next year); a fired-before task
   * reconstructs the same `nextFireAt` the prior process had in memory.
   * Never set for one-shots (they're deleted on fire).
   */
  lastFiredAt?: number
  /** When true, the task reschedules after firing instead of being deleted. */
  recurring?: boolean
  /**
   * When true, the task is exempt from recurringMaxAgeMs auto-expiry.
   * System escape hatch for assistant mode's built-in tasks (catch-up/
   * morning-checkin/dream) — the installer's writeIfMissing() skips existing
   * files so re-install can't recreate them. Not settable via CronCreateTool;
   * only written directly to scheduled_tasks.json by src/assistant/install.ts.
   */
  permanent?: boolean
  /**
   * Runtime-only flag. false → session-scoped (never written to disk).
   * File-backed tasks leave this undefined; writeCronTasks strips it so
   * the on-disk shape stays { id, cron, prompt, createdAt, lastFiredAt?, recurring?, permanent? }.
   */
  durable?: boolean
  /**
   * Runtime-only. When set, the task was created by an in-process teammate.
   * The scheduler routes fires to that teammate's queue instead of the main
   * REPL's. Never written to disk (teammate crons are always session-only).
   */
  agentId?: string
  /**
   * densable `kind:"loop"` — ScheduleWakeup dynamic-loop one-shot wakeups.
   * Session-only (never written to disk). Present on CronTask so onFireTask
   * receives the same shape as SessionCronTask.
   */
  kind?: 'loop'
  /**
   * densable DaemonHub mGa toggle (IBt enabled flip).
   * `false` → scheduler skips fire; omitted/true → enabled.
   * Written to disk when explicitly set.
   */
  enabled?: boolean
  createdBySessionId?: string
  createdByPid?: number
  createdByProcStart?: string
  createdInProject?: string
  plugin?: string
}

type CronFile = { tasks: CronTask[] }

const CRON_FILE_REL = join('.claude', 'scheduled_tasks.json')

/**
 * Path to the cron file. `dir` defaults to getProjectRoot() — pass it
 * explicitly from contexts that don't run through main.tsx (e.g. the Agent
 * SDK daemon, which has no bootstrap state).
 */
export function getCronFilePath(dir?: string): string {
  return join(dir ?? getProjectRoot(), CRON_FILE_REL)
}

export const UNREADABLE_TASKS_ERROR =
  'The scheduled tasks file (.claude/scheduled_tasks.json) could not be read as a list of tasks, so it was not changed. Check or repair that file, then try again.'

const MAX_CRON_FILE_BYTES = 1_048_576
const MAX_PRESERVED_DEPTH = 16
const MAX_STORED_PLUGIN_NAME_LEN = 256
// biome-ignore lint/suspicious/noControlCharactersInRegex: reject ASCII control characters in stored plugin names
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

function isValidStoredPluginName(plugin: unknown): boolean {
  return (
    typeof plugin === 'string' &&
    plugin !== '' &&
    plugin.length <= MAX_STORED_PLUGIN_NAME_LEN &&
    !CONTROL_CHAR_RE.test(plugin)
  )
}

/**
 * Official `Mn` — only missing-file errors (`ENOENT`/`ENOTDIR`) mean "no tasks yet".
 * Permission/loop/I/O errors (`EACCES`, `EPERM`, `ELOOP`, etc.) must return
 * `'unreadable'` so writers never clobber an existing file they could not read.
 */
function isCronFileMissing(e: unknown): boolean {
  const code = getErrnoCode(e)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Official `C$t` — guard preserved raw task entries against deep nesting. */
function exceedsMaxDepth(value: unknown, maxDepth: number): boolean {
  if (typeof value !== 'object' || value === null) return false
  const stack: Array<{ container: object; depth: number }> = [
    { container: value, depth: 1 },
  ]
  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    if (frame.depth > maxDepth) return true
    const children = Array.isArray(frame.container)
      ? frame.container
      : Object.values(frame.container)
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        stack.push({ container: child, depth: frame.depth + 1 })
      }
    }
  }
  return false
}

function skipJsonString(json: string, startQuoteIdx: number): number {
  for (
    let idx = json.indexOf('"', startQuoteIdx + 1);
    idx !== -1;
    idx = json.indexOf('"', idx + 1)
  ) {
    let slashes = 0
    while (json.charCodeAt(idx - 1 - slashes) === 92) slashes++
    if (slashes % 2 === 0) return idx
  }
  return json.length - 1
}

/**
 * Official `MSo` — estimate whether `JSON.stringify(value, null, indent)` fits
 * within `maxBytes` given its compact JSON representation.
 */
function fitsPrettyJsonBudget(
  compactJson: string,
  indent: number,
  maxBytes: number,
): boolean {
  let len = compactJson.length
  let depth = 0
  for (let i = 0; i < compactJson.length && len <= maxBytes; i++) {
    const ch = compactJson.charCodeAt(i)
    if (ch === 34) {
      i = skipJsonString(compactJson, i)
    } else if (ch === 91 || ch === 123) {
      const next = compactJson.charCodeAt(i + 1)
      if (next === 93 || next === 125) {
        i++
      } else {
        len += 1 + indent * ++depth
      }
    } else if (ch === 93 || ch === 125) {
      len += 1 + indent * --depth
    } else if (ch === 44) {
      len += 1 + indent * depth
    } else if (ch === 58) {
      len++
    }
  }
  return len <= maxBytes
}

/**
 * Read and parse .claude/scheduled_tasks.json. Returns an empty task list if the file
 * is missing, empty, or malformed. Tasks with invalid cron strings are
 * silently dropped (logged at debug level) so a single bad entry never
 * blocks the whole file. When `preserved` is supplied, malformed / typoed
 * entries are collected into it so subsequent writes keep them intact.
 */
export async function readCronTasks(
  dir?: string,
  preserved?: unknown[],
): Promise<CronTask[]> {
  const result = await readCronTasksStrict(dir, preserved)
  return result === 'unreadable' ? [] : result
}

/**
 * densable `L8r` — strict variant returning `'unreadable'` when the file exists
 * but cannot be read or parsed as `{ tasks: [...] }`, so writers refuse to
 * clobber an unreadable or corrupted file.
 * When `preserved` is supplied, entries with typos/malformed fields or invalid
 * cron expressions (whose `plugin` field is valid or absent) are appended to
 * `preserved` so saves do not delete them.
 */
const STEP_MINUTES_CRON_RE = /^\*\/\d+ \* \* \* \*$/
const PROMPT_CACHE_TTL_MS = 300_000

/**
 * Official 2.1.328 `D8r` / `ds()` (`chunk@283138841.js @117694`): durable
 * scheduled tasks are unavailable when the session was started with
 * `--project-config-root` (unless an explicit `dir` is passed by the caller).
 */
export function isBlockedByProjectConfigRoot(dir?: string): boolean {
  if (dir !== undefined) return false
  let root: string | undefined
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--project-config-root' && typeof argv[i + 1] === 'string') {
      root = argv[i + 1]
      break
    }
    if (arg?.startsWith('--project-config-root=')) {
      root = arg.slice('--project-config-root='.length)
      break
    }
  }
  return typeof root === 'string' && root.length > 0
}

export async function readCronTasksStrict(
  dir?: string,
  preserved?: unknown[],
): Promise<CronTask[] | 'unreadable'> {
  if (isBlockedByProjectConfigRoot(dir)) return []
  const fs = getFsImplementation()
  const root = dir ?? getProjectRoot()
  const filePath = getCronFilePath(dir)
  const needsChainGuard = !isClaudeConfigDirPath(join(root, '.claude'))
  let raw: string
  try {
    if (needsChainGuard) {
      const claudeDirStat = await lstat(join(root, '.claude')).catch(err => {
        if (isCronFileMissing(err)) return undefined
        throw err
      })
      if (claudeDirStat?.isSymbolicLink()) return 'unreadable'
    }
    const fileStat = needsChainGuard
      ? await lstat(filePath)
      : await stat(filePath)
    if (needsChainGuard && fileStat.isSymbolicLink()) return 'unreadable'
    if (!fileStat.isFile() || fileStat.size > MAX_CRON_FILE_BYTES) {
      return 'unreadable'
    }
    raw = await fs.readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    if (isCronFileMissing(e)) return []
    logError(e)
    return 'unreadable'
  }
  if (raw.trim() === '') return []

  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return 'unreadable'
  const file = parsed as Partial<CronFile>
  if (!Array.isArray(file.tasks)) return 'unreadable'

  const out: CronTask[] = []
  for (const t of file.tasks) {
    const rawRec =
      t !== null && typeof t === 'object'
        ? (t as Record<string, unknown>)
        : undefined
    const hasInvalidPlugin =
      rawRec?.plugin !== undefined && !isValidStoredPluginName(rawRec.plugin)
    const keepList = hasInvalidPlugin ? undefined : preserved
    if (
      !t ||
      typeof t.id !== 'string' ||
      typeof t.cron !== 'string' ||
      typeof t.prompt !== 'string' ||
      typeof t.createdAt !== 'number'
    ) {
      logForDebugging(
        `[ScheduledTasks] skipping malformed task: ${jsonStringify(t)}`,
      )
      keepList?.push(t)
      continue
    }
    if (!parseCronExpression(t.cron)) {
      logForDebugging(
        `[ScheduledTasks] skipping task ${t.id} with invalid cron '${t.cron}'`,
      )
      keepList?.push(t)
      continue
    }
    if (hasInvalidPlugin) {
      logForDebugging(
        `[ScheduledTasks] skipping task ${t.id}: its plugin name fails the rule for a stored name`,
      )
      continue
    }
    out.push({
      id: t.id,
      cron: t.cron,
      prompt: t.prompt,
      createdAt: t.createdAt,
      ...(typeof t.lastFiredAt === 'number'
        ? { lastFiredAt: t.lastFiredAt }
        : {}),
      ...(t.recurring ? { recurring: true } : {}),
      ...(t.permanent ? { permanent: true } : {}),
      // densable mGa: enabled defaults true when omitted
      ...(t.enabled === false ? { enabled: false } : {}),
      ...(typeof t.createdBySessionId === 'string'
        ? { createdBySessionId: t.createdBySessionId }
        : {}),
      ...(typeof t.createdByPid === 'number'
        ? { createdByPid: t.createdByPid }
        : {}),
      ...(typeof t.createdByProcStart === 'string'
        ? { createdByProcStart: t.createdByProcStart }
        : {}),
      ...(typeof t.createdInProject === 'string'
        ? { createdInProject: t.createdInProject }
        : {}),
      ...(typeof t.plugin === 'string' ? { plugin: t.plugin } : {}),
    })
  }
  return out
}

/** densable mGa status label — omitted/undefined treated as enabled. */
export function isCronTaskEnabled(task: Pick<CronTask, 'enabled'>): boolean {
  return task.enabled !== false
}

/**
 * Sync check for whether the cron file has any valid tasks. Used by
 * cronScheduler.start() to decide whether to auto-enable. One file read.
 */
export function hasCronTasksSync(dir?: string): boolean {
  if (isBlockedByProjectConfigRoot(dir)) return false
  const root = dir ?? getProjectRoot()
  const filePath = getCronFilePath(dir)
  const needsChainGuard = !isClaudeConfigDirPath(join(root, '.claude'))
  let raw: string
  try {
    if (needsChainGuard) {
      // eslint-disable-next-line custom-rules/no-sync-fs -- called once from cronScheduler.start()
      const claudeDirStat = lstatSync(join(root, '.claude'))
      if (claudeDirStat.isSymbolicLink()) return false
    }
    // eslint-disable-next-line custom-rules/no-sync-fs -- called once from cronScheduler.start()
    const fileStat = needsChainGuard ? lstatSync(filePath) : statSync(filePath)
    if (needsChainGuard && fileStat.isSymbolicLink()) return false
    if (!fileStat.isFile() || fileStat.size > MAX_CRON_FILE_BYTES) {
      return false
    }
    // eslint-disable-next-line custom-rules/no-sync-fs -- called once from cronScheduler.start()
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return false
  }
  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return false
  const tasks = (parsed as Partial<CronFile>).tasks
  return Array.isArray(tasks) && tasks.length > 0
}

/**
 * densable H8r — overwrite .claude/scheduled_tasks.json with the given tasks.
 * Creates .claude/ if missing. Empty task list writes an empty file (rather
 * than deleting) so the file watcher sees a change event on last-task-removed.
 *
 * Project roots: YNn chain guard + M6 O_NOFOLLOW (checkParentDir + staging).
 * Claude config home `.claude`: allowSymlink (VEt) — user-scope may use links.
 * Preserved malformed/typoed entries are appended when within depth & 1 MiB budget.
 */
export async function writeCronTasks(
  tasks: CronTask[],
  dir?: string,
  preserved: unknown[] = [],
): Promise<void> {
  if (isBlockedByProjectConfigRoot(dir)) {
    throw new Error(
      'Durable scheduled tasks are unavailable in a session started with --project-config-root',
    )
  }
  const root = dir ?? getProjectRoot()
  const claudeDir = join(root, '.claude')
  // densable: needsChainGuard = !VEt(join(root, ".claude"))
  const needsChainGuard = !isClaudeConfigDirPath(claudeDir)
  if (needsChainGuard) {
    await assertDirChainReal(root, claudeDir)
  }
  await mkdir(claudeDir, { recursive: true })
  // Strip the runtime-only `durable` flag — everything on disk is durable
  // by definition, and keeping the flag out means readCronTasks() naturally
  // yields durable: undefined without having to set it explicitly.
  const cleanTasks = tasks.map(({ durable: _durable, ...rest }) => rest)
  const safePreserved = preserved.filter(
    entry => !exceedsMaxDepth(entry, MAX_PRESERVED_DEPTH),
  )
  const combined = { tasks: [...cleanTasks, ...safePreserved] }
  const compact = jsonStringify(combined)
  const utf8Overhead = Buffer.byteLength(compact) - compact.length
  const body = fitsPrettyJsonBudget(
    compact,
    2,
    MAX_CRON_FILE_BYTES - utf8Overhead - 1,
  )
    ? combined
    : { tasks: cleanTasks }
  await writeFileAndFlush(
    getCronFilePath(root),
    jsonStringify(body, null, 2) + '\n',
    {
      encoding: 'utf-8',
      allowSymlink: !needsChainGuard,
      checkParentDir: needsChainGuard,
      stagingDir: join(claudeDir, CLAUDE_ATOMIC_STAGING_LEAF),
    },
  )
}

/**
 * Append a task. Returns the generated id. Caller is responsible for having
 * already validated the cron string (the tool does this via validateInput).
 *
 * When `durable` is false the task is held in process memory only
 * (bootstrap/state.ts) — it fires on schedule this session but is never
 * written to .claude/scheduled_tasks.json and dies with the process. The
 * scheduler merges session tasks into its tick loop directly, so no file
 * change event is needed.
 */
const fallbackCronTasksHost: object = {}
const cronTasksStateByHost = new HostSlot<{
  cachedOwnProcStartToken: string | undefined
}>(() => ({ cachedOwnProcStartToken: undefined }))

function getCronTasksHostState(): {
  cachedOwnProcStartToken: string | undefined
} {
  try {
    const host = getBootstrapSessionHost()
    if (host) return cronTasksStateByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return cronTasksStateByHost.of(fallbackCronTasksHost)
}

/**
 * Gold `FTe()` — memoized process start token (`NTe.token ?? NTe.set(plt(process.pid))`).
 */
export function getOwnProcStartToken(): string | undefined {
  const state = getCronTasksHostState()
  return (state.cachedOwnProcStartToken ??= getProcessStartTime(process.pid))
}

/**
 * Gold `NTe.token` — peek cached process start token without spawning `ps`.
 */
export function peekOwnProcStartToken(): string | undefined {
  return getCronTasksHostState().cachedOwnProcStartToken
}

export async function addCronTask(
  cron: string,
  prompt: string,
  recurring: boolean,
  durable: boolean,
  agentId?: string,
  createdAtMs: number = Date.now(),
  plugin?: string,
): Promise<string> {
  const validPlugin =
    plugin !== undefined && isValidStoredPluginName(plugin) ? plugin : undefined
  // Short ID — 8 hex chars is plenty for MAX_JOBS=50, avoids slice/prefix
  // juggling between the tool layer (shows short IDs) and disk.
  const id = randomUUID().slice(0, 8)
  const task = {
    id,
    cron,
    prompt,
    createdAt: createdAtMs,
    ...(recurring ? { recurring: true } : {}),
    ...(validPlugin !== undefined ? { plugin: validPlugin } : {}),
  }
  if (!durable) {
    addSessionCronTask({ ...task, ...(agentId ? { agentId } : {}) })
    return id
  }
  const preserved: unknown[] = []
  const tasks = await readCronTasksStrict(undefined, preserved)
  if (tasks === 'unreadable') {
    throw new Error(UNREADABLE_TASKS_ERROR)
  }
  tasks.push({
    ...task,
    createdBySessionId: getSessionId(),
    createdByPid: process.pid,
    createdByProcStart: getOwnProcStartToken(),
    createdInProject: getProjectRoot(),
  })
  await writeCronTasks(tasks, undefined, preserved)
  return id
}

/**
 * Remove tasks by id. No-op if none match (e.g. another session raced us).
 * Used for both fire-once cleanup and explicit CronDelete.
 *
 * When called with `dir` undefined (REPL path), also sweeps the in-memory
 * session store — the caller doesn't know which store an id lives in.
 * Daemon callers pass `dir` explicitly; they have no session, and the
 * `dir !== undefined` guard keeps this function from touching bootstrap
 * state on that path (tests enforce this).
 */
export async function removeCronTasks(
  ids: string[],
  dir?: string,
): Promise<void> {
  if (ids.length === 0) return
  // Sweep session store first. If every id was accounted for there, we're
  // done — skip the file read entirely. removeSessionCronTasks is a no-op
  // (returns 0) on miss, so pre-existing durable-delete paths fall through
  // without allocating.
  if (dir === undefined && removeSessionCronTasks(ids) === ids.length) {
    return
  }
  const idSet = new Set(ids)
  const preserved: unknown[] = []
  const tasks = await readCronTasksStrict(dir, preserved)
  if (tasks === 'unreadable') {
    throw new Error(UNREADABLE_TASKS_ERROR)
  }
  const remaining = tasks.filter(t => !idSet.has(t.id))
  if (remaining.length === tasks.length) return
  await writeCronTasks(remaining, dir, preserved)
}

/**
 * Stamp `lastFiredAt` on the given recurring tasks and write back. Batched
 * so N fires in one scheduler tick = one read-modify-write, not N. Only
 * touches file-backed tasks — session tasks die with the process, no point
 * persisting their fire time. No-op if none of the ids match (task was
 * deleted between fire and write — e.g. user ran CronDelete mid-tick).
 *
 * Scheduler lock means at most one process calls this; chokidar picks up
 * the write and triggers a reload which re-seeds `nextFireAt` from the
 * just-written `lastFiredAt` — idempotent (same computation, same answer).
 */
export async function markCronTasksFired(
  ids: string[],
  firedAt: number,
  dir?: string,
): Promise<void> {
  if (ids.length === 0) return
  const idSet = new Set(ids)
  const preserved: unknown[] = []
  const tasks = await readCronTasksStrict(dir, preserved)
  if (tasks === 'unreadable') return
  let changed = false
  for (const t of tasks) {
    if (idSet.has(t.id)) {
      t.lastFiredAt = firedAt
      changed = true
    }
  }
  if (!changed) return
  await writeCronTasks(tasks, dir, preserved)
}

/**
 * densable mGa Enable/Disable — flip `enabled` and persist.
 * Returns the new enabled state, or null if id not found.
 */
export async function toggleCronTaskEnabled(
  id: string,
  dir?: string,
): Promise<boolean | null> {
  const preserved: unknown[] = []
  const tasks = await readCronTasksStrict(dir, preserved)
  if (tasks === 'unreadable') {
    throw new Error(UNREADABLE_TASKS_ERROR)
  }
  const idx = tasks.findIndex(t => t.id === id)
  if (idx < 0) return null
  const current = isCronTaskEnabled(tasks[idx]!)
  const next = !current
  const prev = tasks[idx]!
  if (next) {
    // enabled: omit flag (default true on read)
    const { enabled: _drop, ...rest } = prev
    tasks[idx] = rest
  } else {
    tasks[idx] = { ...prev, enabled: false }
  }
  await writeCronTasks(tasks, dir, preserved)
  return next
}

/**
 * densable hGa save — upsert file-backed scheduled task by id.
 * Preserves createdAt/lastFiredAt/permanent when updating.
 */
export async function upsertCronTask(
  input: {
    id: string
    cron: string
    prompt: string
    recurring?: boolean
    enabled?: boolean
  },
  dir?: string,
): Promise<'created' | 'updated'> {
  const preserved: unknown[] = []
  const tasks = await readCronTasksStrict(dir, preserved)
  if (tasks === 'unreadable') {
    throw new Error(UNREADABLE_TASKS_ERROR)
  }
  const idx = tasks.findIndex(t => t.id === input.id)
  if (idx >= 0) {
    const prev = tasks[idx]!
    tasks[idx] = {
      ...prev,
      cron: input.cron,
      prompt: input.prompt,
      ...(input.recurring !== undefined
        ? input.recurring
          ? { recurring: true }
          : { recurring: undefined }
        : {}),
      ...(input.enabled === false
        ? { enabled: false }
        : input.enabled === true
          ? { enabled: undefined }
          : {}),
    }
    // clean optional flags
    const cleaned = { ...tasks[idx]! }
    if (cleaned.recurring !== true) delete cleaned.recurring
    if (cleaned.enabled !== false) delete cleaned.enabled
    tasks[idx] = cleaned
    await writeCronTasks(tasks, dir, preserved)
    return 'updated'
  }
  const task: CronTask = {
    id: input.id,
    cron: input.cron,
    prompt: input.prompt,
    createdAt: Date.now(),
    ...(input.recurring ? { recurring: true } : {}),
    ...(input.enabled === false ? { enabled: false } : {}),
  }
  tasks.push(task)
  await writeCronTasks(tasks, dir, preserved)
  return 'created'
}

/**
 * File-backed tasks + session-only tasks, merged. Session tasks get
 * `durable: false` so callers can distinguish them. File tasks are
 * returned as-is (durable undefined → truthy).
 *
 * Only merges when `dir` is undefined — daemon callers (explicit `dir`)
 * have no session store to merge with.
 */
export async function listAllCronTasks(dir?: string): Promise<CronTask[]> {
  const fileTasks = await readCronTasks(dir)
  if (dir !== undefined) return fileTasks
  const sessionTasks = getSessionCronTasks().map(t => ({
    ...t,
    durable: false as const,
  }))
  return [...fileTasks, ...sessionTasks]
}

/**
 * Next fire time in epoch ms for a cron string, strictly after `fromMs`.
 * Returns null if invalid or no match in the next 366 days.
 */
export function nextCronRunMs(
  cron: string,
  fromMs: number,
  opts?: { oneShot?: boolean },
): number | null {
  const fields = parseCronExpression(cron)
  if (!fields) return null
  const next = computeNextCronRun(fields, new Date(fromMs), opts)
  return next ? next.getTime() : null
}

/**
 * Cron scheduler tuning knobs. Sourced at runtime from the
 * `tengu_kairos_cron_config` GrowthBook JSON config (see cronJitterConfig.ts)
 * so ops can adjust behavior fleet-wide without shipping a client build.
 * Defaults here preserve the pre-config behavior exactly.
 */
export type CronJitterConfig = {
  /** Recurring-task forward delay as a fraction of the interval between fires. */
  recurringFrac: number
  /** Upper bound on recurring forward delay regardless of interval length. */
  recurringCapMs: number
  /** One-shot backward lead: maximum ms a task may fire early. */
  oneShotMaxMs: number
  /**
   * One-shot backward lead: minimum ms a task fires early when the minute-mod
   * gate matches. 0 = taskIds hashing near zero fire on the exact mark. Raise
   * this to guarantee nobody lands on the wall-clock boundary.
   */
  oneShotFloorMs: number
  /**
   * Jitter fires landing on minutes where `minute % N === 0`. 30 → :00/:30
   * (the human-rounding hotspots). 15 → :00/:15/:30/:45. 1 → every minute.
   */
  oneShotMinuteMod: number
  /**
   * Recurring tasks auto-expire this many ms after creation (unless marked
   * `permanent`). Cron is the primary driver of multi-day sessions (p99
   * uptime 61min → 53h post-#19931), and unbounded recurrence lets Tier-1
   * heap leaks compound indefinitely. The default (7 days) covers "check
   * my PRs every hour this week" workflows while capping worst-case
   * session lifetime. Permanent tasks (assistant mode's catch-up/
   * morning-checkin/dream) never age out — they can't be recreated if
   * deleted because install.ts's writeIfMissing() skips existing files.
   *
   * `0` = unlimited (tasks never auto-expire).
   */
  recurringMaxAgeMs: number
  /**
   * densable `she.cacheLeadMs` — ScheduleWakeup NU_ snaps fire times earlier
   * by this many ms when delay ≤ 5m prompt-cache TTL. Default 15000.
   */
  cacheLeadMs?: number
}

export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
  recurringFrac: 0.5,
  recurringCapMs: 30 * 60 * 1000,
  oneShotMaxMs: 90 * 1000,
  oneShotFloorMs: 0,
  oneShotMinuteMod: 30,
  recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  // densable she.cacheLeadMs
  cacheLeadMs: 15_000,
}

/**
 * taskId is an 8-hex-char UUID slice (see {@link addCronTask}) → parse as
 * u32 → [0, 1). Stable across restarts, uniformly distributed across the
 * fleet. Non-hex ids (hand-edited JSON) fall back to 0 = no jitter.
 */
function jitterFrac(taskId: string): number {
  const frac = parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000
  return Number.isFinite(frac) ? frac : 0
}

/**
 * Same as {@link nextCronRunMs}, plus a deterministic per-task delay to
 * avoid a thundering herd when many sessions schedule the same cron string
 * (e.g. `0 * * * *` → everyone hits inference at :00).
 *
 * The delay is proportional to the current gap between fires
 * ({@link CronJitterConfig.recurringFrac}, capped at
 * {@link CronJitterConfig.recurringCapMs}). For step-minute cron expressions
 * straddling the 5-minute prompt-cache TTL, snaps `cacheLeadMs` earlier to
 * keep the prompt cache warm (official 2.1.328 `Rtr`).
 *
 * Only used for recurring tasks. One-shot tasks use
 * {@link oneShotJitteredNextCronRunMs} (backward jitter, minute-gated).
 */
export function jitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
  const t1 = nextCronRunMs(cron, fromMs)
  if (t1 === null) return null
  const t2 = nextCronRunMs(cron, t1)
  // No second match in the next year (e.g. pinned date) → nothing to
  // proportion against, and near-certainly not a herd risk. Fire on t1.
  if (t2 === null) return t1
  const gap = t2 - t1
  const cacheLeadMs = cfg.cacheLeadMs ?? 0
  if (
    STEP_MINUTES_CRON_RE.test(cron) &&
    cacheLeadMs > 0 &&
    cacheLeadMs < gap &&
    gap >= PROMPT_CACHE_TTL_MS &&
    gap - cacheLeadMs < PROMPT_CACHE_TTL_MS
  ) {
    return fromMs + gap - cacheLeadMs
  }
  const jitter = Math.min(
    jitterFrac(taskId) * cfg.recurringFrac * gap,
    cfg.recurringCapMs,
  )
  return t1 + jitter
}

/**
 * Same as {@link nextCronRunMs}, minus a deterministic per-task lead time
 * when the fire time lands on a minute boundary matching
 * {@link CronJitterConfig.oneShotMinuteMod}.
 *
 * One-shot tasks are user-pinned ("remind me at 3pm") so delaying them
 * breaks the contract — but firing slightly early is invisible and spreads
 * the inference spike from everyone picking the same round wall-clock time.
 * At defaults (mod 30, max 90 s, floor 0) only :00 and :30 get jitter,
 * because humans round to the half-hour.
 *
 * During an incident, ops can push `tengu_kairos_cron_config` with e.g.
 * `{oneShotMinuteMod: 15, oneShotMaxMs: 300000, oneShotFloorMs: 30000}` to
 * spread :00/:15/:30/:45 fires across a [t-5min, t-30s] window — every task
 * gets at least 30 s of lead, so nobody lands on the exact mark.
 *
 * Checks the computed fire time rather than the cron string so
 * `0 15 * * *`, step expressions, and `0,30 9 * * *` all get jitter
 * when they land on a matching minute. Clamped to `fromMs` so a task created
 * inside its own jitter window doesn't fire before it was created.
 */
export function oneShotJitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
  const t1 = nextCronRunMs(cron, fromMs, { oneShot: true })
  if (t1 === null) return null
  // Cron resolution is 1 minute → computed times always have :00 seconds,
  // so a minute-field check is sufficient to identify the hot marks.
  // getMinutes() (local), not getUTCMinutes(): cron is evaluated in local
  // time, and "user picked a round time" means round in *their* TZ. In
  // half-hour-offset zones (India UTC+5:30) local :00 is UTC :30 — the
  // UTC check would jitter the wrong marks.
  if (new Date(t1).getMinutes() % cfg.oneShotMinuteMod !== 0) return t1
  // floor + frac * (max - floor) → uniform over [floor, max). With floor=0
  // this reduces to the original frac * max. With floor>0, even a taskId
  // hashing to 0 gets `floor` ms of lead — nobody fires on the exact mark.
  const lead =
    cfg.oneShotFloorMs +
    jitterFrac(taskId) * (cfg.oneShotMaxMs - cfg.oneShotFloorMs)
  // t1 > fromMs is guaranteed by nextCronRunMs (strictly after), so the
  // max() only bites when the task was created inside its own lead window.
  return Math.max(t1 - lead, fromMs)
}

/**
 * Compute the scheduled next fire epoch ms for a cron task, including the
 * scheduler's per-job jitter offset (official `xbt`).
 */
export function nextScheduledFireAtMs(
  task: Pick<
    CronTask,
    'id' | 'cron' | 'createdAt' | 'lastFiredAt' | 'recurring'
  >,
  cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
  return task.recurring
    ? jitteredNextCronRunMs(
        task.cron,
        task.lastFiredAt ?? task.createdAt,
        task.id,
        cfg,
      )
    : oneShotJitteredNextCronRunMs(task.cron, task.createdAt, task.id, cfg)
}

/**
 * A task is "missed" when its next scheduled run (computed from createdAt)
 * is in the past. Surfaced to the user at startup. Works for both one-shot
 * and recurring tasks — a recurring task whose window passed while Claude
 * was down is still "missed".
 */
export function findMissedTasks(tasks: CronTask[], nowMs: number): CronTask[] {
  return tasks.filter(t => {
    const next = nextCronRunMs(t.cron, t.createdAt, { oneShot: !t.recurring })
    return next !== null && next < nowMs
  })
}
