/**
 * densable 2.1.224 token refresh scheduler (tur / qUi) + push helpers (q2h / j2h).
 * 1:1 from SEA `/tmp/shr-extract-224/token-*.js`.
 */

/** densable `Zo_` — default refresh buffer (5 min) */
export const DEFAULT_REFRESH_BUFFER_MS = 300_000
/** densable `ei_` — default max consecutive no-oauth failures */
export const DEFAULT_MAX_REFRESH_FAILURES = 3
/** densable `ti_` — retry after missing oauth */
export const NO_OAUTH_RETRY_MS = 60_000
/** densable `jas` — non-JWT / follow-up refresh interval (30 min) */
export const FALLBACK_REFRESH_MS = 1_800_000
/** densable `j2h` default ack grace */
export const TOKEN_ACK_GRACE_MS = 90_000

export type TokenRefreshScheduler = {
  schedule: (sessionId: string, token: string) => void
  scheduleFromExpiresIn: (sessionId: string, expiresInSeconds: number) => void
  cancel: (sessionId: string) => void
  cancelAll: () => void
}

export type CreateTokenRefreshOpts = {
  getAccessToken: () => Promise<string | null | undefined>
  onRefresh: (sessionId: string, token: string) => void
  label: string
  refreshBufferMs?: number
  maxFailures?: number
  adaptiveBuffer?: boolean
  rescheduleFromNewToken?: boolean
  decodeExpiry?: (token: string) => number | null
  formatDelay?: (ms: number) => string
  onLog?: (msg: string, meta?: { level?: string }) => void
}

