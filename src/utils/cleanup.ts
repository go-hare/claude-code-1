import type { Dirent } from 'fs'
import * as fs from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import {
  type BgJobState,
  getJobsBaseDir,
  isBhSettled,
} from '../daemon/jobState.js'
import { errorMessage, isENOENT } from './errors.js'
import {
  isProcessRunning,
  processLstartMatches,
} from './genericProcessUtils.js'
import { logEvent } from '../services/analytics/index.js'
import { CACHE_PATHS } from './cachePaths.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { type FsOperations, getFsImplementation } from './fsOperations.js'
import { cleanupOldImageCaches } from './imageStore.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { cleanupOldVersions } from './nativeInstaller/index.js'
import { cleanupOldPastes } from './pasteStore.js'
import { getProjectsDir } from './sessionPaths.js'
import {
  LITE_READ_BUF_SIZE,
  readHeadAndTail,
} from './sessionStoragePortable.js'
import { getSettingsWithAllErrors } from './settings/allErrors.js'
import {
  getSecuritySensitiveSetting,
  getSettings_DEPRECATED,
  getSettingsForSource,
  rawSettingsContainsKey,
} from './settings/settings.js'
import { TOOL_RESULTS_SUBDIR } from './toolResultStorage.js'
import {
  cleanupStaleAgentWorktrees,
  reapJobWorktreeIfSafe,
} from './worktree.js'

const DEFAULT_CLEANUP_PERIOD_DAYS = 30

/**
 * densable `$te` — keys that block the retention sweep when settings
 * errors make their value unknowable or explicitly set-but-invalid.
 */
export const CLEANUP_PERIOD_SETTINGS_KEYS = [
  'cleanupPeriodDays',
  'desktopSessionCleanupPeriodDays',
] as const

/** densable `Ce` — desktop ceiling default; 0 = no ceiling. */
const DEFAULT_DESKTOP_SESSION_CLEANUP_PERIOD_DAYS = 0

/** densable `lyn` — parent-managed errors are ignored by `xe`. */
const PARENT_MANAGED_SETTINGS_FILE = 'parent managed settings'

/**
 * densable `Ae` — desktop-host transcript ceiling cutoff.
 * `tx("desktopSessionCleanupPeriodDays")[0] ?? Ce`; 0 → null (no ceiling).
 */
export function getDesktopSessionCleanupCutoff(): Date | null {
  const days =
    getSecuritySensitiveSetting('desktopSessionCleanupPeriodDays')[0] ??
    DEFAULT_DESKTOP_SESSION_CLEANUP_PERIOD_DAYS
  if (days === 0) return null
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * densable `xe` — org policy or settings-error skip for the desktop
 * exemption. `policySettings.cleanupPeriodDays !== undefined` → true;
 * else any non-parent-managed error whose path is in `$te` or whose
 * severity is not `"warning"`.
 */
export function isDesktopSessionCleanupBlocked(): boolean {
  if (getSettingsForSource('policySettings')?.cleanupPeriodDays !== undefined) {
    return true
  }
  return getSettingsWithAllErrors().errors.some(
    error =>
      error.file !== PARENT_MANAGED_SETTINGS_FILE &&
      (CLEANUP_PERIOD_SETTINGS_KEYS.some(key => key === error.path) ||
        error.severity !== 'warning'),
  )
}

/**
 * densable Sgn set `r` @179726935 — desktop-host jsonl `entrypoint` values.
 * Cowork hosts write `local-agent`; do not invent a cowork ident.
 */
const DESKTOP_HOST_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/** densable `U` — sibling of `<id>.jsonl`. Reader only; no host writer. */
const DESKTOP_RELEASED_SUFFIX = '.desktop-released.json'

/** densable `Ie` — `readFileFdGated` cap for the release marker. */
const DESKTOP_RELEASED_MAX_BYTES = 4096

/** densable `Fe` — session id on an `agent-*.jsonl` parent marker. */
const DESKTOP_RELEASE_SESSION_ID = /^[0-9A-Za-z_-]{1,64}$/

/**
 * densable `Sgn` @179727060 — `r.has(e==="local_agent"?"local-agent":e)`.
 */
export function isDesktopHostEntrypoint(entrypoint: string): boolean {
  return DESKTOP_HOST_ENTRYPOINTS.has(
    entrypoint === 'local_agent' ? 'local-agent' : entrypoint,
  )
}

type DesktopReleaseVerdict = 'none' | 'release-now' | 'grace'

/** densable `X` — strip `.jsonl` (6 chars) and append `U`. */
function desktopReleasedPathForJsonl(jsonlPath: string): string {
  return jsonlPath.slice(0, -6) + DESKTOP_RELEASED_SUFFIX
}

/**
 * densable `BY` @179198018 — first complete jsonl line with string field `n`.
 */
function extractJsonlStringFieldFirst(
  text: string,
  field: string,
): string | undefined {
  const needle = `"${field}":`
  let offset = 0
  while (offset < text.length) {
    const nl = text.indexOf('\n', offset)
    const line = nl < 0 ? text.slice(offset) : text.slice(offset, nl)
    offset = nl < 0 ? text.length : nl + 1
    if (!line.includes(needle)) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed === 'object' && parsed !== null) {
        const value = (parsed as Record<string, unknown>)[field]
        if (typeof value === 'string') return value
      }
    } catch {
      // truncated / non-JSON line
    }
  }
  return undefined
}

/**
 * densable `U` / `i4t(e,n)` @179197675 — last complete jsonl line with
 * string field `n` (no type filter).
 */
