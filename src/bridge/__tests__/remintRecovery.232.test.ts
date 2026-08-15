import { describe, expect, test } from 'bun:test'
import {
  BRIDGE_CONN_GIVE_UP_MS,
  CLOSE_CODE_RECOVERY,
  computeRecoveryLeakCeilingMs,
  createHeartbeatRecoveryBudget,
  createRecoveryFlight,
  disposeTransportClose,
  evaluateEpochStaleRecoveryBudget,
  evaluateRecoverableCloseBudgets,
  formatOAuthAdoptRetryStatus,
  formatRemintDailyDropExhaustedDetail,
  formatRemintExhaustedMessage,
  formatRemintRetryStatus,
  GENERAL_RECOVERY_ATTEMPT_CAP,
  HEARTBEAT_4093_REMINT_CAP,
  isEpochStaleRecoverableClose,
  isRecoverableCloseCode,
  noteHealthyAuthBeat,
  noteRecoverySuccess,
  OAUTH_REAUTH_REQUIRED_DETAIL,
  oauthAdoptBackoffMs,
  REMINT_BACKOFF_CAP_MS,
  REMINT_BACKOFF_INITIAL_MS,
  REMINT_DAILY_DROP_CAP,
  REMINT_EXHAUSTED_DETAIL,
  REMINT_HOURLY_DROP_CAP,
  REMINT_MAX_ATTEMPTS,
  remintBackoffMs,
} from '../remintRecovery.js'

/**
 * densable 2.1.232 #39 — remint / reconnect constants + Ls onClose.
 */
