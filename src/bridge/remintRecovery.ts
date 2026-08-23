/**
 * densable 2.1.232 #39 — Remote Control remint / reconnect recovery.
 *
 * Gold (SEA):
 *   vjp=30000, Sjp=300000, Ejp=5000, buv=14
 *   vuv="could not reach the Remote Control server for about 30 minutes"
 *   wjp="the connection to the Remote Control server kept dropping after each reconnect"
 *   Tjp={attempts:buv, exhaustedDetail:vuv}
 *   yjp=3, _jp=3600000, bjp=24*yjp, yuv=24*_jp, _uv=600000
 *   kjp() heartbeat budget: charge → hourly_exhausted | daily_exhausted | charged
 *   si=3 general consecutive recovery cap; yt=3 epoch_stale/hour; Zr=5000 jitter
 *   ms=2*(15000+So+Qn) recovery-flag leak ceiling (So=init retry budget, Qn=oauth)
 *   work-bridge cMS.connGiveUpMs=600000 (10 min)
 *   Ls($t,Jr,qo=!1) onClose disposition (defer / leak force / budgets / recover / fail)
 *
 * 4093 (presence heartbeats) uses remintCap=Tjp (retry loop).
 * Other codes use single recovery or terminal fail per densable `oa` table.
 */

/** densable vjp — remint backoff initial (ms). */
export const REMINT_BACKOFF_INITIAL_MS = 30_000

/** densable Sjp — remint backoff cap (ms). */
export const REMINT_BACKOFF_CAP_MS = 300_000

/** densable Ejp — remint backoff floor jitter (ms). */
export const REMINT_BACKOFF_FLOOR_MS = 5_000

/** densable buv — max remint attempts for 4093 heartbeat recovery. */
export const REMINT_MAX_ATTEMPTS = 14

/**
 * densable vuv — user-facing detail when remint attempts are exhausted.
 * Matches changelog “~30min reconnect” product copy.
 */
export const REMINT_EXHAUSTED_DETAIL =
  'could not reach the Remote Control server for about 30 minutes'

/** densable wjp — alternate exhausted detail (drop-after-reconnect). */
export const REMINT_DROPPING_DETAIL =
  'the connection to the Remote Control server kept dropping after each reconnect'

/** densable yjp / bjp — drop-count daily cap narrative (3/hour × 24). */
export const REMINT_HOURLY_DROP_CAP = 3
export const REMINT_HOURLY_WINDOW_MS = 3_600_000
export const REMINT_DAILY_DROP_CAP = 24 * REMINT_HOURLY_DROP_CAP
export const REMINT_DAILY_WINDOW_MS = 24 * REMINT_HOURLY_WINDOW_MS

/** densable _uv — healthy beat gap that resets hourly window baseline. */
export const REMINT_HEALTHY_BEAT_GAP_MS = 600_000

/**
 * densable si — max consecutive recoveries across recoverable codes before
 * hard fail (`_o >= si` in Ls).
 */
export const GENERAL_RECOVERY_ATTEMPT_CAP = 3

/**
 * densable yt / Wt — epoch_stale (4090 cause=epoch_stale) re-registrations
 * allowed per hour window.
 */
export const EPOCH_STALE_BUDGET_CAP = 3
export const EPOCH_STALE_WINDOW_MS = 3_600_000

/** densable Zr — jitter delay upper bound for epoch_stale recovery entry. */
export const EPOCH_STALE_RECOVERY_JITTER_MS = 5_000

/** densable work-bridge cMS — connection error give-up (ms). */
export const BRIDGE_CONN_GIVE_UP_MS = 600_000 // 10 minutes

export type RemintCap = {
  attempts: number
  exhaustedDetail: string
}

/** densable Tjp */
export const HEARTBEAT_4093_REMINT_CAP: RemintCap = {
  attempts: REMINT_MAX_ATTEMPTS,
  exhaustedDetail: REMINT_EXHAUSTED_DETAIL,
}

export type CloseRecoveryPolicy = {
  /** densable reconnectingDetail — shown while recovering */
  reconnectingDetail: string
  cause: string
  failureDiagnostic: string
  /**
   * densable fetchFailure:
   * - terminal → one recovery attempt then fail
   * - retry → use remintCap loop when set
   */
  fetchFailure: 'terminal' | 'retry'
  remintCap?: RemintCap
  recoveredCode: string
  needsOAuthRefresh: boolean
}

