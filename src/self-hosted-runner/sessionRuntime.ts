/**
 * densable 2.1.224 rBh runtime helpers recovered from SEA residual MISS set:
 *   B2h ingress-token cleanup, CKn timeout-continue, xjv/Ijv remote cwd gates,
 *   Bjv init_milestone, Fjv debug diagnostics flush, W2h/z2h interval refresh.
 */
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { SelfHostedRunnerApi } from './runnerApi.js'
import { withTimeoutMs } from './rootRunner.js'
import { SESSION_SEED_FS_TIMEOUT_MS } from './sessionSeed.js'

/** densable `$jv` — max debug lines forwarded to /worker/diagnostics */
export const DIAGNOSTICS_MAX_LINES = 500
/** densable Fjv read window (256 KiB) */
export const DIAGNOSTICS_TAIL_BYTES = 262_144
/** densable W2h floor / ceiling */
export const INFERENCE_REFRESH_MIN_MS = 30_000
export const INFERENCE_REFRESH_MAX_MS = 1_440_000
/** densable z2h defaults */
export const REFRESH_LOOP_ERROR_RETRY_MS = 30_000
export const REFRESH_LOOP_MAX_SHORT_RETRIES = 5

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * densable `CKn` — await withTimeout; if timeout fires before settle, hand
 * promise to onBackground so it can still finish (WJl/B2h pattern).
 */
export async function withTimeoutContinueBackground<T>(
  p: Promise<T>,
  timeoutMs: number,
  label: string,
  onBackground?: (pending: Promise<unknown>) => void,
): Promise<T> {
  let settled = false
  p.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  try {
    return await withTimeoutMs(p, timeoutMs, label)
  } catch (err) {
    if (!settled) {
      onBackground?.(
        p.then(
          () => {},
          () => {},
        ),
      )
    }
    throw err
  }
}

/**
 * densable `B2h` — unlink session-ingress fence + sweep older `.tmp.` siblings
 * for the same or earlier epoch.
 */
export async function cleanupSessionIngressToken(
  fencePath: string,
  onStatus: (msg: string) => void,
  onBackground?: (pending: Promise<unknown>) => void,
  timeoutMs: number = SESSION_SEED_FS_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeoutContinueBackground(
      unlink(fencePath),
      timeoutMs,
      '[runner:session] unlink session-ingress token file',
      onBackground,
    )
  } catch (err) {
    if (!isEnoent(err)) {
      onStatus(
        `[runner:session] session-ingress token file cleanup failed: ${err}`,
      )
    }
  }
  const m = /\.session_ingress_token\.e(\d+)$/.exec(fencePath)
  if (!m) {
    onStatus(
      '[runner:session] token temp sweep skipped: target path has no parseable epoch',
    )
    return
  }
  const epoch = Number(m[1])
  const dir = dirname(fencePath)
  try {
    const names = await withTimeoutContinueBackground(
      readdir(dir),
      timeoutMs,
      '[runner:session] readdir for token temp sweep',
      onBackground,
    )
    for (const name of names) {
      if (!name.startsWith('.session_ingress_token.')) continue
      const tmp = /^\.session_ingress_token\.e(\d+)\.tmp\./.exec(name)
      if (!tmp) {
        if (name.includes('.tmp.')) {
          onStatus(
            '[runner:session] token temp sweep skipped an unparseable sibling',
          )
        }
        continue
      }
      if (Number(tmp[1]) > epoch) continue
      try {
        await withTimeoutContinueBackground(
          unlink(join(dir, name)),
          timeoutMs,
          '[runner:session] unlink token temp file',
          onBackground,
        )
      } catch (err) {
        if (!isEnoent(err)) {
          onStatus(
            `[runner:session] token temp sweep failed for a sibling: ${err}`,
          )
        }
      }
    }
  } catch (err) {
    if (!isEnoent(err)) {
      onStatus(`[runner:session] token temp sweep readdir failed: ${err}`)
    }
  }
}

/**
 * densable `xjv` — ensure `target` is under `root` and every path segment is a
 * real directory (no symlink). Missing segments are mkdir'd; failure → false.
 */
export async function ensureDirsUnderSessionRoot(
  sessionRoot: string,
  target: string,
): Promise<boolean> {
  let cur = resolve(sessionRoot)
  const abs = resolve(target)
  if (abs !== cur && !abs.startsWith(cur + sep)) return false
  const parts = abs.slice(cur.length).split(sep).filter(Boolean)
  for (const part of parts) {
    cur = join(cur, part)
    try {
      const st = await lstat(cur)
      if (st.isSymbolicLink() || !st.isDirectory()) return false
    } catch (err) {
      if (!isEnoent(err)) return false
      try {
        await mkdir(cur)
      } catch {
        return false
      }
    }
  }
  return true
}