describe('remintRecovery densable 232 #39', () => {
  test('Tjp / constants 1:1', () => {
    expect(REMINT_MAX_ATTEMPTS).toBe(14)
    expect(REMINT_BACKOFF_INITIAL_MS).toBe(30_000)
    expect(REMINT_BACKOFF_CAP_MS).toBe(300_000)
    expect(HEARTBEAT_4093_REMINT_CAP).toEqual({
      attempts: 14,
      exhaustedDetail: REMINT_EXHAUSTED_DETAIL,
    })
    expect(REMINT_EXHAUSTED_DETAIL).toContain('about 30 minutes')
    expect(BRIDGE_CONN_GIVE_UP_MS).toBe(600_000)
    expect(GENERAL_RECOVERY_ATTEMPT_CAP).toBe(3)
    expect(REMINT_HOURLY_DROP_CAP).toBe(3)
    expect(REMINT_DAILY_DROP_CAP).toBe(72)
  })

  test('4093 policy uses remintCap Tjp', () => {
    const p = CLOSE_CODE_RECOVERY[4093]!
    expect(p.fetchFailure).toBe('retry')
    expect(p.remintCap).toEqual(HEARTBEAT_4093_REMINT_CAP)
    expect(p.reconnectingDetail).toContain('presence heartbeats')
    expect(p.recoveredCode).toBe('recovered_heartbeat_4093')
  })

  test('kd recoverable codes — densable excludes bare 4090', () => {
    expect(isRecoverableCloseCode(401)).toBe(true)
    expect(isRecoverableCloseCode(4091)).toBe(true)
    expect(isRecoverableCloseCode(4093)).toBe(true)
    expect(isRecoverableCloseCode(4094)).toBe(true)
    expect(isRecoverableCloseCode(4094, { allow4094: false })).toBe(false)
    // densable kd does NOT include 4090
    expect(isRecoverableCloseCode(4090)).toBe(false)
    expect(isRecoverableCloseCode(1000)).toBe(false)
    expect(isRecoverableCloseCode(undefined)).toBe(false)
  })

  test('epoch_stale branch: Ot default false; needs cause+flag', () => {
    expect(isEpochStaleRecoverableClose(4090, 'epoch_stale', false)).toBe(false)
    expect(isEpochStaleRecoverableClose(4090, 'epoch_stale', true)).toBe(true)
    expect(isEpochStaleRecoverableClose(4090, undefined, true)).toBe(false)
    expect(isEpochStaleRecoverableClose(4090, 'other', true)).toBe(false)
    expect(isEpochStaleRecoverableClose(401, 'epoch_stale', true)).toBe(false)
  })

  test('remintBackoffMs caps at Sjp and floors Ejp', () => {
    // deterministic max random → full exp
    expect(remintBackoffMs(1, () => 1)).toBe(30_000)
    expect(remintBackoffMs(2, () => 1)).toBe(60_000)
    expect(remintBackoffMs(10, () => 1)).toBe(300_000)
    // random 0 → floor 5s
    expect(remintBackoffMs(1, () => 0)).toBe(5_000)
  })

  test('status / exhausted message gold', () => {
    expect(formatRemintRetryStatus(3, 0)).toBe(
      'Remote Control server unreachable — retrying (attempt 3)',
    )
    expect(formatRemintRetryStatus(3, 120_000)).toBe(
      'Remote Control server unreachable — retrying (attempt 3, 2m elapsed)',
    )
    const msg = formatRemintExhaustedMessage(4093, 14, 1_800_000)
    expect(msg).toContain('Re-mint loop exhausted (code 4093)')
    expect(msg).toContain('14 unreachable attempts')
    expect(msg).toContain('about 30 minutes')
  })

  test('densable ms leak ceiling formula with default cfg', () => {
    // densable defaults: init_retry 3 / 4000, http 10000, oauth 3 / 2000
    // So = 3*10000 + 2*4000 = 38000
    // Qn = 2000*(8-1) + 3*38000 = 14000 + 114000 = 128000
    // ms = 2*(15000+38000+128000) = 2*181000 = 362000
    const ms = computeRecoveryLeakCeilingMs({
      init_retry_max_attempts: 3,
      init_retry_max_delay_ms: 4000,
      http_timeout_ms: 10_000,
      oauth_retry_max_attempts: 3,
      oauth_retry_base_delay_ms: 2000,
    })
    expect(ms).toBe(362_000)
  })

  test('Ls dispose: stale ignore; recovery defer within ceiling; leak past ceiling', () => {
    // Stale transport (replaced by rebuild) — never fail the session
    expect(
      disposeTransportClose({
        staleTransport: true,
        authRecoveryInFlight: false,
        code: 1006,
      }),
    ).toBe('ignore')
    expect(
      disposeTransportClose({
        staleTransport: true,
        authRecoveryInFlight: true,
        code: 4093,
        recoveryStartedAtMs: Date.now(),
        leakCeilingMs: 362_000,
      }),
    ).toBe('ignore')

    const t0 = 1_000_000
    // Within ceiling → defer
    expect(
      disposeTransportClose({
        authRecoveryInFlight: true,
        code: 1006,
        recoveryStartedAtMs: t0,
        leakCeilingMs: 362_000,
        nowMs: t0 + 60_000,
      }),
    ).toBe('defer')
    expect(
      disposeTransportClose({
        authRecoveryInFlight: true,
        code: 4093,
        recoveryStartedAtMs: t0,
        leakCeilingMs: 362_000,
        nowMs: t0 + 362_000, // tu<=ms still defer
      }),
    ).toBe('defer')

    // Past ceiling → leak
    expect(
      disposeTransportClose({
        authRecoveryInFlight: true,
        code: 4093,
        recoveryStartedAtMs: t0,
        leakCeilingMs: 362_000,
        nowMs: t0 + 362_001,
      }),
    ).toBe('leak')

    // Idle: recoverable → recover; non-recoverable → fail
    expect(
      disposeTransportClose({
        authRecoveryInFlight: false,
        code: 4093,
      }),
    ).toBe('recover')
    expect(
      disposeTransportClose({
        authRecoveryInFlight: false,
        code: 1006,
      }),
    ).toBe('fail')
    expect(
      disposeTransportClose({
        tornDown: true,
        authRecoveryInFlight: false,
        code: 4093,
      }),
    ).toBe('ignore')
  })

  test('heartbeat budget: 3/hour then hourly_exhausted; daily at 72', () => {
    const budget = createHeartbeatRecoveryBudget()
    const t0 = 1_000_000
    expect(budget.charge(t0, true)).toBe('charged')
    expect(budget.charge(t0 + 1000, true)).toBe('charged')
    expect(budget.charge(t0 + 2000, true)).toBe('charged')
    expect(budget.charge(t0 + 3000, true)).toBe('hourly_exhausted')
  })

  test('general consecutive recovery cap si=3', () => {
    const hb = createHeartbeatRecoveryBudget()
    let counters = {
      consecutiveRecoveries: 0,
      cred4094WithoutBeat: 0,
      epochStaleTimestamps: [] as number[],
    }
    for (let i = 0; i < 3; i++) {
      const r = evaluateRecoverableCloseBudgets({
        code: 401,
        counters,
        heartbeatBudget: hb,
        nowMs: 1_000_000 + i,
      })
      expect(r.ok).toBe(true)
      if (r.ok) counters = r.counters
    }
    const exhausted = evaluateRecoverableCloseBudgets({
      code: 401,
      counters,
      heartbeatBudget: hb,
      nowMs: 1_000_010,
    })
    expect(exhausted.ok).toBe(false)
    if (!exhausted.ok) {
      expect(exhausted.event).toBe('recovery_exhausted')
      expect(exhausted.message).toContain('Transport recovery exhausted')
    }
    counters = noteRecoverySuccess(counters)
    expect(counters.consecutiveRecoveries).toBe(0)
  })

  test('4094 Ws budget exhausts after 3 without healthy beat', () => {
    const hb = createHeartbeatRecoveryBudget()
    let counters = {
      consecutiveRecoveries: 0,
      cred4094WithoutBeat: 0,
      epochStaleTimestamps: [] as number[],
    }
    for (let i = 0; i < 3; i++) {
      // reset consecutive so general cap does not fire first
      counters = { ...counters, consecutiveRecoveries: 0 }
      const r = evaluateRecoverableCloseBudgets({
        code: 4094,
        counters,
        heartbeatBudget: hb,
        nowMs: 1_000_000 + i,
      })
      expect(r.ok).toBe(true)
      if (r.ok) counters = r.counters
    }
    counters = { ...counters, consecutiveRecoveries: 0 }
    const exhausted = evaluateRecoverableCloseBudgets({
      code: 4094,
      counters,
      heartbeatBudget: hb,
      nowMs: 1_000_010,
    })
    expect(exhausted.ok).toBe(false)
    if (!exhausted.ok) {
      expect(exhausted.event).toBe('cred_recovery_exhausted')
    }
  })

  test('4093 budget: reentry skips charge; daily detail copy', () => {
    const hb = createHeartbeatRecoveryBudget()
    let counters = {
      consecutiveRecoveries: 0,
      cred4094WithoutBeat: 0,
      epochStaleTimestamps: [] as number[],
    }
    // charge 3 → next hourly exhaust without reentry
    for (let i = 0; i < 3; i++) {
      counters = { ...counters, consecutiveRecoveries: 0 }
      const r = evaluateRecoverableCloseBudgets({
        code: 4093,
        counters,
        heartbeatBudget: hb,
        nowMs: 2_000_000 + i,
      })
      expect(r.ok).toBe(true)
      if (r.ok) counters = r.counters
    }
    counters = { ...counters, consecutiveRecoveries: 0 }
    const hourly = evaluateRecoverableCloseBudgets({
      code: 4093,
      counters,
      heartbeatBudget: hb,
      nowMs: 2_000_010,
    })
    expect(hourly.ok).toBe(false)
    if (!hourly.ok) {
      expect(hourly.event).toBe('heartbeat_budget_exhausted')
      expect(hourly.eventMeta?.window_h).toBe(1)
    }
    // reentry skips 4093 charge
    counters = { ...counters, consecutiveRecoveries: 0 }
    const re = evaluateRecoverableCloseBudgets({
      code: 4093,
      reentry: true,
      counters,
      heartbeatBudget: hb,
      nowMs: 2_000_020,
    })
    expect(re.ok).toBe(true)
    expect(formatRemintDailyDropExhaustedDetail()).toContain(
      'more than 72 times in 24 hours',
    )
  })

  test('4090 epoch_stale budget + jitter delay', () => {
    let counters = {
      consecutiveRecoveries: 0,
      cred4094WithoutBeat: 0,
      epochStaleTimestamps: [] as number[],
    }
    const t0 = 5_000_000
    for (let i = 0; i < 3; i++) {
      counters = { ...counters, consecutiveRecoveries: 0 }
      const r = evaluateEpochStaleRecoveryBudget({
        counters,
        nowMs: t0 + i * 1000,
        random: () => 0.5,
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.delayMs).toBe(2500)
        counters = r.counters
      }
    }
    counters = { ...counters, consecutiveRecoveries: 0 }
    const exhausted = evaluateEpochStaleRecoveryBudget({
      counters,
      nowMs: t0 + 10_000,
    })
    expect(exhausted.ok).toBe(false)
    if (!exhausted.ok) {
      expect(exhausted.event).toBe('epoch_stale_budget_exhausted')
      expect(exhausted.message).toContain('kept going stale')
    }
  })

  test('ul() noteHealthyAuthBeat clears 4094 Ws', () => {
    const hb = createHeartbeatRecoveryBudget()
    let counters = {
      consecutiveRecoveries: 2,
      cred4094WithoutBeat: 2,
      epochStaleTimestamps: [] as number[],
    }
    counters = noteHealthyAuthBeat(counters, hb, 1_000_000)
    expect(counters.cred4094WithoutBeat).toBe(0)
    // densable ul does not clear _o — only th onConnect does
    expect(counters.consecutiveRecoveries).toBe(2)
    counters = noteRecoverySuccess(counters)
    expect(counters.consecutiveRecoveries).toBe(0)
  })

  test('densable Xn/To/Vo recovery flight ownership', () => {
    const flight = createRecoveryFlight()
    expect(flight.state.inFlight).toBe(false)
    const g1 = flight.begin()
    expect(flight.state.inFlight).toBe(true)
    expect(g1).toBe(1)
    // stale endIfOwner does not clear
    expect(flight.endIfOwner(999)).toBe(false)
    expect(flight.state.inFlight).toBe(true)
    // second begin supersedes
    const g2 = flight.begin()
    expect(g2).toBe(2)
    expect(flight.endIfOwner(g1)).toBe(false)
    expect(flight.state.inFlight).toBe(true)
    expect(flight.endIfOwner(g2)).toBe(true)
    expect(flight.state.inFlight).toBe(false)
    expect(flight.state.activeGen).toBe(0)
    // Vo force-clear
    flight.begin()
    flight.forceClear()
    expect(flight.state.inFlight).toBe(false)
  })

  test('oauth adopt backoff + status gold', () => {
    // base 2000, attempt 1, no jitter → 2000
    expect(oauthAdoptBackoffMs(1, 2000, 0, () => 0.5)).toBe(2000)
    // attempt 2 → 4000
    expect(oauthAdoptBackoffMs(2, 2000, 0, () => 0.5)).toBe(4000)
    // jitter fraction 0.25, random 1 → +25%; random 0 → -25%
    expect(oauthAdoptBackoffMs(1, 2000, 0.25, () => 1)).toBe(2500)
    expect(oauthAdoptBackoffMs(1, 2000, 0.25, () => 0)).toBe(1500)
    expect(formatOAuthAdoptRetryStatus(2, 3)).toBe(
      'OAuth refresh failed — waiting for a fresh login (2/3)',
    )
    expect(OAUTH_REAUTH_REQUIRED_DETAIL).toContain('run /login')
  })
})