function extractJsonlStringFieldLast(
  text: string,
  field: string,
): string | undefined {
  const needle = `"${field}":`
  let end = text.length
  while (end > 0) {
    const prevNl = text.lastIndexOf('\n', end - 1)
    const line = text.slice(prevNl + 1, end)
    end = prevNl
    if (line.includes(needle)) {
      try {
        const parsed: unknown = JSON.parse(line)
        if (typeof parsed === 'object' && parsed !== null) {
          const value = (parsed as Record<string, unknown>)[field]
          if (typeof value === 'string') return value
        }
      } catch {
        // truncated / non-JSON line
      }
    }
    if (prevNl < 0) break
  }
  return undefined
}

/** densable `FSn` — drop the incomplete first line of a mid-file tail. */
function dropIncompleteLeadingLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl >= 0 ? text.slice(nl + 1) : ''
}

/**
 * densable `ie` @191903239 — `{reason?: string}` on `.desktop-released.json`.
 * `delete` → release-now; `archive` + mtime < regular cutoff → release-now;
 * `archive` still inside the regular window → grace.
 */
async function readDesktopReleaseVerdict(
  markerPath: string,
  fsImpl: FsOperations,
  regularCutoff: Date,
): Promise<DesktopReleaseVerdict> {
  try {
    const stats = await fsImpl.stat(markerPath)
    if (!stats.isFile()) return 'none'
    const buf = await fsImpl.readFileBytes(
      markerPath,
      DESKTOP_RELEASED_MAX_BYTES,
    )
    const parsed: unknown = JSON.parse(buf.toString('utf8'))
    const reason =
      typeof parsed === 'object' &&
      parsed !== null &&
      'reason' in parsed &&
      typeof (parsed as { reason?: unknown }).reason === 'string'
        ? (parsed as { reason: string }).reason
        : undefined
    if (reason === 'delete') return 'release-now'
    if (reason === 'archive') {
      return stats.mtime < regularCutoff ? 'release-now' : 'grace'
    }
    return 'none'
  } catch {
    return 'none'
  }
}

/**
 * densable Ior skipIf `y` — true means skip delete (desktop exemption).
 * Ceiling (`Ae` / `w`) is a hard cap before the release-marker grace.
 */
export async function shouldExemptDesktopSessionTranscript(
  filePath: string,
  stats: { mtime: Date; size: number },
  regularCutoff: Date,
  desktopCutoff: Date | null,
  fsImpl: FsOperations,
  headTailBuf: Buffer,
): Promise<boolean> {
  if (desktopCutoff !== null && stats.mtime < desktopCutoff) return false
  const companion = desktopReleasedPathForJsonl(filePath)
  const released = await readDesktopReleaseVerdict(
    companion,
    fsImpl,
    regularCutoff,
  )
  if (released === 'release-now') return false
  if (released === 'grace') return true
  if (stats.size === 0) {
    const sessionDir = filePath.slice(0, -6)
    const isSessionDir = await fsImpl
      .stat(sessionDir)
      .then(st => st.isDirectory())
      .catch(() => false)
    if (!isSessionDir) return true
  }
  const { head, tail } = await readHeadAndTail(
    filePath,
    stats.size,
    headTailBuf,
  )
  if (head === '' && stats.size > 0) {
    await fsImpl.stat(filePath)
    throw new Error(
      'transient read failure while classifying a transcript for the desktop retention exemption',
    )
  }
  const tailForParse =
    stats.size > LITE_READ_BUF_SIZE ? dropIncompleteLeadingLine(tail) : tail
  const headEntrypoint = extractJsonlStringFieldFirst(head, 'entrypoint')
  const tailEntrypoint = extractJsonlStringFieldLast(tailForParse, 'entrypoint')
  if (
    !(
      (headEntrypoint !== undefined &&
        isDesktopHostEntrypoint(headEntrypoint)) ||
      (tailEntrypoint !== undefined && isDesktopHostEntrypoint(tailEntrypoint))
    )
  ) {
    return false
  }
  const sessionId = basename(filePath).startsWith('agent-')
    ? (extractJsonlStringFieldFirst(head, 'sessionId') ??
      extractJsonlStringFieldLast(tailForParse, 'sessionId'))
    : undefined
  if (sessionId !== undefined && DESKTOP_RELEASE_SESSION_ID.test(sessionId)) {
    const parentMarker = join(
      dirname(filePath),
      `${sessionId}${DESKTOP_RELEASED_SUFFIX}`,
    )
    if (parentMarker !== companion) {
      if (
        (await readDesktopReleaseVerdict(
          parentMarker,
          fsImpl,
          regularCutoff,
        )) === 'release-now'
      ) {
        return false
      }
    }
  }
  return true
}

/**
 * densable `WMu` — project-level reserved entry names that are NOT session
 * directories. Session cleanup must not walk / rmdir these (2.1.228 #8 —
 * project memory folder wiped when treated as a session).
 */
export const PROJECT_LEVEL_RESERVED_ENTRIES = new Set([
  'memory',
  'tiny_memory',
  'bagel',
  'bridge-pointer.json',
  '.session-aliases',
])

/** densable `KMu` / part of `U0m` — reserved project-level name. */
export function isProjectLevelReservedEntry(name: string): boolean {
  const lower = name.toLowerCase()
  if (PROJECT_LEVEL_RESERVED_ENTRIES.has(lower)) return true
  // densable kUt also checks prefix before ':' for drive-like forms
  const colon = lower.indexOf(':')
  if (colon !== -1) {
    const head = lower.slice(0, colon)
    if (PROJECT_LEVEL_RESERVED_ENTRIES.has(head)) return true
  }
  return false
}