/** densable `xUe` — JWT exp (seconds) after optional sk-ant strip is caller's job for jJl */
export function decodeJwtExpirySeconds(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const json = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

/**
 * densable `jJl` — strip `sk-ant-<kind>-` then decode exp.
 */
export function decodeRunnerTokenExpirySeconds(token: string): number | null {
  return decodeJwtExpirySeconds(token.replace(/^sk-ant-[a-z]+-/, ''))
}

/** densable `Ws` subset — compact delay string for logs */
export function formatDelayMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/**
 * densable `tur` — per-session token refresh scheduler.
 */
export function createTokenRefreshScheduler(
  opts: CreateTokenRefreshOpts,
): TokenRefreshScheduler {
  const refreshBufferMs = opts.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS
  const maxFailures = opts.maxFailures ?? DEFAULT_MAX_REFRESH_FAILURES
  const adaptiveBuffer = opts.adaptiveBuffer ?? false
  const rescheduleFromNewToken = opts.rescheduleFromNewToken ?? false
  const decodeExpiry = opts.decodeExpiry ?? decodeJwtExpirySeconds
  const formatDelay = opts.formatDelay ?? formatDelayMs
  const log =
    opts.onLog ??
    ((msg: string) => {
      // densable uses shared logger; default no-op for pure unit use
      void msg
    })

  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const failCounts = new Map<string, number>()
  const generations = new Map<string, number>()

  const bumpGen = (sessionId: string): number => {
    const n = (generations.get(sessionId) ?? 0) + 1
    generations.set(sessionId, n)
    return n
  }

  const doRefresh = async (sessionId: string, gen: number): Promise<void> => {
    let token: string | null | undefined
    try {
      token = await opts.getAccessToken()
    } catch (err) {
      log(
        `[${opts.label}:token] getAccessToken threw for sessionId=${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        { level: 'error' },
      )
    }
    if (generations.get(sessionId) !== gen) {
      log(
        `[${opts.label}:token] doRefresh for sessionId=${sessionId} stale (gen ${gen} vs ${generations.get(sessionId)}), skipping`,
      )
      return
    }
    if (!token) {
      const fails = (failCounts.get(sessionId) ?? 0) + 1
      failCounts.set(sessionId, fails)
      log(
        `[${opts.label}:token] No OAuth token available for refresh, sessionId=${sessionId} (failure ${fails}${Number.isFinite(maxFailures) ? `/${maxFailures}` : ''})`,
        { level: 'error' },
      )
      if (fails < maxFailures) {
        const t = setTimeout(doRefresh, NO_OAUTH_RETRY_MS, sessionId, gen)
        timers.set(sessionId, t)
      }
      return
    }
    failCounts.delete(sessionId)
    log(
      `[${opts.label}:token] Refreshing token for sessionId=${sessionId}: new token prefix=${token.slice(0, 15)}…`,
    )
    opts.onRefresh(sessionId, token)
    if (rescheduleFromNewToken && decodeExpiry(token)) {
      schedule(sessionId, token)
      return
    }
    const t = setTimeout(doRefresh, FALLBACK_REFRESH_MS, sessionId, gen)
    timers.set(sessionId, t)
    log(
      rescheduleFromNewToken
        ? `[${opts.label}:token] Non-JWT token — scheduled fallback refresh for sessionId=${sessionId} in ${formatDelay(FALLBACK_REFRESH_MS)}`
        : `[${opts.label}:token] Scheduled follow-up refresh for sessionId=${sessionId} in ${formatDelay(FALLBACK_REFRESH_MS)}`,
    )
  }

  function schedule(sessionId: string, token: string): void {
    const exp = decodeExpiry(token)
    if (!exp) {
      log(
        `[${opts.label}:token] Could not decode JWT expiry for sessionId=${sessionId}, token prefix=${token.slice(0, 15)}…, keeping existing timer`,
      )
      return
    }
    const prev = timers.get(sessionId)
    if (prev) clearTimeout(prev)
    const gen = bumpGen(sessionId)
    const expiresIso = new Date(exp * 1000).toISOString()
    const untilMs = exp * 1000 - Date.now()
    const buffer = adaptiveBuffer
      ? Math.min(refreshBufferMs, Math.max(1000, Math.floor(untilMs * 0.2)))
      : refreshBufferMs
    const delay = untilMs - buffer
    if (delay <= 0) {
      log(
        `[${opts.label}:token] Token for sessionId=${sessionId} expires=${expiresIso} (past or within buffer), refreshing immediately`,
      )
      void doRefresh(sessionId, gen)
      return
    }
    const bufferLog = adaptiveBuffer
      ? Math.round(buffer / 1000)
      : refreshBufferMs / 1000
    log(
      `[${opts.label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDelay(delay)} (expires=${expiresIso}, buffer=${bufferLog}s)`,
    )
    const t = setTimeout(doRefresh, delay, sessionId, gen)
    timers.set(sessionId, t)
  }

  function scheduleFromExpiresIn(
    sessionId: string,
    expiresInSeconds: number,
  ): void {
    const prev = timers.get(sessionId)
    if (prev) clearTimeout(prev)
    const gen = bumpGen(sessionId)
    const delay = Math.max(expiresInSeconds * 1000 - refreshBufferMs, 30_000)
    log(
      `[${opts.label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDelay(delay)} (expires_in=${expiresInSeconds}s, buffer=${refreshBufferMs / 1000}s)`,
    )
    const t = setTimeout(doRefresh, delay, sessionId, gen)
    timers.set(sessionId, t)
  }

  function cancel(sessionId: string): void {
    bumpGen(sessionId)
    const t = timers.get(sessionId)
    if (t) {
      clearTimeout(t)
      timers.delete(sessionId)
    }
    failCounts.delete(sessionId)
  }

  function cancelAll(): void {
    for (const id of generations.keys()) bumpGen(id)
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    failCounts.clear()
  }

  return { schedule, scheduleFromExpiresIn, cancel, cancelAll }
}

/**
 * densable `qUi` — runner-token scheduler preset (infinite failures, adaptive buffer).
 */
export function createRunnerTokenRefreshScheduler(
  opts: Omit<
    CreateTokenRefreshOpts,
    | 'maxFailures'
    | 'adaptiveBuffer'
    | 'rescheduleFromNewToken'
    | 'decodeExpiry'
    | 'formatDelay'
  >,
): TokenRefreshScheduler {
  return createTokenRefreshScheduler({
    ...opts,
    maxFailures: Number.POSITIVE_INFINITY,
    adaptiveBuffer: true,
    rescheduleFromNewToken: true,
    decodeExpiry: decodeRunnerTokenExpirySeconds,
    formatDelay: formatDelayMs,
  })
}

export type PendingTokenAck = { label: string; sentAtMs: number }

/**
 * densable `j2h` — warn + drop unacked stdin token pushes after grace.
 */
export function sweepPendingTokenAcks(opts: {
  pendingAcks: Map<string, PendingTokenAck>
  sessionId: string
  onStatus: (msg: string) => void
  nowMs?: number
  graceMs?: number
}): void {
  const now = opts.nowMs ?? Date.now()
  const grace = opts.graceMs ?? TOKEN_ACK_GRACE_MS
  for (const [id, ack] of opts.pendingAcks) {
    if (now - ack.sentAtMs < grace) continue
    opts.onStatus(
      `[runner:session] WARNING: ${ack.label} update ${id} for ${opts.sessionId} was never acked by the child — the stdin control channel may be severed (wrapper backgrounding without <&0?). Token rotation is NOT reaching the child; it will 401 at token TTL. See docs/self-hosted-runners-guide.md § "The child must keep the runner's stdin".`,
    )
    opts.pendingAcks.delete(id)
  }
}

let tokenPushSeq = 0

/**
 * densable `q2h` — push refreshed env var to child via stdin control message.
 * Returns request_id when pendingAcks tracking is enabled.
 */
export function pushTokenToChild(opts: {
  label: string
  sessionId: string
  envVar: string
  token: string
  write?: ((line: string) => void) | null
  pendingAcks?: Map<string, PendingTokenAck>
  onStatus: (msg: string) => void
  expiresInSeconds?: number
  nowMs?: number
}): string | undefined {
  const exp =
    opts.expiresInSeconds !== undefined
      ? ` (expires_in=${opts.expiresInSeconds}s)`
      : ''
  if (!opts.write) {
    opts.onStatus(
      `[runner:session] ${opts.label} refreshed for ${opts.sessionId} but child stdin is not wired yet — token NOT delivered; next interval will retry${exp}`,
    )
    return undefined
  }
  let requestId: string | undefined
  if (opts.pendingAcks) {
    tokenPushSeq++
    requestId = `shr-token-${opts.label}-${tokenPushSeq}`
    opts.pendingAcks.set(requestId, {
      label: opts.label,
      sentAtMs: opts.nowMs ?? Date.now(),
    })
  }
  const msg = {
    type: 'update_environment_variables',
    variables: { [opts.envVar]: opts.token },
    ...(requestId ? { request_id: requestId } : {}),
  }
  opts.write(`${JSON.stringify(msg)}\n`)
  opts.onStatus(
    `[runner:session] ${opts.label} refreshed for ${opts.sessionId} — pushed to child via stdin${exp}${requestId ? ` [${requestId}]` : ''}`,
  )
  return requestId
}

/** test helper — reset push sequence */
export function __resetTokenPushSeqForTests(): void {
  tokenPushSeq = 0
}
