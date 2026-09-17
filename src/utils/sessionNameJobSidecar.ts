/**
 * 2.1.246 #49 — official s8n BQ=Li / VAt=Ti / Pm=Oi.
 * 09-16 promoted to HAVE.
 *
 * Rt = tzc = vhn(P(trim)).trim(); P=_742 BYc = ly. Local uge.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import {
  patchBgJobState,
  readBgJobState,
  type BgJobState,
} from '../daemon/jobState.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { sanitizeSessionTitle } from './sessionTitleSanitize.js'

/** densable leftover `j` in `_467`. */
const JOB_STATE_FILE = 'state.json'

/** densable leftover `f` in `_799` C/rv — NUL. */
const JOB_ID_NUL = String.fromCharCode(0)

/** densable leftover `h` — K only when basename starts with `.`. */
const JOB_ID_ASIDE = /^\.[0-9a-f]{16}\.aside$/

/** densable leftover host `Uv.bgTakeover`. */
export type BgJobTakeover = { jobDir: string }

let bgJobTakeover: BgJobTakeover | null = null

type JobStorageV5Key = {
  namespace: 'job'
  jobId: string
  relPath: string[]
}

type StorageV5WriteHandle = {
  write: (
    key: unknown,
    value: string,
    opts?: { mode?: number; parent?: string },
  ) => Promise<{ ok: true } | { ok: false; error: { code: string } }>
}

/** densable leftover `QF` — `ov(Ae(),"jobs")`. Ae = config home. */
export function getClaudeJobsDir(): string {
  return join(getClaudeConfigHomeDir(), 'jobs')
}

/** densable leftover `_799` `o`/`c` — colon split + trim trailing `.`/space. */
export function splitJobIdIntoSegments(id: string): string[] {
  const n = id.toLowerCase()
  const colon = n.indexOf(':')
  const trimDotSpace = (value: string): string => {
    let end = value.length
    while (end > 0) {
      const code = value.charCodeAt(end - 1)
      if (code !== 46 && code !== 32) break
      end -= 1
    }
    return end === value.length ? value : value.slice(0, end)
  }
  if (colon === -1) return [trimDotSpace(n)]
  return [trimDotSpace(n), trimDotSpace(n.slice(0, colon))]
}

/** densable leftover `K`. */
function isHiddenAsideJobId(id: string): boolean {
  if (id.charCodeAt(0) !== 46) return false
  return splitJobIdIntoSegments(id).some(part => JOB_ID_ASIDE.test(part))
}

/** densable leftover `_799` `E` / `Gad` — any segment ends with `.jsonl`. */
export function jobIdHasJsonlSegment(id: string): boolean {
  return splitJobIdIntoSegments(id).some(part => part.endsWith('.jsonl'))
}

/** densable leftover `_799` `C` / `rv` / `Ead`. */
export function isValidStoragePathSegment(id: string): boolean {
  return !(
    typeof id !== 'string' ||
    id.length === 0 ||
    /^[. ]+$/.test(id) ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes(JOB_ID_NUL) ||
    isHiddenAsideJobId(id)
  )
}

/** densable leftover `ee.job` / `T.job`. */
export function createJobStorageV5Key(
  jobId: string,
  relPath: string[],
): JobStorageV5Key {
  return { namespace: 'job', jobId, relPath }
}

/**
 * densable leftover `iv` / `_t` / `re(e,t)`.
 * `n=basename(e)`; fail unless `rv(n)` and `e===join(QF(),n)`.
 */
export function resolveJobDirStorageV5Key(
  jobDir: string,
  relPath: string[],
): JobStorageV5Key | undefined {
  const n = basename(jobDir)
  if (!isValidStoragePathSegment(n) || jobDir !== join(getClaudeJobsDir(), n))
    return
  return createJobStorageV5Key(n, relPath)
}

/** densable leftover `wp`. */
export function getBgJobTakeover(): BgJobTakeover | null {
  return bgJobTakeover
}

/** densable leftover `Uv.setBgTakeover`. Official JS has no caller. */
export function setBgJobTakeover(value: BgJobTakeover | null): void {
  bgJobTakeover = value
}

/** densable leftover `uC` / `getBgJobDir`. */
export function getBgJobDirectory(): string | undefined {
  return getBgJobTakeover()?.jobDir ?? process.env.CLAUDE_JOB_DIR
}

export function resetBgJobTakeoverForTests(): void {
  bgJobTakeover = null
}

function asStorageV5Write(value: unknown): StorageV5WriteHandle | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const write = (value as { write?: unknown }).write
  if (typeof write !== 'function') return undefined
  return value as StorageV5WriteHandle
}

/** densable leftover `on` for `ae`. */
const ARGV_UNSAFE = /^-|^[A-Za-z][A-Za-z0-9+.-]+:\/\//

/** densable leftover `ae(e)`. */
export function isSafeRespawnFlagValue(value: string): boolean {
  return !ARGV_UNSAFE.test(value) && !value.includes('\x00')
}