/**
 * densable `oa` close-code recovery table (env-less REPL v2).
 * Only codes that densable routes through recovery (not silent SSE reconnect).
 */
export const CLOSE_CODE_RECOVERY: Readonly<
  Record<number, CloseRecoveryPolicy>
> = {
  401: {
    reconnectingDetail: 'JWT expired — refreshing',
    cause: 'auth_401_recovery',
    failureDiagnostic: 'bridge_repl_v2_jwt_refresh_failed',
    fetchFailure: 'terminal',
    remintCap: undefined,
    recoveredCode: 'recovered_auth_401',
    needsOAuthRefresh: true,
  },
  4090: {
    reconnectingDetail: 'session registration went stale — re-registering',
    cause: 'epoch_stale_recovery',
    failureDiagnostic: 'bridge_repl_v2_epoch_stale_recovery_failed',
    fetchFailure: 'terminal',
    remintCap: undefined,
    recoveredCode: 'recovered_epoch_stale',
    needsOAuthRefresh: false,
  },
  4091: {
    reconnectingDetail: 'CCR init failed — retrying',
    cause: 'init_4091_recovery',
    failureDiagnostic: 'bridge_repl_v2_4091_recovery_failed',
    fetchFailure: 'terminal',
    remintCap: undefined,
    recoveredCode: 'recovered_init_4091',
    needsOAuthRefresh: false,
  },
  4093: {
    reconnectingDetail: 'presence heartbeats failing — reconnecting',
    cause: 'heartbeat_4093_recovery',
    failureDiagnostic: 'bridge_repl_v2_4093_recovery_failed',
    fetchFailure: 'retry',
    remintCap: HEARTBEAT_4093_REMINT_CAP,
    recoveredCode: 'recovered_heartbeat_4093',
    needsOAuthRefresh: false,
  },
  4094: {
    reconnectingDetail: 'worker credential expired — re-minting',
    cause: 'cred_4094_recovery',
    failureDiagnostic: 'bridge_repl_v2_4094_recovery_failed',
    fetchFailure: 'terminal',
    remintCap: undefined,
    recoveredCode: 'recovered_cred_4094',
    needsOAuthRefresh: true,
  },
}

/**
 * densable kd — codes that may attempt recovery (vs immediate fail).
 * Gold: `if($t===4094)return Skr(); return $t===401||$t===4091||$t===4093`
 * **4090 is NOT in kd** — only the separate Ls branch
 * `4090 && cause==="epoch_stale" && Ot()` may recover (see
 * `isEpochStaleRecoverableClose` / `evaluateEpochStaleRecoveryBudget`).
 * 4094 is gated by densable Skr(); default treat as recoverable.
 */
export function isRecoverableCloseCode(
  code: number | undefined,
  opts?: { allow4094?: boolean },
): boolean {
  if (code === undefined) return false
  if (code === 401 || code === 4091 || code === 4093) return true
  if (code === 4094) return opts?.allow4094 !== false
  return false
}

/**
 * densable Ls epoch_stale branch gate (outside kd):
 * `$t===4090 && Jr==="epoch_stale" && Ot()`
 * Ot = tengu_bridge_recover_stale_epoch, densable default **false**.
 *
 * densable requires Jr === "epoch_stale" only. gzp may emit `epoch_conflict`
 * for HTTP 409 — that is a true supersession and must NOT enter Ba remint
 * (would thrash against the newer epoch).
 */
export function isEpochStaleRecoverableClose(
  code: number | undefined,
  cause: string | undefined,
  recoverStaleEpochEnabled: boolean,
): boolean {
  return (
    code === 4090 &&
    cause === 'epoch_stale' &&
    recoverStaleEpochEnabled === true
  )
}

/**
 * densable remint backoff: min(vjp * 2^(attempt-1), Sjp), floor random jitter Ejp.
 * attempt is 1-based.
 */
export function remintBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(
    REMINT_BACKOFF_INITIAL_MS * 2 ** Math.max(0, attempt - 1),
    REMINT_BACKOFF_CAP_MS,
  )
  return Math.max(random() * exp, REMINT_BACKOFF_FLOOR_MS)
}