function getCutoffDate(): Date {
  const settings = getSettings_DEPRECATED() || {}
  const cleanupPeriodDays =
    settings.cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS
  const cleanupPeriodMs = cleanupPeriodDays * 24 * 60 * 60 * 1000
  return new Date(Date.now() - cleanupPeriodMs)
}

/**
 * densable D — retention cutoff. `cleanupPeriodDays===0` → null (no sweep).
 */
function getRetentionCutoff(maxAgeDays?: number): Date | null {
  const settings = getSettings_DEPRECATED() || {}
  let days = settings.cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS
  if (days === 0) return null
  if (maxAgeDays !== undefined && maxAgeDays < days) {
    days = maxAgeDays
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/** densable `ie("policySettings")?.cleanupPeriodDays!==void 0` */
function hasExplicitCleanupPeriodDays(): boolean {
  return getSettings_DEPRECATED()?.cleanupPeriodDays !== undefined
}

/** densable te(f) — job is settled/eligible for folder removal + Slu. */
function isJobSweepSettled(state: BgJobState | null): boolean {
  return state !== null && isBhSettled(state)
}

/**
 * densable rt(jobDir) — state.json. ENOENT → null; other IO throws so skipIf
 * keeps the folder (official `[cleanup] jobs/${gt}: job state read threw`).
 */
async function readJobStateForRetentionSweep(
  jobDir: string,
): Promise<BgJobState | null> {
  try {
    const raw = await fs.readFile(join(jobDir, 'state.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as BgJobState
  } catch (error) {
    if (isENOENT(error)) return null
    throw error
  }
}

/** densable jobs-module `I` — pins.json / roster.json file cap. */
const PINS_JSON_MAX_BYTES = 8_388_608

/** densable T.jobPins() — storageV5 key, not the disk path. */
const JOB_PINS_STORAGE_KEY = { namespace: 'jobsRoot', file: 'pins' } as const

/** densable Dt() pins screen — per-path ok/refused. */
const pinsScreens = new Map<string, string>()

type StorageV5PinsHost = {
  statMeta: (
    key: unknown,
  ) => Promise<
    | { ok: true; value: { size: number } }
    | { ok: false; error: { code: string } }
  >
  readText: (
    reqs: Array<{ key: unknown; offset: number; length: number }>,
  ) => Promise<
    | {
        ok: true
        value: {
          items: Array<{
            found: boolean
            totalBytes: number
            value?: string
          }>
        }
      }
    | { ok: false }
  >
}

/**
 * densable Ce / parse pins.json body.
 */
function parsePinnedJobShorts(raw: string | undefined): Set<string> {
  if (raw === undefined || raw.length > PINS_JSON_MAX_BYTES) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((s): s is string => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

/** densable D() — pins.json under config home; also ot screenKey. */
function pinsJsonPath(): string {
  return join(getClaudeConfigHomeDir(), 'pins.json')
}

/**
 * densable te — heal a non-file (or oversized when evenRegular) pins.json.
 */
async function healPinsJson(opts?: {
  evenRegular?: boolean
}): Promise<boolean> {
  const path = pinsJsonPath()
  const st = await fs.stat(path).catch(() => undefined)
  if (
    st === undefined ||
    (st.isFile() && !(opts?.evenRegular && st.size > PINS_JSON_MAX_BYTES))
  ) {
    return false
  }
  await fs.rm(path, { recursive: true, force: true }).catch(() => {})
  return true
}

/**
 * densable ot @207753120 — storageV5 read of T.jobPins() with cap + screens.
 */
async function readPinsViaStorageV5(
  storage: StorageV5PinsHost,
): Promise<string | null> {
  const key = JOB_PINS_STORAGE_KEY
  const screenKey = pinsJsonPath()
  if (pinsScreens.get(screenKey) !== 'ok') {
    const meta = await storage.statMeta(key)
    if (!meta.ok) {
      if (meta.error.code !== 'NotFound') {
        pinsScreens.set(screenKey, 'refused')
        await healPinsJson()
      }
      return null
    }
    if (meta.value.size > PINS_JSON_MAX_BYTES) {
      pinsScreens.set(screenKey, 'refused')
      return null
    }
    pinsScreens.set(screenKey, 'ok')
  }
  const read = await storage.readText([
    { key, offset: 0, length: PINS_JSON_MAX_BYTES + 1 },
  ])
  if (!read.ok) {
    pinsScreens.delete(screenKey)
    await healPinsJson()
    return null
  }
  const item = read.value.items[0]
  if (!item?.found) return null
  if (item.totalBytes > PINS_JSON_MAX_BYTES) {
    pinsScreens.set(screenKey, 'refused')
    return null
  }
  return item.value ?? null
}

/** densable er(e) @207762924 */
async function readPinnedJobShortsFromStorageV5(
  storageV5: unknown,
): Promise<Set<string>> {
  const raw = await readPinsViaStorageV5(storageV5 as StorageV5PinsHost)
  return parsePinnedJobShorts(raw ?? undefined)
}

/**
 * densable Fe / cleanup `nt` @207762666.
 * `if (e) return er(e)`; else disk pins.json.
 */
async function readPinnedJobShorts(storageV5?: unknown): Promise<Set<string>> {
  if (storageV5) return readPinnedJobShortsFromStorageV5(storageV5)
  const pinsPath = pinsJsonPath()
  try {
    const st = await fs.stat(pinsPath)
    if (!st.isFile() || st.size > PINS_JSON_MAX_BYTES) {
      if (!st.isFile()) {
        await fs.rm(pinsPath, { recursive: true, force: true }).catch(() => {})
      }
      return new Set()
    }
    return parsePinnedJobShorts(await fs.readFile(pinsPath, 'utf-8'))
  } catch (error) {
    if (isENOENT(error)) {
      await fs.writeFile(pinsPath, '[]').catch((writeError: unknown) => {
        if (!isENOENT(writeError)) {
          logForDebugging(
            `[cleanup] pins.json create failed: ${errorMessage(writeError)}`,
            { level: 'error' },
          )
        }
      })
      return new Set()
    }
    return new Set()
  }
}

/**
 * densable zr roster exclude — live `daemon/roster.json` worker shorts.
 * Official `Ne(pid, procStart?)` = kill0 + start-token match.
 */
async function liveRosterJobShorts(): Promise<{
  exclude: Set<string>
  rosterParsed: boolean
  liveWorkers: boolean
}> {
  const exclude = new Set<string>()
  let rosterParsed = false
  let liveWorkers = false
  const rosterPath = join(getClaudeConfigHomeDir(), 'daemon', 'roster.json')
  try {
    const st = await fs.lstat(rosterPath)
    if (!st.isFile() || st.size > PINS_JSON_MAX_BYTES) {
      return { exclude, rosterParsed, liveWorkers }
    }
    const parsed: unknown = JSON.parse(await fs.readFile(rosterPath, 'utf-8'))
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('workers' in parsed)
    ) {
      return { exclude, rosterParsed, liveWorkers }
    }
    const workers = (parsed as { workers?: unknown }).workers
    if (workers === null || typeof workers !== 'object') {
      return { exclude, rosterParsed, liveWorkers }
    }
    rosterParsed = true
    for (const [short, entry] of Object.entries(
      workers as Record<string, unknown>,
    )) {
      if (entry === null || typeof entry !== 'object' || !('pid' in entry)) {
        continue
      }
      const pid = (entry as { pid?: unknown }).pid
      const procStart =
        'procStart' in entry &&
        typeof (entry as { procStart?: unknown }).procStart === 'string'
          ? (entry as { procStart: string }).procStart
          : undefined
      if (typeof pid === 'number' && pid > 1 && isProcessRunning(pid)) {
        if (await processLstartMatches(pid, procStart)) {
          exclude.add(short)
          liveWorkers = true
        }
      }
    }
  } catch {
    // missing/unreadable roster — official catch {}
  }
  return { exclude, rosterParsed, liveWorkers }
}

/**
 * densable O @221576704 — unlink if mtime < cutoff. ENOENT → false.
 * Fresh files increment filesRetainedFresh. Unlink throw after mtime<a
 * increments filesPastCutoff.
 */
async function unlinkIfOlderThan(
  filePath: string,
  cutoff: Date,
  fsImpl: FsOperations,
  result: CleanupResult,
  pastCutoff: Date = cutoff,
): Promise<boolean> {
  let stats: { mtime: Date }
  try {
    stats = await fsImpl.stat(filePath)
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
  if (!(stats.mtime < cutoff)) {
    result.filesRetainedFresh++
    return false
  }
  try {
    await fsImpl.unlink(filePath)
  } catch (error) {
    if (isENOENT(error)) return false
    if (stats.mtime < pastCutoff) result.filesPastCutoff++
    throw error
  }
  return true
}

/**
 * densable k(e, t, r=!0) @221582127 — age files by extension, optional rmdir.
 */
async function cleanupAgedFilesInDirectory(
  dirPath: string,
  extension: string,
  removeEmptyDir = true,
): Promise<CleanupResult> {
  const cutoff = getRetentionCutoff()
  const result = emptyCleanupResult()
  if (cutoff === null) return result
  const fsImpl = getFsImplementation()
  let dirents
  try {
    dirents = await fsImpl.readdir(dirPath)
  } catch {
    return result
  }
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(extension)) continue
    try {
      if (
        await unlinkIfOlderThan(
          join(dirPath, dirent.name),
          cutoff,
          fsImpl,
          result,
        )
      ) {
        result.messages++
      }
    } catch {
      result.errors++
    }
  }
  if (removeEmptyDir) {
    await tryRmdir(dirPath, fsImpl)
  }
  return result
}

/**
 * densable zr host-managed orphans: file in daemon/host-managed whose
 * jobs/<name> is gone → O() if older than cutoff.
 */
async function cleanupHostManagedOrphans(): Promise<CleanupResult> {
  const result = emptyCleanupResult()
  const cutoff = getRetentionCutoff()
  if (cutoff === null) return result
  const home = getClaudeConfigHomeDir()
  const hostManaged = join(home, 'daemon', 'host-managed')
  const jobsDir = getJobsBaseDir()
  const fsImpl = getFsImplementation()
  let entries: Dirent[]
  try {
    entries = await fs.readdir(hostManaged, { withFileTypes: true })
  } catch (error) {
    if (!isENOENT(error)) result.errors++
    return result
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      await fs.lstat(join(jobsDir, entry.name))
    } catch (error) {
      if (!isENOENT(error)) {
        result.errors++
        continue
      }
      try {
        if (
          await unlinkIfOlderThan(
            join(hostManaged, entry.name),
            cutoff,
            fsImpl,
            result,
          )
        ) {
          result.messages++
        }
      } catch (unlinkError) {
        if (!isENOENT(unlinkError)) result.errors++
      }
    }
  }
  return result
}

/**
 * densable zr @221588623.
 * k(jobs/settled) + dispatch/rejected + dispatch(!rmdir) + daemon/auth +
 * host-managed orphans; then `if(!n) nt(e)` pins exclude + roster; then
 * b("jobs") skipIf → Slu; then daemon.log / roster aging.
 * `e` is parent storageV5: Fe `if(e) return er(e)`.
 */
export async function cleanupJobsRetentionSweep(
  storageV5?: unknown,
): Promise<CleanupResult> {
  const home = getClaudeConfigHomeDir()
  let result = await cleanupAgedFilesInDirectory(
    join(home, 'jobs', 'settled'),
    '.json',
  )
  result = addCleanupResults(
    result,
    await cleanupAgedFilesInDirectory(
      join(home, 'daemon', 'dispatch', 'rejected'),
      '.json',
    ),
  )
  result = addCleanupResults(
    result,
    await cleanupAgedFilesInDirectory(
      join(home, 'daemon', 'dispatch'),
      '.json',
      false,
    ),
  )
  result = addCleanupResults(
    result,
    await cleanupAgedFilesInDirectory(join(home, 'daemon', 'auth'), '.json'),
  )
  result = addCleanupResults(result, await cleanupHostManagedOrphans())

  const cutoff = getRetentionCutoff()
  const explicitPeriod = hasExplicitCleanupPeriodDays()
  const exclude = new Set<string>()
  if (!explicitPeriod) {
    for (const short of await readPinnedJobShorts(storageV5)) {
      exclude.add(short)
    }
  }
  const roster = await liveRosterJobShorts()
  for (const short of roster.exclude) {
    exclude.add(short)
  }

  if (cutoff !== null) {
    const jobsDir = getJobsBaseDir()
    let entries: Dirent[]
    try {
      entries = await fs.readdir(jobsDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || exclude.has(entry.name)) continue
      const jobDir = join(jobsDir, entry.name)
      try {
        if ((await fs.stat(jobDir)).mtime >= cutoff) continue
        let state: BgJobState | null
        try {
          state = await readJobStateForRetentionSweep(jobDir)
        } catch (error) {
          logForDebugging(
            `[cleanup] jobs/${basename(jobDir)}: job state read threw — keeping the folder (${errorMessage(error)})`,
            { level: 'error' },
          )
          throw error
        }
        if (!explicitPeriod && (state === null || !isJobSweepSettled(state))) {
          continue
        }
        if (state?.worktreePath && isJobSweepSettled(state) && cutoff) {
          await reapJobWorktreeIfSafe({
            worktreePath: state.worktreePath,
            worktreeBranch: state.worktreeBranch,
            originCwd: state.originCwd,
            hookBased: state.worktreeHookBased,
            cutoff,
          }).catch(() => {})
        }
        await fs.rm(jobDir, { recursive: true, force: true })
        result.messages++
      } catch {
        result.errors++
      }
    }

    const fsImpl = getFsImplementation()
    for (const logName of ['daemon.log', 'daemon.log.1']) {
      try {
        if (
          await unlinkIfOlderThan(join(home, logName), cutoff, fsImpl, result)
        ) {
          result.messages++
        }
      } catch (error) {
        if (!isENOENT(error)) result.errors++
      }
    }
    const rosterPath = join(home, 'daemon', 'roster.json')
    try {
      if (
        (await fs.lstat(rosterPath)).mtime < cutoff &&
        !roster.liveWorkers &&
        (roster.rosterParsed || explicitPeriod)
      ) {
        await fs.unlink(rosterPath)
        result.messages++
      }
    } catch (error) {
      if (!isENOENT(error)) result.errors++
    }
    try {
      for (const entry of await fs.readdir(join(home, 'daemon'), {
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !entry.name.startsWith('roster.json.corrupt.')) {
          continue
        }
        try {
          if (
            await unlinkIfOlderThan(
              join(home, 'daemon', entry.name),
              cutoff,
              fsImpl,
              result,
            )
          ) {
            result.messages++
          }
        } catch {
          result.errors++
        }
      }
    } catch {
      // official readdir(daemon).catch(()=>[])
    }
  }
  return result
}

export type CleanupResult = {
  messages: number
  errors: number
  filesRetainedFresh: number
  filesPastCutoff: number
}

/** densable P() @221575518 */
function emptyCleanupResult(): CleanupResult {
  return {
    messages: 0,
    errors: 0,
    filesRetainedFresh: 0,
    filesPastCutoff: 0,
  }
}

/** densable C(e,t) @221575558 */
export function addCleanupResults(
  a: CleanupResult,
  b: CleanupResult,
): CleanupResult {
  return {
    messages: a.messages + b.messages,
    errors: a.errors + b.errors,
    filesRetainedFresh: a.filesRetainedFresh + b.filesRetainedFresh,
    filesPastCutoff: a.filesPastCutoff + b.filesPastCutoff,
  }
}

export function convertFileNameToDate(filename: string): Date {
  const isoStr = filename
    .split('.')[0]!
    .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
  return new Date(isoStr)
}

async function cleanupOldFilesInDirectory(
  dirPath: string,
  cutoffDate: Date,
  isMessagePath: boolean,
): Promise<CleanupResult> {
  const result = emptyCleanupResult()

  try {
    const files = await getFsImplementation().readdir(dirPath)

    for (const file of files) {
      try {
        // Convert filename format where all ':.' were replaced with '-'
        const timestamp = convertFileNameToDate(file.name)
        if (timestamp < cutoffDate) {
          await getFsImplementation().unlink(join(dirPath, file.name))
          // Increment the appropriate counter
          if (isMessagePath) {
            result.messages++
          } else {
            result.errors++
          }
        }
      } catch (error) {
        // Log but continue processing other files
        logError(error as Error)
      }
    }
  } catch (error: unknown) {
    // Ignore if directory doesn't exist
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      logError(error)
    }
  }

  return result
}

export async function cleanupOldMessageFiles(): Promise<CleanupResult> {
  const fsImpl = getFsImplementation()
  const cutoffDate = getCutoffDate()
  const errorPath = CACHE_PATHS.errors()
  const baseCachePath = CACHE_PATHS.baseLogs()

  // Clean up message and error logs
  let result = await cleanupOldFilesInDirectory(errorPath, cutoffDate, false)

  // Clean up MCP logs
  try {
    let dirents
    try {
      dirents = await fsImpl.readdir(baseCachePath)
    } catch {
      return result
    }

    const mcpLogDirs = dirents
      .filter(
        dirent => dirent.isDirectory() && dirent.name.startsWith('mcp-logs-'),
      )
      .map(dirent => join(baseCachePath, dirent.name))

    for (const mcpLogDir of mcpLogDirs) {
      // Clean up files in MCP log directory
      result = addCleanupResults(
        result,
        await cleanupOldFilesInDirectory(mcpLogDir, cutoffDate, true),
      )
      await tryRmdir(mcpLogDir, fsImpl)
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      logError(error)
    }
  }

  return result
}

async function unlinkIfOld(
  filePath: string,
  cutoffDate: Date,
  fsImpl: FsOperations,
  skipIf?: (
    path: string,
    stats: { mtime: Date; size: number },
  ) => Promise<boolean>,
): Promise<boolean> {
  const stats = await fsImpl.stat(filePath)
  if (stats.mtime < cutoffDate) {
    // densable F `u` — skipIf true keeps the file (Ior desktop exemption).
    if (skipIf !== undefined && (await skipIf(filePath, stats))) {
      return false
    }
    await fsImpl.unlink(filePath)
    return true
  }
  return false
}

async function tryRmdir(dirPath: string, fsImpl: FsOperations): Promise<void> {
  try {
    await fsImpl.rmdir(dirPath)
  } catch {
    // not empty / doesn't exist
  }
}

export async function cleanupOldSessionFiles(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result = emptyCleanupResult()
  const projectsDir = getProjectsDir()
  const fsImpl = getFsImplementation()
  // densable Ior: `let p=fe(),w=Ae()` — Ae always runs; skipIf is off when xe.
  const desktopCutoff = getDesktopSessionCleanupCutoff()
  const desktopExemptionBlocked = isDesktopSessionCleanupBlocked()
  let headTailBuf: Buffer | undefined
  const skipDesktopJsonl = desktopExemptionBlocked
    ? undefined
    : async (
        filePath: string,
        stats: { mtime: Date; size: number },
      ): Promise<boolean> => {
        headTailBuf ??= Buffer.allocUnsafe(LITE_READ_BUF_SIZE)
        return shouldExemptDesktopSessionTranscript(
          filePath,
          stats,
          cutoffDate,
          desktopCutoff,
          fsImpl,
          headTailBuf,
        )
      }

  let projectDirents
  try {
    projectDirents = await fsImpl.readdir(projectsDir)
  } catch {
    return result
  }

  for (const projectDirent of projectDirents) {
    if (!projectDirent.isDirectory()) continue
    const projectDir = join(projectsDir, projectDirent.name)

    // Single readdir per project directory — partition into files and session dirs
    let entries
    try {
      entries = await fsImpl.readdir(projectDir)
    } catch {
      result.errors++
      continue
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        if (!entry.name.endsWith('.jsonl') && !entry.name.endsWith('.cast')) {
          continue
        }
        // densable U0m: companion cleanup only for real session ids — never
        // treat reserved project-level names as session transcripts.
        const base = entry.name.replace(/\.(jsonl|cast)$/i, '')
        if (isProjectLevelReservedEntry(base)) {
          continue
        }
        try {
          if (
            await unlinkIfOld(
              join(projectDir, entry.name),
              cutoffDate,
              fsImpl,
              entry.name.endsWith('.jsonl') ? skipDesktopJsonl : undefined,
            )
          ) {
            result.messages++
          }
        } catch {
          result.errors++
        }
      } else if (entry.isDirectory()) {
        // densable 2.1.228 #8 / U0m+YMu+WMu: skip project-level reserved
        // dirs (especially `memory/`) — never walk as session tool-results.
        if (isProjectLevelReservedEntry(entry.name)) {
          continue
        }
        // Session directory — clean up tool-results/<toolDir>/* beneath it
        const sessionDir = join(projectDir, entry.name)
        const toolResultsDir = join(sessionDir, TOOL_RESULTS_SUBDIR)
        let toolDirs
        try {
          toolDirs = await fsImpl.readdir(toolResultsDir)
        } catch {
          // No tool-results dir — still try to remove an empty session dir
          await tryRmdir(sessionDir, fsImpl)
          continue
        }
        for (const toolEntry of toolDirs) {
          if (toolEntry.isFile()) {
            try {
              if (
                await unlinkIfOld(
                  join(toolResultsDir, toolEntry.name),
                  cutoffDate,
                  fsImpl,
                )
              ) {
                result.messages++
              }
            } catch {
              result.errors++
            }
          } else if (toolEntry.isDirectory()) {
            const toolDirPath = join(toolResultsDir, toolEntry.name)
            let toolFiles
            try {
              toolFiles = await fsImpl.readdir(toolDirPath)
            } catch {
              continue
            }
            for (const tf of toolFiles) {
              if (!tf.isFile()) continue
              try {
                if (
                  await unlinkIfOld(
                    join(toolDirPath, tf.name),
                    cutoffDate,
                    fsImpl,
                  )
                ) {
                  result.messages++
                }
              } catch {
                result.errors++
              }
            }
            await tryRmdir(toolDirPath, fsImpl)
          }
        }
        await tryRmdir(toolResultsDir, fsImpl)
        await tryRmdir(sessionDir, fsImpl)
      }
    }

    await tryRmdir(projectDir, fsImpl)
  }

  return result
}

/**
 * Generic helper for cleaning up old files in a single directory
 * @param dirPath Path to the directory to clean
 * @param extension File extension to filter (e.g., '.md', '.jsonl')
 * @param removeEmptyDir Whether to remove the directory if empty after cleanup
 */
async function cleanupSingleDirectory(
  dirPath: string,
  extension: string,
  removeEmptyDir: boolean = true,
): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result = emptyCleanupResult()
  const fsImpl = getFsImplementation()

  let dirents
  try {
    dirents = await fsImpl.readdir(dirPath)
  } catch {
    return result
  }

  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(extension)) continue
    try {
      if (await unlinkIfOld(join(dirPath, dirent.name), cutoffDate, fsImpl)) {
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  if (removeEmptyDir) {
    await tryRmdir(dirPath, fsImpl)
  }

  return result
}

export function cleanupOldPlanFiles(): Promise<CleanupResult> {
  const plansDir = join(getClaudeConfigHomeDir(), 'plans')
  return cleanupSingleDirectory(plansDir, '.md')
}

export async function cleanupOldFileHistoryBackups(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result = emptyCleanupResult()
  const fsImpl = getFsImplementation()

  try {
    const configDir = getClaudeConfigHomeDir()
    const fileHistoryStorageDir = join(configDir, 'file-history')

    let dirents
    try {
      dirents = await fsImpl.readdir(fileHistoryStorageDir)
    } catch {
      return result
    }

    const fileHistorySessionsDirs = dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => join(fileHistoryStorageDir, dirent.name))

    await Promise.all(
      fileHistorySessionsDirs.map(async fileHistorySessionDir => {
        try {
          const stats = await fsImpl.stat(fileHistorySessionDir)
          if (stats.mtime < cutoffDate) {
            await fsImpl.rm(fileHistorySessionDir, {
              recursive: true,
              force: true,
            })
            result.messages++
          }
        } catch {
          result.errors++
        }
      }),
    )

    await tryRmdir(fileHistoryStorageDir, fsImpl)
  } catch (error) {
    logError(error as Error)
  }

  return result
}

export async function cleanupOldSessionEnvDirs(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result = emptyCleanupResult()
  const fsImpl = getFsImplementation()

  try {
    const configDir = getClaudeConfigHomeDir()
    const sessionEnvBaseDir = join(configDir, 'session-env')

    let dirents
    try {
      dirents = await fsImpl.readdir(sessionEnvBaseDir)
    } catch {
      return result
    }

    const sessionEnvDirs = dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => join(sessionEnvBaseDir, dirent.name))

    for (const sessionEnvDir of sessionEnvDirs) {
      try {
        const stats = await fsImpl.stat(sessionEnvDir)
        if (stats.mtime < cutoffDate) {
          await fsImpl.rm(sessionEnvDir, { recursive: true, force: true })
          result.messages++
        }
      } catch {
        result.errors++
      }
    }

    await tryRmdir(sessionEnvBaseDir, fsImpl)
  } catch (error) {
    logError(error as Error)
  }

  return result
}