/** densable leftover `Z(e,t)` — emit `--flag v` or `--flag=v`. */
export function formatJobRespawnFlagArgs(
  flag: string,
  value: string | null,
): string[] {
  if (!value) return []
  return isSafeRespawnFlagValue(value) ? [flag, value] : [`${flag}=${value}`]
}

/** densable leftover `Rt` — `uge` / sanitizeSessionTitle. */
export function normalizeJobSessionTitle(name: string): string {
  return sanitizeSessionTitle(name)
}

/** densable leftover `Ut(e,t)`. */
export function shouldAllowJobNameUpdate(
  state: { name?: string; nameSource?: string },
  previousNames: readonly string[] | undefined,
): boolean {
  if (previousNames === undefined || !state.name) return true
  if (state.nameSource === 'auto' || state.nameSource === 'collision') {
    return true
  }
  return previousNames.includes(normalizeJobSessionTitle(state.name))
}

/** densable leftover `Oi` / `Pm`. `zt`=`wp`. */
export function resolveBgJobShortId(): string {
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (jobDir) return basename(jobDir)
  const takeover = getBgJobTakeover()
  if (takeover) return basename(takeover.jobDir)
  return getSessionId().slice(0, 8)
}

function rewriteRespawnFlags(
  flags: readonly string[],
  longFlag: string,
  aliases: readonly string[],
  value: string | null,
): string[] {
  const keys = [longFlag, ...aliases]
  const stripped: string[] = []
  for (let w = 0; w < flags.length; w++) {
    const token = flags[w]!
    if (keys.some(f => token === f || token.startsWith(`${f}=`))) {
      if (!token.includes('=') && flags[w + 1] !== undefined) w++
      continue
    }
    stripped.push(token)
  }
  if (value === null) return stripped
  return [...stripped, ...formatJobRespawnFlagArgs(longFlag, value)]
}

function readJobDirState(jobDir: string): BgJobState | null {
  try {
    return jsonParse(
      readFileSync(join(jobDir, 'state.json'), 'utf-8'),
    ) as BgJobState
  } catch {
    return null
  }
}

function writeJobDirState(jobDir: string, state: BgJobState): void {
  mkdirSync(jobDir, { recursive: true })
  writeFileSync(join(jobDir, 'state.json'), jsonStringify(state), 'utf-8')
}

/**
 * densable leftover `Li` / `BQ("--name",["-n"],name,patch,storageV5,prev)`.
 * Official `H`: `u=n?re(e,[j]):void 0`; `n&&u` → v5 write `{mode:384,parent:"mustExist"}`.
 */
export async function patchBgJobDirRespawnFlags(
  longFlag: string,
  aliases: readonly string[],
  value: string | null,
  patch: { name?: string; nameSource?: 'user' | 'auto' | 'collision' },
  storageV5: unknown,
  previousNames?: readonly string[],
): Promise<void> {
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (!jobDir || process.env.CLAUDE_CODE_SESSION_KIND !== 'bg') return
  const current = readJobDirState(jobDir)
  if (!current?.respawnFlags) return
  const nextFlags = rewriteRespawnFlags(
    current.respawnFlags,
    longFlag,
    aliases,
    value,
  )
  if (
    nextFlags.length === current.respawnFlags.length &&
    nextFlags.every((flag, i) => flag === current.respawnFlags[i])
  ) {
    return
  }
  const latest = readJobDirState(jobDir) ?? current
  const allowName = shouldAllowJobNameUpdate(latest, previousNames)
  const next: BgJobState = {
    ...latest,
    ...(allowName ? patch : {}),
    respawnFlags: rewriteRespawnFlags(
      latest.respawnFlags ?? current.respawnFlags,
      longFlag,
      aliases,
      value,
    ),
    updatedAt: new Date().toISOString(),
  }
  const key = resolveJobDirStorageV5Key(jobDir, [JOB_STATE_FILE])
  const v5 = asStorageV5Write(storageV5)
  if (v5 && key) {
    try {
      const written = await v5.write(key, jsonStringify(next, null, 2), {
        mode: 384,
        parent: 'mustExist',
      })
      if (!written.ok) {
        logForDebugging(
          `[jobs] leftover Li v5 state write failed: ${written.error.code}`,
          { level: 'error' },
        )
      }
    } catch (err) {
      logForDebugging(
        `[jobs] leftover Li v5 state write failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }
    return
  }
  try {
    writeJobDirState(jobDir, next)
  } catch (err) {
    logForDebugging(
      `[jobs] leftover Li state write failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}

/**
 * densable leftover `Ti` / `VAt(Pm(),name,source,storageV5,prev)`.
 */
export async function patchBgJobRegistrySessionName(
  short: string,
  name: string,
  source: 'user' | 'auto' | 'collision',
  _storageV5: unknown,
  previousNames?: readonly string[],
): Promise<boolean> {
  const current = readBgJobState(short)
  if (!current) return false
  if (current.name === name) return true
  const latest = readBgJobState(short) ?? current
  if (latest.name === name || (source === 'auto' && latest.name)) return true
  if (!shouldAllowJobNameUpdate(latest, previousNames)) return false
  const written = patchBgJobState(short, {
    name,
    nameSource: source,
  })
  return written !== null
}
