import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from '../utils/debug.js'
import { isENOENT } from '../utils/errors.js'
import { getWorktreePathsPortable } from '../utils/getWorktreePathsPortable.js'
import {
  isProcessRunning,
  isSameProcessAsync,
  ownProcStartAsync,
} from '../utils/genericProcessUtils.js'
import { lazySchema } from '../utils/lazySchema.js'
import {
  getProjectsDir,
  sanitizePath,
} from '../utils/sessionStoragePortable.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

/**
 * Upper bound on worktree fanout. git worktree list is naturally bounded
 * (50 is a LOT), but this caps the parallel stat() burst and guards against
 * pathological setups. Above this, --continue falls back to current-dir-only.
 */
const MAX_WORKTREE_FANOUT = 50

/**
 * Crash-recovery pointer for Remote Control sessions.
 *
 * densable 2.1.238 (YKT / JKT / FDl): written after a bridge session is
 * created (with pid + procStart), periodically refreshed, and cleared on
 * full teardown only when this process owns the file. If the process dies
 * unclean, the next `claude remote-control` (no --session-id) reuses the
 * leftover standalone pointer on registration — next message reconnects.
 *
 * Occupancy: a live writer pid that still matches procStart defers the
 * write (fresh env, no split-brain). `--session-id` against a live pointer
 * for the same session/env exits instead of racing.
 *
 * Staleness is checked against the file's mtime (not an embedded timestamp)
 * so that a periodic re-write with the same content serves as a refresh —
 * matches the backend's rolling BRIDGE_LAST_POLL_TTL (4h) semantics.
 *
 * Scoped per working directory (alongside transcript JSONL files) so two
 * concurrent bridges in different repos don't clobber each other.
 *
 * storageV5 (SEA 3rd arg) is not ported — invent-ban.
 */

// Official 2.1.323 #2114: 30 days (raised from 4 hours) so `claude remote-control`
// keeps its computer identity when restarted in the same folder after >4 hours.
export const BRIDGE_POINTER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Official 2.1.328 #1613 (`IRs = 14400000`, `SAl = 900000`, `F = 120000`,
 * `Eun = 64` in `chunk@315265945.js`): rolling base TTL (4h), persisted
 * active-session resume window (15m), clock-skew tolerance (2m), and max
 * carried session IDs (64).
 */
export const BRIDGE_POINTER_BASE_TTL_MS = 14_400_000
export const PERSISTED_SESSION_RESUME_WINDOW_MS = 900_000
export const PERSISTED_STAMP_FUTURE_SKEW_MS = 120_000
export const MAX_PERSISTED_SESSION_IDS = 64

const MAX_SAFE_EPOCH_MS = 8_640_000_000_000_000

const BridgePointerSchema = lazySchema(() =>
  z.object({
    sessionId: z.string(),
    environmentId: z.string(),
    source: z.enum(['standalone', 'repl']),
    pid: z.number().optional(),
    procStart: z.string().optional(),
    environmentRevivedAt: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAFE_EPOCH_MS)
      .optional(),
    activeSessionIds: z
      .array(z.string().max(256))
      .max(MAX_PERSISTED_SESSION_IDS)
      .optional(),
    activeSessionIdsPersistedAt: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAFE_EPOCH_MS)
      .optional(),
  }),
)

/**
 * Official 2.1.328 `Vgl` (`chunk@315265945.js @2820`): check whether a
 * persisted session-list timestamp is within `windowMs` (allowing up to 2m
 * future clock skew).
 */
export function isPersistedStampFresh(
  persistedAt: number,
  nowMs: number = Date.now(),
  windowMs: number = PERSISTED_SESSION_RESUME_WINDOW_MS,
): boolean {
  return (
    nowMs - persistedAt <= windowMs &&
    persistedAt - nowMs <= PERSISTED_STAMP_FUTURE_SKEW_MS
  )
}

/**
 * Official 2.1.328 `kAl` (`chunk@315265945.js @4630`): when reviving a pointer
 * older than the 4h base TTL, stamp `nowMs` as `environmentRevivedAt`;
 * otherwise preserve any existing `environmentRevivedAt`.
 */
export function environmentRevivedAtAfter(
  pointer: BridgePointerWithAge,
  nowMs: number = Date.now(),
): number | undefined {
  return pointer.ageMs > BRIDGE_POINTER_BASE_TTL_MS
    ? nowMs
    : pointer.environmentRevivedAt
}