/**
 * densable nn OAuth adopt-loop delay:
 *   base = oauth_retry_base_delay_ms * 2^(attempt-1)
 *   delay = base + base * jitter_fraction * (2*random-1)
 * attempt is 1-based.
 */
export function oauthAdoptBackoffMs(
  attempt: number,
  baseDelayMs: number,
  jitterFraction: number,
  random: () => number = Math.random,
): number {
  const base = baseDelayMs * 2 ** Math.max(0, attempt - 1)
  const jitter = base * jitterFraction * (2 * random() - 1)
  return Math.max(0, base + jitter)
}

/** densable nn adopt-loop status UI. */
export function formatOAuthAdoptRetryStatus(
  attempt: number,
  maxAttempts: number,
): string {
  return `OAuth refresh failed — waiting for a fresh login (${attempt}/${maxAttempts})`
}

/** densable nn reauth-required user message (remint Hde after adopt). Keep 1:1. */
export const OAUTH_REAUTH_REQUIRED_DETAIL =
  'OAuth token refresh failed — run /login to re-authenticate'

/** densable cr — remint missing oauth after signed_out classifier miss. */
export const JWT_REFRESH_NO_OAUTH_DETAIL =
  'JWT refresh failed: no OAuth token — run /login'

/** densable kt — session-create `terminal===false` (401 oauth_rejected). */
export const CLAUDE_AI_LOGIN_REJECTED_DETAIL =
  'Claude.ai login was rejected — run /login, then /remote-control'

/** densable Gt — initial `/bridge` soe/Hde. */
export const CLAUDE_AI_LOGIN_EXPIRED_THEN_REMOTE_CONTROL_DETAIL =
  'Claude.ai login expired — run /login, then /remote-control'

/** densable yr — proactive refresh null/soe. */
export const CLAUDE_AI_LOGIN_EXPIRED_RESTORE_DETAIL =
  'Claude.ai login expired — run /login to restore Remote Control'

/** densable x1r onExhausted copy. */
export const OAUTH_TOKEN_UNAVAILABLE_RESTORE_DETAIL =
  'OAuth token unavailable — run /login to restore Remote Control'

/**
 * densable G7 fail / rebuild suppress — session already teleported to cloud.
 * nn: Ds("Session teleported to cloud"); Xl: "suppressed_teleported"
 */
export const SESSION_TELEPORTED_DETAIL = 'Session teleported to cloud'

/**
 * densable gzp — request-path condition → close code for Ls recovery.
 * Used when causeTypedCloseCodes is on (env-less v2).
 */
export const CLASSIFIED_CLOSE_REASON_CODES: Readonly<Record<string, number>> = {
  epoch_conflict: 4090,
  superseded_by_worker: 4090,
  session_not_active: 4090,
  epoch_stale: 4090,
  session_not_found: 4090,
  token_expired: 4094,
  auth_exhausted: 4094,
}

/** densable: code = causeTypedCloseCodes ? gzp[reason] : 4090 */
export function closeCodeForClassifiedReason(
  reason: string,
  opts?: { causeTypedCloseCodes?: boolean },
): number {
  if (opts?.causeTypedCloseCodes === false) return 4090
  return CLASSIFIED_CLOSE_REASON_CODES[reason] ?? 4090
}

/** densable Co(Jr) — telemetry close_cause string (empty if absent). */
export function formatCloseCause(cause: string | undefined): string {
  return cause ?? ''
}

/**
 * densable Xn / To / Vo — recovery-in-flight ownership token.
 * Only the owner of the active generation may clear the flag (To).
 * Vo force-clears (leak path).
 */
export type RecoveryFlight = {
  /** densable Tr */
  inFlight: boolean
  /** densable Fi */
  startedAtMs: number
  /** densable sn — active generation; 0 when idle */
  activeGen: number
}

export function createRecoveryFlight(): {
  state: RecoveryFlight
  /** densable Xn — claim flag, return generation */
  begin: () => number
  /** densable To — clear only if gen still owns; return true if cleared */
  endIfOwner: (gen: number) => boolean
  /** densable Vo — force clear (leak) */
  forceClear: () => void
} {
  const state: RecoveryFlight = {
    inFlight: false,
    startedAtMs: 0,
    activeGen: 0,
  }
  let counter = 0
  return {
    state,
    begin() {
      counter += 1
      state.inFlight = true
      state.startedAtMs = Date.now()
      state.activeGen = counter
      return counter
    },
    endIfOwner(gen) {
      if (state.activeGen !== gen) return false
      state.inFlight = false
      state.startedAtMs = 0
      state.activeGen = 0
      return true
    },
    forceClear() {
      state.inFlight = false
      state.startedAtMs = 0
      state.activeGen = 0
    },
  }
}

