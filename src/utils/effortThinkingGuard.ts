/**
 * densable 2.1.251 #13 — request-builder clamp when thinking is disabled.
 *
 * Gold `GMt`: `ga.effort=Wht` when outgoing thinking is `{type:"disabled"}`
 * and `(Vm || SJn)` and `bJn(ga.effort)`. `Wht="high"`. `bJn` is rank above
 * high. `SJn` is canonical `claude-opus-5` or catalog
 * `thinking_disabled_effort_cap`. `d6e` only parses the API 400; gold does
 * not throw a client error.
 *
 * 243 `formatEffortThinkingOffError` copy is kept for tests / CLI messaging.
 * The request builder no longer throws it.
 */

import { APIError } from '@anthropic-ai/sdk'
import { firstPartyNameToCanonical } from './model/model.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { onSessionSwitch } from '../bootstrap/state.js'
import { getSettingsWithErrors } from './settings/settings.js'
import {
  getSessionOnceLatches,
  resetOnceLatchesOnSessionSwitch,
} from './sessionRoot.js'

/** densable `i5n` — `au((e,t)=>{if(t==="cd"||t==="hydrate")return;Du().resetStreamNoEventsWarningLatch()})` */
onSessionSwitch(resetOnceLatchesOnSessionSwitch)

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
 * densable `GMt` clamp: outgoing thinking `{type:"disabled"}` and effort
 * above high, and either mechanical (`Vm`) or `SJn`. Other models pass the
 * wire effort through. `thinkingOff` is `Up?.type==="disabled"`, not
 * "user asked thinking off" (env DISABLE_THINKING omits the field and
 * does not clamp).
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
 * densable `Xl` — bucket a querySource for the clamp analytics gate.
 * `repl_main_thread*` / `sdk` → `main`; `agent:*` / `hook_agent` →
 * `subagent`; else `auxiliary`.
 */
export function querySourceBucket(
  source: string | undefined,
): 'main' | 'subagent' | 'auxiliary' | undefined {
  if (source === undefined) return undefined
  if (source.startsWith('repl_main_thread') || source === 'sdk') return 'main'
  if (source.startsWith('agent:') || source === 'hook_agent') return 'subagent'
  return 'auxiliary'
}

/**
 * densable `Ye` — skip transcript effort when thinking is mechanically off.
 * Gold: `typeof et==="string" && !(r.type==="disabled"&&r.mechanical===!0) ? lt : void 0`.
 */
export function transcriptEffortWhenMechanicalDisabled<T>(
  mechanical: boolean,
  wire: T | undefined,
): T | undefined {
  return mechanical ? undefined : wire
}

/**
 * densable `ip` then `RE` — collapse `agent:custom:…` before analytics.
 * Gold `Vo` is the bun analytics string wrapper; locally the branded
 * `logEvent` cast is the equivalent.
 */
export function analyticsQuerySource(source: string | undefined): string {
  if (source === undefined) return ''
  if (source.startsWith('agent:custom:')) return 'agent:custom'
  return source
}

/** densable `n(\`output_config.effort … thinking is ${Vm?"mechanically ":""}disabled\`)` */
export function formatEffortClampDebugMessage(
  from: string,
  to: string,
  mechanical: boolean,
): string {
  const mechanically = mechanical ? 'mechanically ' : ''
  return (
    `output_config.effort '${from}' clamped to '${to}': thinking is ` +
    `${mechanically}disabled for this request, and this model rejects higher effort when thinking is disabled`
  )
}

/** densable `Du().once` — `Ge.firedOnceKeys` on the session-root bag. */
export function oncePerSession(key: string): boolean {
  return getSessionOnceLatches().once(key)
}

export function resetEffortThinkingGuardOnceForTests(): void {
  getSessionOnceLatches().firedOnceKeys.clear()
}

/**
 * densable `d6e` — parse API 400
 * `effort '…' is not supported when thinking is disabled`.
 * Gold: `!(e instanceof Gt) || e.status!==400` → null. Does not throw.
 */
export function parseEffortUnsupportedWhenThinkingDisabled(
  error: unknown,
): string | null {
  if (!(error instanceof APIError) || error.status !== 400) return null
  const message = error.message
  if (typeof message !== 'string') return null
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