/**
 * Official 2.1.328 `wAl` (`chunk@315265945.js`): serialize asynchronous pointer
 * updates so periodic refreshes and shutdown flushes never race.
 */
export function createBridgePointerWriteQueue(): <T>(
  fn: () => Promise<T>,
) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next
    return next
  }
}

/**
 * Extract fresh `activeSessionIds` carried across an RC restart within
 * `PERSISTED_SESSION_RESUME_WINDOW_MS`.
 */
export function getFreshActiveSessionIds(
  pointer: BridgePointer | null | undefined,
  nowMs: number = Date.now(),
): { sessionIds: string[]; persistedAt?: number } {
  if (
    pointer?.activeSessionIds?.length &&
    pointer.activeSessionIdsPersistedAt !== undefined &&
    isPersistedStampFresh(
      pointer.activeSessionIdsPersistedAt,
      nowMs,
      PERSISTED_SESSION_RESUME_WINDOW_MS,
    )
  ) {
    return {
      sessionIds: [...pointer.activeSessionIds],
      persistedAt: pointer.activeSessionIdsPersistedAt,
    }
  }
  return { sessionIds: [] }
}

export type BridgePointer = z.infer<ReturnType<typeof BridgePointerSchema>>

export type BridgePointerWithAge = BridgePointer & { ageMs: number }

export function getBridgePointerPath(dir: string): string {
  return join(getProjectsDir(), sanitizePath(dir), 'bridge-pointer.json')
}

/**
 * densable `JKT` — write the pointer. Returns boolean (false on I/O failure).
 * Best-effort — a crash-recovery file must never itself cause a crash.
 *
 * Not atomic (plain writeFile). Concurrent writers can interleave; leftover
 * reuse then re-reads and exits if `raced.pid !== process.pid` (lose-race →
 * exit). Accepted densable TOCTOU — do not invent storageV5 to “fix”.
 */
export async function writeBridgePointer(
  dir: string,
  pointer: BridgePointer,
): Promise<boolean> {
  const path = getBridgePointerPath(dir)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, jsonStringify(pointer), 'utf8')
    logForDebugging(`[bridge:pointer] wrote ${path}`)
    return true
  } catch (err: unknown) {
    logForDebugging(`[bridge:pointer] write failed: ${err}`, { level: 'warn' })
    return false
  }
}

/**
 * Stamp pid + own procStart onto a session/env pointer (SEA write payload).
 */
export async function stampBridgePointer(
  dir: string,
  pointer: Pick<BridgePointer, 'sessionId' | 'environmentId' | 'source'>,
): Promise<boolean> {
  return writeBridgePointer(dir, {
    ...pointer,
    pid: process.pid,
    procStart: await ownProcStartAsync(),
  })
}

/**
 * densable `FDl` — read the pointer and its age (ms since last write).
 * `opts.noClear` skips deleting invalid/stale files (occupancy / race reads).
 * Returns null on missing file, corrupted JSON, schema mismatch, or stale
 * (mtime > 4h ago).
 */
export async function readBridgePointer(
  dir: string,
  opts?: { noClear?: boolean },
): Promise<BridgePointerWithAge | null> {
  const path = getBridgePointerPath(dir)
  let raw: string
  let mtimeMs: number
  try {
    // stat for mtime (staleness anchor), then read. Two syscalls, but both
    // are needed — mtime IS the data we return, not a TOCTOU guard.
    mtimeMs = (await stat(path)).mtimeMs
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const parsed = BridgePointerSchema().safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    if (!opts?.noClear) {
      logForDebugging(`[bridge:pointer] invalid schema, clearing: ${path}`)
      await clearBridgePointer(dir)
    }
    return null
  }

  const ageMs = Math.max(0, Date.now() - mtimeMs)
  if (ageMs > BRIDGE_POINTER_TTL_MS) {
    if (!opts?.noClear) {
      logForDebugging(`[bridge:pointer] stale (>4h mtime), clearing: ${path}`)
      await clearBridgePointer(dir)
    }
    return null
  }

  return { ...parsed.data, ageMs }
}

export type StandalonePointerReuseDecision =
  | { kind: 'defer'; pid: number }
  | {
      kind: 'reuse'
      environmentId: string
      sessionId: string
      ageMs: number
    }
  | { kind: 'none' }

/**
 * densable `!S&&fe` occupancy/reuse table (injectable for tests):
 * writer pid live + identity match → defer; else standalone source → reuse.
 */
