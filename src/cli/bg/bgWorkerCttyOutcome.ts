/**
 * densable rNt / _ / g / J — uo switch callees after z()/L().
 * Gold: gold-251-k.md #33. J is the diagnostics stand-in (uo-chunk `{J}`).
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { getBootstrapSessionHost } from '../../utils/sessionHost.js'
import type { BgWorkerCttyOutcome } from '../../utils/bgWorkerCtty.js'

class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

/** densable nNt bag — keyed by G().host, not a SessionHost field. */
class ControllingTerminalBag {
  #e = false
  markOwnsControllingTerminal(): void {
    this.#e = true
  }
  ownsControllingTerminal(): boolean {
    return this.#e
  }
  resetForTests(): void {
    this.#e = false
  }
}

const nNt = new WeakOwnerCache(() => new ControllingTerminalBag())

/** densable zy @184310921 sha=`1146b7fa05f38df7` */
function zy(): ControllingTerminalBag {
  return nNt.of(getBootstrapSessionHost())
}

/** densable rNt @184311051 sha=`cbfa59a5189ab8a3` */
export function rNt(): void {
  zy().markOwnsControllingTerminal()
}

export function doesOwnControllingTerminal(): boolean {
  return zy().ownsControllingTerminal()
}

export function resetOwnsControllingTerminalForTests(): void {
  zy().resetForTests()
}

/** densable _ @179407606 sha=`7717e57593f5686c` */
export function _(
  e: string,
  u?: Record<string, boolean | number | undefined>,
): void {
  logEvent('tengu_feature_ok', {
    feature_name:
      e as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...u,
  })
}

/** densable g @179407748 sha=`2900953a4749f8f4` */
export function g(
  e: string,
  u: string,
  r?: Record<string, boolean | number | undefined>,
): void {
  logEvent('tengu_feature_sad', {
    ...r,
    feature_name:
      e as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code: u as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable J @179949342 sha=`e051f77b3a45b82e` — diagnostics stand-in. */
export function J(
  n: 'debug' | 'info' | 'warn' | 'error',
  t: string,
  i?: Record<string, unknown> | (() => Record<string, unknown>),
): void {
  logForDiagnosticsNoPII(n, t, i)
}

/**
 * densable uo switch after z()/L(): J(info) then rNt/_/g by outcome.
 */
export function applyBgWorkerCttyOutcome(t: BgWorkerCttyOutcome): void {
  // biome-ignore lint/complexity/noCommaOperator: gold uo switch is J(...) then t
  switch ((J('info', 'bg_worker_ctty', { outcome: t }), t)) {
    case 'acquired':
      rNt()
      _('bg_worker_ctty')
      break
    case 'already':
      rNt()
      break
    case 'failed':
      g('bg_worker_ctty', t)
      break
    case 'ffi_unavailable':
    case 'not_a_tty':
      g('bg_worker_ctty', t)
      break
    case 'unsupported':
    case 'switched_off':
      break
  }
}