/**
 * densable UI string while reminting after unreachable:
 * `Remote Control server unreachable — retrying (attempt N[, Mm elapsed])`
 */
export function formatRemintRetryStatus(
  attempt: number,
  elapsedMs: number,
): string {
  const minutes = Math.round(elapsedMs / 60_000)
  const elapsed = minutes > 0 ? `, ${minutes}m elapsed` : ''
  return `Remote Control server unreachable — retrying (attempt ${attempt}${elapsed})`
}

/**
 * densable exhausted user message for remint loop.
 */
export function formatRemintExhaustedMessage(
  code: number,
  attempts: number,
  elapsedMs: number,
  detail: string = REMINT_EXHAUSTED_DETAIL,
): string {
  const secs = Math.round(elapsedMs / 1000)
  return `Re-mint loop exhausted (code ${code}): ${attempts} unreachable attempts, ${secs}s — ${detail}`
}

/** densable Ajp */
export function formatRemintDailyDropExhaustedDetail(
  dailyCap: number = REMINT_DAILY_DROP_CAP,
): string {
  return `the connection to the Remote Control server dropped more than ${dailyCap} times in 24 hours`
}

/**
 * densable ms leak-ceiling formula:
 *   So = init_retry_max_attempts * http_timeout_ms
 *      + (init_retry_max_attempts - 1) * init_retry_max_delay_ms
 *   Qn = oauth_retry_base_delay_ms * (2**oauth_retry_max_attempts - 1)
 *      + oauth_retry_max_attempts * So
 *   ms = 2 * (15000 + So + Qn)
 */
export type LeakCeilingConfig = {
  init_retry_max_attempts: number
  init_retry_max_delay_ms: number
  http_timeout_ms: number
  oauth_retry_max_attempts: number
  oauth_retry_base_delay_ms: number
}

export function computeRecoveryLeakCeilingMs(cfg: LeakCeilingConfig): number {
  const so =
    cfg.init_retry_max_attempts * cfg.http_timeout_ms +
    (cfg.init_retry_max_attempts - 1) * cfg.init_retry_max_delay_ms
  const qn =
    cfg.oauth_retry_base_delay_ms * (2 ** cfg.oauth_retry_max_attempts - 1) +
    cfg.oauth_retry_max_attempts * so
  return 2 * (15_000 + so + qn)
}

/**
 * densable kjp — heartbeat (4093) recovery budget tracker.
 * charge(now, patienceEnabled) → hourly_exhausted | daily_exhausted | charged
 * noteHealthyBeat resets the post-healthy-window baseline for hourly counting.
 */
export type HeartbeatBudgetVerdict =
  | 'charged'
  | 'hourly_exhausted'
  | 'daily_exhausted'

export type HeartbeatRecoveryBudget = {
  charge: (nowMs: number, patienceEnabled: boolean) => HeartbeatBudgetVerdict
  noteHealthyBeat: (nowMs: number) => void
}

export function createHeartbeatRecoveryBudget(): HeartbeatRecoveryBudget {
  let stamps: number[] = []
  let healthyBaseline = Number.NEGATIVE_INFINITY
  return {
    charge(nowMs, patienceEnabled) {
      stamps = stamps.filter(t => nowMs - t < REMINT_DAILY_WINDOW_MS)
      if (patienceEnabled && stamps.length >= REMINT_DAILY_DROP_CAP) {
        return 'daily_exhausted'
      }
      const hourly = stamps.filter(
        t =>
          nowMs - t < REMINT_HOURLY_WINDOW_MS &&
          (!patienceEnabled || t >= healthyBaseline),
      ).length
      if (hourly >= REMINT_HOURLY_DROP_CAP) {
        return 'hourly_exhausted'
      }
      stamps.push(nowMs)
      return 'charged'
    },
    noteHealthyBeat(nowMs) {
      const last = stamps.at(-1)
      if (last !== undefined && nowMs - last >= REMINT_HEALTHY_BEAT_GAP_MS) {
        healthyBaseline = nowMs
      }
    },
  }
}