/**
 * densable `Ijv` — realpath(target) is under realpath(root).
 */
export async function isRealpathUnderSessionRoot(
  sessionRoot: string,
  target: string,
): Promise<boolean> {
  try {
    const r = await realpath(sessionRoot)
    const n = await realpath(target)
    return n === r || n.startsWith(r + sep)
  } catch {
    return false
  }
}

/**
 * densable remote.cwd acceptance: oBh → xjv → Ijv (each timed).
 * Returns accepted absolute path or null (caller falls back to G2h without cwd).
 */
export async function acceptRemoteCwdUnderSession(
  sessionRoot: string,
  remoteCwd: string,
  resolveUnder: (root: string, cwd: string) => string | null,
  fsTimeoutMs: number = SESSION_SEED_FS_TIMEOUT_MS,
  realpathTimeoutMs: number = 5_000,
): Promise<string | null> {
  const resolved = resolveUnder(sessionRoot, remoteCwd)
  if (resolved === null) return null
  try {
    const okMk = await withTimeoutMs(
      ensureDirsUnderSessionRoot(sessionRoot, resolved),
      fsTimeoutMs,
      `[runner:stuck] mkdir ${resolved} (check NFS/CSI mount health)`,
    )
    if (!okMk) return null
    const okRp = await withTimeoutMs(
      isRealpathUnderSessionRoot(sessionRoot, resolved),
      realpathTimeoutMs,
      `[runner:stuck] realpath ${resolved} (check NFS/CSI mount health)`,
    )
    return okRp ? resolved : null
  } catch {
    return null
  }
}

/** densable `Bjv` — system init_milestone worker event */
export function initMilestoneEvent(message: string): {
  type: 'system'
  uuid: string
  subtype: 'init_milestone'
  message: string
} {
  return {
    type: 'system',
    uuid: randomUUID(),
    subtype: 'init_milestone',
    message,
  }
}

/**
 * densable `Fjv` — best-effort tail of child debug log → /worker/diagnostics.
 */
