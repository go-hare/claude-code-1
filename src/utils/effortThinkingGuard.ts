/**
 * densable 2.1.251 #13 — request-builder clamp when thinking is disabled.
 *
 * Gold `GMt`: `ga.effort=Wht` when thinking is `{type:"disabled"}` and
 * `(Vm || SJn)` and `bJn(ga.effort)`. `Wht="high"`. `bJn` is rank above high.
 * `SJn` is canonical `claude-opus-5` or catalog `thinking_disabled_effort_cap`.
 * `d6e` only parses the API 400; gold does not throw a client error.
 *
 * 243 `formatEffortThinkingOffError` copy is kept for tests / CLI messaging.
 * The request builder no longer throws it.
 */

import { firstPartyNameToCanonical } from './model/model.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { getSettingsWithErrors } from './settings/settings.js'

/** densable `Wht` */
export const EFFORT_CLAMPED_WHEN_THINKING_DISABLED = 'high' as const

/** densable `bJn` — effort rank above `high`. */
export function isTopEffortWithThinkingOff(
  effort: string | undefined,
  thinkingOff: boolean,
): effort is 'xhigh' | 'max' {
  return thinkingOff && (effort === 'xhigh' || effort === 'max')
}

/**
 * densable `SJn` — `Xe(e)==="claude-opus-5"` or catalog
 * `thinking_disabled_effort_cap`. The baked EHl catalog has no such flag;
 * the probe is the gold `_h` call, not an invented catalog row.
 */
export function modelClampsEffortWhenThinkingDisabled(model: string): boolean {
  const stripped = model.replace(/\[1m\]/gi, '').trim()
  const canonical = firstPartyNameToCanonical(stripped)
  return (
    canonical === 'claude-opus-5' ||
    modelHasCatalogCapability(stripped, 'thinking_disabled_effort_cap') === true
  )
}

export type EffortThinkingOffDecision =
  | { action: 'pass' }
  | { action: 'clamp'; from: 'xhigh' | 'max'; to: 'high' }

/**
 * densable `GMt` clamp: thinking disabled and effort above high, and either
 * mechanical (`Vm`) or `SJn`. Other models pass the wire effort through.
 */
export function decideEffortWhenThinkingDisabled(input: {
  effort: string | undefined
  thinkingOff: boolean
  model: string
  /** densable `Vm` — `r.type==="disabled" && r.mechanical===true`. */
  mechanical?: boolean
}): EffortThinkingOffDecision {
  if (
    !isTopEffortWithThinkingOff(input.effort, input.thinkingOff) ||
    input.effort === undefined
  ) {
    return { action: 'pass' }
  }
  if (input.mechanical || modelClampsEffortWhenThinkingDisabled(input.model)) {
    return {
      action: 'clamp',
      from: input.effort,
      to: EFFORT_CLAMPED_WHEN_THINKING_DISABLED,
    }
  }
  return { action: 'pass' }
}

/**
 * densable `d6e` — parse API 400
 * `effort '…' is not supported when thinking is disabled`.
 * Gold only reads the level; it does not throw.
 */
export function parseEffortUnsupportedWhenThinkingDisabled(
  error: unknown,
): string | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  const message = (error as { message?: unknown }).message
  if (status !== 400 || typeof message !== 'string') return null
  return (
    /effort '([a-z]+)' is not supported when thinking is disabled/i.exec(
      message,
    )?.[1] ?? null
  )
}

function describeThinkingOffCause(): string {
  const raw = process.env.MAX_THINKING_TOKENS
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) {
      return 'unset MAX_THINKING_TOKENS=0'
    }
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return 'remove "alwaysThinkingEnabled": false from settings'
  }

  return 'start the session without thinking disabled'
}

/** Interactive / REPL. */
export function formatEffortThinkingOffError(level: 'xhigh' | 'max'): string {
  return (
    `Effort '${level}' isn't available with thinking turned off on this model. ` +
    `run /effort high to continue, or turn thinking back on (${describeThinkingOffCause()})`
  )
}

/** CLI `--effort` / settings bootstrap. */
export function formatEffortThinkingOffCliError(
  level: 'xhigh' | 'max',
): string {
  return (
    `Effort '${level}' isn't available with thinking turned off on this model. ` +
    `use --effort high (or the effortLevel setting), or turn thinking back on (${describeThinkingOffCause()})`
  )
}