/** densable deferred close payload `Ei={code, cause}`. */
export type DeferredClose = {
  code: number
  cause?: string
}

/**
 * densable 232 #39 onClose disposition (Ls pre-budget gate).
 *
 * - stale transport (replaced by rebuild) → ignore
 * - recovery in flight on *current* transport within leak ceiling → defer
 * - recovery in flight past leak ceiling → leak (caller force-clears flag)
 * - recoverable code → recover
 * - else → fail
 *
 * Critical: do NOT blanket-ignore all closes while recoveryInFlight — a *new*
 * transport that dies immediately after rebuild would be swallowed. Stale
 * closes are filtered by generation; deferred closes re-dispatch after recovery.
 */
export type CloseDisposition = 'ignore' | 'defer' | 'leak' | 'recover' | 'fail'

export function disposeTransportClose(input: {
  tornDown?: boolean
  /** Callback wired for a previous transport generation. */
  staleTransport?: boolean
  authRecoveryInFlight: boolean
  code: number | undefined
  /**
   * densable Fi — when recovery flag was raised (ms epoch). 0/undefined →
   * held duration treated as 0 (still within ceiling → defer).
   */
  recoveryStartedAtMs?: number
  /** densable ms leak ceiling. Required when authRecoveryInFlight. */
  leakCeilingMs?: number
  nowMs?: number
  isRecoverable?: (code: number) => boolean
}): CloseDisposition {
  if (input.tornDown) return 'ignore'
  if (input.staleTransport) return 'ignore'
  if (input.authRecoveryInFlight) {
    const started = input.recoveryStartedAtMs ?? 0
    const now = input.nowMs ?? Date.now()
    const held = started > 0 ? now - started : 0
    const ceiling = input.leakCeilingMs ?? Number.POSITIVE_INFINITY
    // densable: tu<=ms → defer Ei; else leak force-handle
    if (held <= ceiling) return 'defer'
    return 'leak'
  }
  const recoverable =
    input.isRecoverable ?? ((c: number) => isRecoverableCloseCode(c))
  if (input.code !== undefined && recoverable(input.code)) return 'recover'
  return 'fail'
}

/**
 * densable Ls recoverable-code budget gate (runs after leak/defer handling,
 * before nn() recovery entry). Mutates nothing — returns next counters +
 * whether to enter recovery or fail.
 */
export type RecoveryBudgetCounters = {
  /** densable _o — consecutive recovery entries since last success. */
  consecutiveRecoveries: number
  /** densable Ws — 4094 recoveries without a successful heartbeat between. */
  cred4094WithoutBeat: number
  /** densable Ba — epoch_stale recovery timestamps (ms). */
  epochStaleTimestamps: number[]
}

export type BudgetGateResult =
  | {
      ok: true
      counters: RecoveryBudgetCounters
      /** densable nn($t, delay) optional pre-delay (epoch_stale jitter). */
      delayMs?: number
    }
  | {
      ok: false
      message: string
      diagnostic: string
      /** densable ne(...) event name */
      event: string
      eventMeta?: Record<string, number>
    }

/**
 * densable kd-path budgets only (401/4091/4093/4094).
 * Call only when `isRecoverableCloseCode(code)`.
 * 4090 epoch_stale uses `evaluateEpochStaleRecoveryBudget` instead.
 */