export async function decideStandalonePointerReuse(
  prior: BridgePointerWithAge | null,
  deps?: {
    pid?: number
    isProcessRunning?: (pid: number) => boolean
    isSameProcessAsync?: (
      pid: number,
      procStart: string | undefined,
    ) => Promise<boolean>
  },
): Promise<StandalonePointerReuseDecision> {
  if (!prior) return { kind: 'none' }
  const selfPid = deps?.pid ?? process.pid
  const running = deps?.isProcessRunning ?? isProcessRunning
  const same = deps?.isSameProcessAsync ?? isSameProcessAsync
  if (
    prior.pid !== undefined &&
    prior.pid !== selfPid &&
    running(prior.pid) &&
    (await same(prior.pid, prior.procStart))
  ) {
    return { kind: 'defer', pid: prior.pid }
  }
  if (prior.source === 'standalone') {
    return {
      kind: 'reuse',
      environmentId: prior.environmentId,
      sessionId: prior.sessionId,
      ageMs: prior.ageMs,
    }
  }
  return { kind: 'none' }
}

/**
 * Worktree-aware read for `--continue`. The REPL bridge writes its pointer
 * to `getOriginalCwd()` which EnterWorktreeTool/activeWorktreeSession can
 * mutate to a worktree path — but `claude remote-control --continue` runs
 * with `resolve('.')` = shell CWD. This fans out across git worktree
 * siblings to find the freshest pointer, matching /resume's semantics.
 *
 * Fast path: checks `dir` first. Only shells out to `git worktree list` if
 * that misses — the common case (pointer in launch dir) is one stat, zero
 * exec. Fanout reads run in parallel; capped at MAX_WORKTREE_FANOUT.
 *
 * Returns the pointer AND the dir it was found in, so the caller can clear
 * the right file on resume failure.
 */
export async function readBridgePointerAcrossWorktrees(
  dir: string,
): Promise<{ pointer: BridgePointerWithAge; dir: string } | null> {
  // Fast path: current dir. Covers standalone bridge (always matches) and
  // REPL bridge when no worktree mutation happened.
  const here = await readBridgePointer(dir)
  if (here) {
    return { pointer: here, dir }
  }

  // Fanout: scan worktree siblings. getWorktreePathsPortable has a 5s
  // timeout and returns [] on any error (not a git repo, git not installed).
  const worktrees = await getWorktreePathsPortable(dir)
  if (worktrees.length <= 1) return null
  if (worktrees.length > MAX_WORKTREE_FANOUT) {
    logForDebugging(
      `[bridge:pointer] ${worktrees.length} worktrees exceeds fanout cap ${MAX_WORKTREE_FANOUT}, skipping`,
    )
    return null
  }

  // Dedupe against `dir` so we don't re-stat it. sanitizePath normalizes
  // case/separators so worktree-list output matches our fast-path key even
  // on Windows where git may emit C:/ vs stored c:/.
  const dirKey = sanitizePath(dir)
  const candidates = worktrees.filter(wt => sanitizePath(wt) !== dirKey)

  // Parallel stat+read. Each readBridgePointer is a stat() that ENOENTs
  // for worktrees with no pointer (cheap) plus a ~100-byte read for the
  // rare ones that have one. Promise.all → latency ≈ slowest single stat.
  const results = await Promise.all(
    candidates.map(async wt => {
      const p = await readBridgePointer(wt)
      return p ? { pointer: p, dir: wt } : null
    }),
  )

  // Pick freshest (lowest ageMs). The pointer stores environmentId so
  // resume reconnects to the right env regardless of which worktree
  // --continue was invoked from.
  let freshest: {
    pointer: BridgePointerWithAge
    dir: string
  } | null = null
  for (const r of results) {
    if (r && (!freshest || r.pointer.ageMs < freshest.pointer.ageMs)) {
      freshest = r
    }
  }
  if (freshest) {
    logForDebugging(
      `[bridge:pointer] fanout found pointer in worktree ${freshest.dir} (ageMs=${freshest.pointer.ageMs})`,
    )
  }
  return freshest
}

/**
 * Delete the pointer. Idempotent — ENOENT is expected when the process
 * shut down clean previously.
 */
export async function clearBridgePointer(dir: string): Promise<void> {
  const path = getBridgePointerPath(dir)
  try {
    await unlink(path)
    logForDebugging(`[bridge:pointer] cleared ${path}`)
  } catch (err: unknown) {
    if (!isENOENT(err)) {
      logForDebugging(`[bridge:pointer] clear failed: ${err}`, {
        level: 'warn',
      })
    }
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return jsonParse(raw)
  } catch {
    return null
  }
}