export async function forwardDebugLogDiagnostics(opts: {
  apiClient: Pick<SelfHostedRunnerApi, 'forwardDiagnostics'>
  apiBaseUrl: string
  sessionId: string
  sessionToken: string
  workerEpoch: number
  debugFile: string
  onDebug: (msg: string) => void
  fsTimeoutMs?: number
}): Promise<void> {
  const t = opts.fsTimeoutMs ?? 5_000
  let text: string
  try {
    const st = await withTimeoutMs(
      stat(opts.debugFile),
      t,
      `stat ${opts.debugFile}`,
    )
    const offset = Math.max(0, st.size - DIAGNOSTICS_TAIL_BYTES)
    const fh = await withTimeoutMs(
      open(opts.debugFile, 'r'),
      t,
      `open ${opts.debugFile}`,
    )
    try {
      const buf = Buffer.alloc(Math.min(st.size, DIAGNOSTICS_TAIL_BYTES))
      const { bytesRead } = await withTimeoutMs(
        fh.read(buf, 0, buf.length, offset),
        t,
        `read ${opts.debugFile}`,
      )
      text = buf.toString('utf-8', 0, bytesRead)
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    return
  }
  const lines = text
    .split('\n')
    .filter(l => l.length > 0)
    .slice(-DIAGNOSTICS_MAX_LINES)
  if (lines.length === 0) return
  const ts = new Date().toISOString()
  const payload = lines.map(message => ({
    timestamp: ts,
    fields: { message },
  }))
  await opts.apiClient.forwardDiagnostics(
    opts.apiBaseUrl,
    opts.sessionId,
    opts.sessionToken,
    opts.workerEpoch,
    payload,
  )
  opts.onDebug(
    `[runner:session] forwarded ${lines.length} debug log lines to /worker/diagnostics`,
  )
}

/**
 * densable `W2h` — inference refresh interval from expires_in_seconds.
 * Default 24m; clamp 30s..24m; use 80% of TTL.
 */
export function inferenceRefreshIntervalMs(
  expiresInSeconds: number | undefined | null,
): number {
  if (!expiresInSeconds || expiresInSeconds <= 0)
    return INFERENCE_REFRESH_MAX_MS
  const n = Math.floor(expiresInSeconds * 1000 * 0.8)
  return Math.max(
    INFERENCE_REFRESH_MIN_MS,
    Math.min(INFERENCE_REFRESH_MAX_MS, n),
  )
}

/**
 * densable rBh `Zt` / `ye` — when WJl/CKn times out and the write later
 * settles in the background, re-chain WJl with the **latest** session token
 * unless finally has already set `He` (markFinalized).
 *
 * densable:
 *   Zt=(jt)=>{ De=!0; wr=jt.catch(()=>{}); pe=Promise.all([pe,wr]);
 *     wr.then(()=>{ if(He)return; Wr=q.current; if(!Wr)return;
 *       we=we.then(()=>WJl(tr,Wr,d,Zt,T)) }) }
 */
export type IngressFenceBgController = {
  /** densable `ye` / `Zt` — pass as WJl onBackground */
  onBackground: (pending: Promise<unknown>) => void
  /** densable `He = true` at start of fence cleanup in finally */
  markFinalized: () => void
  /** densable `De` — any CKn timeout handed work to background */
  hadBackgroundTimeout: () => boolean
  /** densable `pe` — all background settles */
  backgroundAll: () => Promise<unknown>
}

export function createIngressFenceBgController(opts: {
  getFencePath: () => string | undefined
  getLatestToken: () => string | undefined
  /**
   * densable `we = we.then(() => WJl(...))` — caller owns the chain and must
   * invoke write with this controller's onBackground so nested timeouts re-enter Zt.
   */
  enqueueRewrite: (
    path: string,
    token: string,
    onBackground: (p: Promise<unknown>) => void,
  ) => void
}): IngressFenceBgController {
  let finalized = false
  let hadBg = false
  let bgAll: Promise<unknown> = Promise.resolve()
  const onBackground = (pending: Promise<unknown>): void => {
    hadBg = true
    const settled = pending.catch(() => {})
    bgAll = Promise.all([bgAll, settled]).then(() => {})
    void settled.then(() => {
      if (finalized) return
      const path = opts.getFencePath()
      const token = opts.getLatestToken()
      if (!path || !token) return
      opts.enqueueRewrite(path, token, onBackground)
    })
  }
  return {
    onBackground,
    markFinalized: () => {
      finalized = true
    },
    hadBackgroundTimeout: () => hadBg,
    backgroundAll: () => bgAll,
  }
}

/**
 * densable rBh finally after Fjv:
 *   if (re === "completed") unlink(debug)
 *   else status preserve message
 *   if (de) unlink(mcp-config) always
 */
export async function cleanupSessionSideFiles(opts: {
  sessionId: string
  /** densable `re` — only `"completed"` deletes the debug log */
  exitResult?: string
  debugFile: string
  mcpConfigPath?: string
  onStatus: (msg: string) => void
}): Promise<void> {
  if (opts.exitResult === 'completed') {
    await unlink(opts.debugFile).catch(() => {})
  } else if (opts.exitResult !== undefined) {
    opts.onStatus(
      `[runner:session] ${opts.sessionId} ${opts.exitResult} — child debug log preserved at ${opts.debugFile}`,
    )
  }
  if (opts.mcpConfigPath) {
    await unlink(opts.mcpConfigPath).catch(() => {})
  }
}

export type IntervalRefreshLoop = { cancel: () => void }

/**
 * densable `z2h` — setTimeout loop: refresh() may return next intervalMs;
 * on error short-retry min(errorRetryMs, interval) up to maxShortRetries.
 */
export function startIntervalRefreshLoop(opts: {
  intervalMs: number
  refresh: () => Promise<number | undefined>
  onError: (err: unknown) => void
  signal: AbortSignal
  errorRetryMs?: number
  maxShortRetries?: number
}): IntervalRefreshLoop {
  const errorRetryMs = opts.errorRetryMs ?? REFRESH_LOOP_ERROR_RETRY_MS
  const maxShortRetries = opts.maxShortRetries ?? REFRESH_LOOP_MAX_SHORT_RETRIES
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  let intervalMs = opts.intervalMs
  let shortFails = 0
  const onAbort = (): void => cancel()
  opts.signal.addEventListener('abort', onAbort, { once: true })

  function cancel(): void {
    cancelled = true
    if (timer) clearTimeout(timer)
    opts.signal.removeEventListener('abort', onAbort)
  }

  function tick(): void {
    if (cancelled || opts.signal.aborted) return
    opts
      .refresh()
      .then(next => {
        shortFails = 0
        if (next !== undefined && next > 0) intervalMs = next
      })
      .catch(err => {
        shortFails++
        opts.onError(err)
      })
      .finally(() => {
        if (cancelled || opts.signal.aborted) return
        const delay =
          shortFails > 0 && shortFails <= maxShortRetries
            ? Math.min(errorRetryMs, intervalMs)
            : intervalMs
        timer = setTimeout(tick, delay)
      })
  }

  timer = setTimeout(tick, intervalMs)
  return { cancel }
}