export function evaluateRecoverableCloseBudgets(input: {
  code: number
  /**
   * densable qo — recursive re-entry from same recovery path; skips 4093/4094
   * budget charges (still checks general _o).
   */
  reentry?: boolean
  counters: RecoveryBudgetCounters
  heartbeatBudget: HeartbeatRecoveryBudget
  /**
   * densable ut() = tengu_bridge_recovery_patience. When false, daily budget
   * is not enforced and hourly filter ignores healthy baseline.
   */
  recoveryPatienceEnabled?: boolean
  nowMs?: number
}): BudgetGateResult {
  const now = input.nowMs ?? Date.now()
  const reentry = input.reentry === true
  let { consecutiveRecoveries, cred4094WithoutBeat, epochStaleTimestamps } =
    input.counters

  // densable: if(_o>=si) exhaust
  if (consecutiveRecoveries >= GENERAL_RECOVERY_ATTEMPT_CAP) {
    return {
      ok: false,
      message: `Transport recovery exhausted (code ${input.code})`,
      diagnostic: 'bridge_repl_v2_recovery_exhausted',
      event: 'recovery_exhausted',
      eventMeta: { close_code: input.code },
    }
  }

  // densable 4094 Ws budget (skipped on qo reentry)
  if (input.code === 4094 && !reentry) {
    if (cred4094WithoutBeat >= GENERAL_RECOVERY_ATTEMPT_CAP) {
      return {
        ok: false,
        message: 'Transport recovery exhausted (worker credential failures)',
        diagnostic: 'bridge_repl_v2_cred_recovery_exhausted',
        event: 'cred_recovery_exhausted',
      }
    }
    cred4094WithoutBeat++
  }

  // densable 4093 Ua.charge (skipped on qo reentry)
  if (input.code === 4093 && !reentry) {
    const verdict = input.heartbeatBudget.charge(
      now,
      input.recoveryPatienceEnabled !== false,
    )
    if (verdict === 'hourly_exhausted' || verdict === 'daily_exhausted') {
      const windowH = verdict === 'hourly_exhausted' ? 1 : 24
      return {
        ok: false,
        message:
          verdict === 'hourly_exhausted'
            ? REMINT_DROPPING_DETAIL
            : formatRemintDailyDropExhaustedDetail(),
        diagnostic: 'bridge_repl_v2_heartbeat_budget_exhausted',
        event: 'heartbeat_budget_exhausted',
        eventMeta: { window_h: windowH },
      }
    }
  }

  return {
    ok: true,
    counters: {
      consecutiveRecoveries: consecutiveRecoveries + 1,
      cred4094WithoutBeat,
      epochStaleTimestamps,
    },
  }
}

/**
 * densable Ls branch outside kd:
 * `$t===4090 && Jr==="epoch_stale" && Ot()` → Ba window budget + nn(4090, jitter).
 * Caller must already gate with `isEpochStaleRecoverableClose`.
 */
export function evaluateEpochStaleRecoveryBudget(input: {
  counters: RecoveryBudgetCounters
  nowMs?: number
  random?: () => number
}): BudgetGateResult {
  const now = input.nowMs ?? Date.now()
  let { consecutiveRecoveries, cred4094WithoutBeat, epochStaleTimestamps } =
    input.counters

  if (consecutiveRecoveries >= GENERAL_RECOVERY_ATTEMPT_CAP) {
    return {
      ok: false,
      message: 'Transport recovery exhausted (code 4090)',
      diagnostic: 'bridge_repl_v2_recovery_exhausted',
      event: 'recovery_exhausted',
      eventMeta: { close_code: 4090 },
    }
  }

  epochStaleTimestamps = epochStaleTimestamps.filter(
    t => now - t < EPOCH_STALE_WINDOW_MS,
  )
  if (epochStaleTimestamps.length >= EPOCH_STALE_BUDGET_CAP) {
    return {
      ok: false,
      message:
        'the session registration kept going stale after repeated reconnects',
      diagnostic: 'bridge_repl_v2_epoch_stale_budget_exhausted',
      event: 'epoch_stale_budget_exhausted',
    }
  }
  epochStaleTimestamps = [...epochStaleTimestamps, now]
  const random = input.random ?? Math.random
  return {
    ok: true,
    counters: {
      consecutiveRecoveries: consecutiveRecoveries + 1,
      cred4094WithoutBeat,
      epochStaleTimestamps,
    },
    delayMs: random() * EPOCH_STALE_RECOVERY_JITTER_MS,
  }
}

/**
 * densable ul() — healthy auth/heartbeat: Ws=0 + Ua.noteHealthyBeat.
 * densable th onConnect also sets _o=0 (see noteRecoverySuccess).
 */
export function noteHealthyAuthBeat(
  counters: RecoveryBudgetCounters,
  heartbeatBudget: HeartbeatRecoveryBudget,
  nowMs: number = Date.now(),
): RecoveryBudgetCounters {
  heartbeatBudget.noteHealthyBeat(nowMs)
  return {
    ...counters,
    cred4094WithoutBeat: 0,
  }
}

/** Reset consecutive recovery counter after a successful rebuild. */
export function noteRecoverySuccess(
  counters: RecoveryBudgetCounters,
): RecoveryBudgetCounters {
  return {
    ...counters,
    consecutiveRecoveries: 0,
  }
}
