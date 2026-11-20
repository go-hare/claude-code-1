import { getStickyBetas } from '../bootstrap/state.js'
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import { logForDebugging } from './debug.js'

/**
 * Official 2.1.328 `Was` / `dyt` / `RGi` / `xGi` / `qys`:
 * Per-model session latch for backends that rejected `CONTEXT_1M_BETA_HEADER`
 * (HTTP 400) and answered once it was removed. Keyed on `getStickyBetas()`,
 * which is reminted on `/clear`, `/compact`, `clearBetaHeaderLatches()`,
 * `resetStickyBetas()`, and `resetStateForTests()`.
 *
 * Kept in a cycle-free leaf so both `services/api/claude.ts` and
 * `utils/context.ts` can read/update refusal state without circular imports.
 */
const context1mBetaRefusedByStickyBetas = new WeakMap<object, Set<string>>()

function normalizeContext1mLatchModelKey(model: string): string {
  return model
    .replace(/\[1m\]/gi, '')
    .trim()
    .toLowerCase()
}

export function isContext1mBetaRefusedForModel(
  model: string,
  stickyBetas: object = getStickyBetas(),
): boolean {
  const set = context1mBetaRefusedByStickyBetas.get(stickyBetas)
  return set?.has(normalizeContext1mLatchModelKey(model)) ?? false
}

export function markContext1mBetaRefusedForModel(
  model: string,
  stickyBetas: object = getStickyBetas(),
): void {
  const key = normalizeContext1mLatchModelKey(model)
  let set = context1mBetaRefusedByStickyBetas.get(stickyBetas)
  if (!set) {
    set = new Set<string>()
    context1mBetaRefusedByStickyBetas.set(stickyBetas, set)
  }
  if (set.has(key)) return
  set.add(key)
  logForDebugging(
    `[betas] the backend rejected the ${CONTEXT_1M_BETA_HEADER} beta for ${model} (HTTP 400) and answered once it was removed. It is left out for this model until /clear, a compaction, a resume or a provider change.`,
    { level: 'warn' },
  )
}

export function clearContext1mBetaRefusedModels(
  stickyBetas: object = getStickyBetas(),
): void {
  context1mBetaRefusedByStickyBetas.delete(stickyBetas)
}