/**
 * densable 232 #39 residual close — Ls + Xn/To/Vo flight as bridge would wire:
 * transport onClose → disposeTransportClose → defer/leak/recover; flight owns gen.
 * (Not a full remoteBridgeCore e2e — pure orchestrator integration.)
 */
describe('remint Ls+flight bridge orchestration densable 232 #39', () => {
  const leakCeilingMs = 362_000
  const t0 = 10_000_000

  test('recover → begin flight → mid-recovery closes defer until To', () => {
    const flight = createRecoveryFlight()
    // Idle recoverable close → enter recovery
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 4093,
      }),
    ).toBe('recover')

    const gen = flight.begin()
    expect(flight.state.inFlight).toBe(true)
    expect(flight.state.startedAtMs).toBeGreaterThan(0)

    // Same generation transport dies again while recovering → defer (not fail)
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 1006,
        recoveryStartedAtMs: t0,
        leakCeilingMs,
        nowMs: t0 + 30_000,
      }),
    ).toBe('defer')

    // Stale endIfOwner cannot clear — still defer
    expect(flight.endIfOwner(gen + 99)).toBe(false)
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 4093,
        recoveryStartedAtMs: t0,
        leakCeilingMs,
        nowMs: t0 + 60_000,
      }),
    ).toBe('defer')

    // Owner completes recovery → idle recoverable again
    expect(flight.endIfOwner(gen)).toBe(true)
    expect(flight.state.inFlight).toBe(false)
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 4093,
      }),
    ).toBe('recover')
  })

  test('stale transport close ignored even when flight in progress', () => {
    const flight = createRecoveryFlight()
    flight.begin()
    // Previous transport generation fires onClose after rebuild
    expect(
      disposeTransportClose({
        staleTransport: true,
        authRecoveryInFlight: flight.state.inFlight,
        code: 4093,
        recoveryStartedAtMs: t0,
        leakCeilingMs,
        nowMs: t0 + 1_000,
      }),
    ).toBe('ignore')
    // Flight still owned — not force-cleared by stale close
    expect(flight.state.inFlight).toBe(true)
  })

  test('leak past ceiling Vo forceClear then re-dispatch recover', () => {
    const flight = createRecoveryFlight()
    const gen = flight.begin()
    // Past densable ms leak ceiling → leak
    expect(
      disposeTransportClose({
        authRecoveryInFlight: true,
        code: 4093,
        recoveryStartedAtMs: t0,
        leakCeilingMs,
        nowMs: t0 + leakCeilingMs + 1,
      }),
    ).toBe('leak')

    // densable Vo — force clear stuck flag
    flight.forceClear()
    expect(flight.state.inFlight).toBe(false)
    expect(flight.endIfOwner(gen)).toBe(false)

    // After leak clear, next close can recover again
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 4093,
      }),
    ).toBe('recover')
  })

  test('rebuild supersedes gen: old To fails; new owner To succeeds', () => {
    const flight = createRecoveryFlight()
    const genOld = flight.begin()
    // Rebuild starts a new recovery generation (densable Xn again)
    const genNew = flight.begin()
    expect(genNew).toBeGreaterThan(genOld)

    // Old recovery completing must not clear new flight
    expect(flight.endIfOwner(genOld)).toBe(false)
    expect(flight.state.inFlight).toBe(true)
    expect(flight.state.activeGen).toBe(genNew)

    // Mid-recovery close still defers under new owner
    expect(
      disposeTransportClose({
        authRecoveryInFlight: flight.state.inFlight,
        code: 1006,
        recoveryStartedAtMs: flight.state.startedAtMs,
        leakCeilingMs,
        nowMs: flight.state.startedAtMs + 10_000,
      }),
    ).toBe('defer')

    expect(flight.endIfOwner(genNew)).toBe(true)
    expect(flight.state.activeGen).toBe(0)
  })

  test('4093 remint loop: budget charge then retry status gold', () => {
    const hb = createHeartbeatRecoveryBudget()
    let counters = {
      consecutiveRecoveries: 0,
      cred4094WithoutBeat: 0,
      epochStaleTimestamps: [] as number[],
    }
    const flight = createRecoveryFlight()
    // First recoverable 4093 → recover + begin
    expect(
      disposeTransportClose({
        authRecoveryInFlight: false,
        code: 4093,
      }),
    ).toBe('recover')
    const gen = flight.begin()
    const gate = evaluateRecoverableCloseBudgets({
      code: 4093,
      counters,
      heartbeatBudget: hb,
      recoveryPatienceEnabled: true,
      nowMs: t0,
    })
    expect(gate.ok).toBe(true)
    if (gate.ok) counters = gate.counters

    // Unreachable retry UI
    expect(formatRemintRetryStatus(1, 0)).toContain('retrying (attempt 1)')
    expect(formatRemintRetryStatus(3, 120_000)).toContain('2m elapsed')

    // Success clears consecutive via noteRecoverySuccess + To
    counters = noteRecoverySuccess(counters)
    expect(flight.endIfOwner(gen)).toBe(true)
    expect(counters.consecutiveRecoveries).toBe(0)
  })
})