/**
 * Cleans up old debug log files from ~/.claude/debug/
 * Preserves the 'latest' symlink which points to the current session's log.
 * Debug logs can grow very large (especially with the infinite logging loop bug)
 * and accumulate indefinitely without this cleanup.
 */
export async function cleanupOldDebugLogs(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result = emptyCleanupResult()
  const fsImpl = getFsImplementation()
  const debugDir = join(getClaudeConfigHomeDir(), 'debug')

  let dirents
  try {
    dirents = await fsImpl.readdir(debugDir)
  } catch {
    return result
  }

  for (const dirent of dirents) {
    // Preserve the 'latest' symlink
    if (
      !dirent.isFile() ||
      !dirent.name.endsWith('.txt') ||
      dirent.name === 'latest'
    ) {
      continue
    }
    try {
      if (await unlinkIfOld(join(debugDir, dirent.name), cutoffDate, fsImpl)) {
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  // Intentionally do NOT remove debugDir even if empty — needed for future logs
  return result
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Clean up old npm cache entries for Anthropic packages.
 * This helps reduce disk usage since we publish many dev versions per day.
 * Only runs once per day for Ant users.
 */
export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {
  const markerPath = join(getClaudeConfigHomeDir(), '.npm-cache-cleanup')

  try {
    const stat = await fs.stat(markerPath)
    if (Date.now() - stat.mtimeMs < ONE_DAY_MS) {
      logForDebugging('npm cache cleanup: skipping, ran recently')
      return
    }
  } catch {
    // File doesn't exist, proceed with cleanup
  }

  try {
    await lockfile.lock(markerPath, { retries: 0, realpath: false })
  } catch {
    logForDebugging('npm cache cleanup: skipping, lock held')
    return
  }

  logForDebugging('npm cache cleanup: starting')

  const npmCachePath = join(homedir(), '.npm', '_cacache')

  const NPM_CACHE_RETENTION_COUNT = 5

  const startTime = Date.now()
  try {
    const cacache = await import('cacache')
    const cutoff = startTime - ONE_DAY_MS

    // Stream index entries and collect all Anthropic package entries.
    // Previous implementation used cacache.verify() which does a full
    // integrity check + GC of the ENTIRE cache — O(all content blobs).
    // On large caches this took 60+ seconds and blocked the event loop.
    const stream = cacache.ls.stream(npmCachePath)
    const anthropicEntries: { key: string; time: number }[] = []
    for await (const entry of stream as AsyncIterable<{
      key: string
      time: number
    }>) {
      if (entry.key.includes('@anthropic-ai/claude-')) {
        anthropicEntries.push({ key: entry.key, time: entry.time })
      }
    }

    // Group by package name (everything before the last @version separator)
    const byPackage = new Map<string, { key: string; time: number }[]>()
    for (const entry of anthropicEntries) {
      const atVersionIdx = entry.key.lastIndexOf('@')
      const pkgName =
        atVersionIdx > 0 ? entry.key.slice(0, atVersionIdx) : entry.key
      const existing = byPackage.get(pkgName) ?? []
      existing.push(entry)
      byPackage.set(pkgName, existing)
    }

    // Remove entries older than 1 day OR beyond the top N most recent per package
    const keysToRemove: string[] = []
    for (const [, entries] of byPackage) {
      entries.sort((a, b) => b.time - a.time) // newest first
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        if (entry.time < cutoff || i >= NPM_CACHE_RETENTION_COUNT) {
          keysToRemove.push(entry.key)
        }
      }
    }

    await Promise.all(
      keysToRemove.map(key => cacache.rm.entry(npmCachePath, key)),
    )

    await fs.writeFile(markerPath, new Date().toISOString())

    const durationMs = Date.now() - startTime
    if (keysToRemove.length > 0) {
      logForDebugging(
        `npm cache cleanup: Removed ${keysToRemove.length} old @anthropic-ai entries in ${durationMs}ms`,
      )
    } else {
      logForDebugging(`npm cache cleanup: completed in ${durationMs}ms`)
    }
    logEvent('tengu_npm_cache_cleanup', {
      success: true,
      durationMs,
      entriesRemoved: keysToRemove.length,
    })
  } catch (error) {
    logError(error as Error)
    logEvent('tengu_npm_cache_cleanup', {
      success: false,
      durationMs: Date.now() - startTime,
    })
  } finally {
    await lockfile.unlock(markerPath, { realpath: false }).catch(() => {})
  }
}

/**
 * Throttled wrapper around cleanupOldVersions for recurring cleanup in long-running sessions.
 * Uses a marker file and lock to ensure it runs at most once per 24 hours,
 * and does not block if another process is already running cleanup.
 * The regular cleanupOldVersions() should still be used for installer flows.
 */
export async function cleanupOldVersionsThrottled(): Promise<void> {
  const markerPath = join(getClaudeConfigHomeDir(), '.version-cleanup')

  try {
    const stat = await fs.stat(markerPath)
    if (Date.now() - stat.mtimeMs < ONE_DAY_MS) {
      logForDebugging('version cleanup: skipping, ran recently')
      return
    }
  } catch {
    // File doesn't exist, proceed with cleanup
  }

  try {
    await lockfile.lock(markerPath, { retries: 0, realpath: false })
  } catch {
    logForDebugging('version cleanup: skipping, lock held')
    return
  }

  logForDebugging('version cleanup: starting (throttled)')

  try {
    await cleanupOldVersions()
    await fs.writeFile(markerPath, new Date().toISOString())
  } catch (error) {
    logError(error as Error)
  } finally {
    await lockfile.unlock(markerPath, { realpath: false }).catch(() => {})
  }
}

export async function cleanupOldMessageFilesInBackground(): Promise<void> {
  // densable Jrt / $te: if settings have validation errors but a retention
  // key was explicitly set, skip rather than falling back to defaults.
  const { errors } = getSettingsWithAllErrors()
  if (errors.length > 0) {
    const blockingKey = CLEANUP_PERIOD_SETTINGS_KEYS.find(key =>
      rawSettingsContainsKey(key),
    )
    if (blockingKey !== undefined) {
      logForDebugging(
        `Skipping cleanup: settings have validation errors but ${blockingKey} was explicitly set. Fix settings errors to enable cleanup.`,
      )
      return
    }
  }

  await cleanupOldMessageFiles()
  await cleanupOldSessionFiles()
  await cleanupOldPlanFiles()
  await cleanupOldFileHistoryBackups()
  await cleanupOldSessionEnvDirs()
  await cleanupOldDebugLogs()
  await cleanupOldImageCaches()
  await cleanupOldPastes(getCutoffDate())
  const removedWorktrees = await cleanupStaleAgentWorktrees(getCutoffDate())
  if (removedWorktrees > 0) {
    logEvent('tengu_worktree_cleanup', { removed: removedWorktrees })
  }
  // densable zr b("jobs") skipIf → Slu. Not cleanupStaleAgentWorktrees.
  // Fe(e): parent storageV5 from pin when hover-rest handed one.
  const { getPinnedStorageV5 } = await import('./storageV5/index.js')
  await cleanupJobsRetentionSweep(getPinnedStorageV5())
  if (process.env.USER_TYPE === 'ant') {
    await cleanupNpmCacheForAnthropicPackages()
  }
}
