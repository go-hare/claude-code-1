/**
 * densable 2.1.233 — Todo/Task tool availability gate (uX / Eee / N_v / O_v / lCr).
 *
 * Gold (SEA):
 *   O_v = [["opus",[4,8]],["sonnet",[5]],["fable",[5]],["mythos",[5]]]
 *   lCr(model, floors): true if model is at/above family floor
 *   N_v(model) = !lCr(model, O_v)  // true when still allowed by default
 *   uX():
 *     ant/special → true
 *     model undefined or N_v(model) → true
 *     CLAUDE_CODE_ENABLE_TODO_TOOLS === true → true
 *     else GrowthBook tengu_rosy_wren (default false)
 *   Eee() = h5() && uX()  (h5 ≈ isTodoV2Enabled)
 *
 * Product: TodoWrite + TaskCreate/Get/Update/List unavailable on
 * Opus 4.8+, Sonnet 5+, Fable 5+, Mythos 5+ unless env/GB force-on.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'
import { firstPartyNameToCanonical, getMainLoopModel } from './model/model.js'

/** densable O_v — family → version floor parts where tools are off by default */
const TODO_TOOLS_DISABLED_FAMILIES: ReadonlyArray<[string, readonly number[]]> =
  [
    ['opus', [4, 8]],
    ['sonnet', [5]],
    ['fable', [5]],
    ['mythos', [5]],
  ]

/**
 * densable lCr — true when model is at or above a floor in O_v
 * (tools should be disabled by default for this model).
 *
 * Gold:
 *   /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(e)
 *   compare version segments; equal counts as blocked (return true).
 */
export function modelMeetsTodoToolsDisabledFloor(model: string): boolean {
  const canonical = firstPartyNameToCanonical(model)
  const candidates = [canonical, model.toLowerCase()]
  for (const id of candidates) {
    const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id)
    if (!m) continue
    const family = m[1]!
    const parts = m[2]!.split('-').map(Number)
    const floor = TODO_TOOLS_DISABLED_FAMILIES.find(([f]) => f === family)?.[1]
    if (!floor) continue
    const len = Math.max(parts.length, floor.length)
    for (let i = 0; i < len; i++) {
      const delta = (parts[i] ?? 0) - (floor[i] ?? 0)
      if (delta !== 0) return delta > 0
    }
    return true
  }
  return false
}

/**
 * densable N_v — true when Todo/Task tools remain available by default
 * (model is NOT in the disabled floor set).
 */
export function modelAllowsTodoToolsByDefault(model: string): boolean {
  return !modelMeetsTodoToolsDisabledFloor(model)
}

/**
 * densable QR() — bg session or bg takeover forces Todo tools on.
 * Gold: Gs() (SESSION_KIND==="bg") || MB()!=null (bgTakeover).
 */
function isTodoToolsBgForceOn(): boolean {
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') {
    return true
  }
  // densable MB() — bg takeover module state; env residual used by engines
  if (isEnvTruthy(process.env.CLAUDE_CODE_BG_TAKEOVER)) {
    return true
  }
  return false
}

/**
 * densable Ads() — host launchOptions.todoToolsOptIn().
 * Local: bootstrap STATE (set by --tools/--allowedTools via setTodoToolsOptIn)
 * plus env CLAUDE_CODE_TODO_TOOLS_OPT_IN residual.
 */
function isTodoToolsHostOptIn(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_TODO_TOOLS_OPT_IN)) {
    return true
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTodoToolsOptIn } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    return getTodoToolsOptIn()
  } catch {
    return false
  }
}

/**
 * densable uX — should TodoWrite / Task* tools be offered for this model?
 *
 * Gold order:
 *   QR()||Ads() → true
 *   model undefined || N_v(model) → true
 *   CLAUDE_CODE_ENABLE_TODO_TOOLS === true → true
 *   else GB tengu_rosy_wren (default false)
 */
export function isTodoToolsEnabledForModel(
  model: string | undefined = getMainLoopModel(),
): boolean {
  // densable QR()||Ads() — bg / host opt-in always on
  if (isTodoToolsBgForceOn() || isTodoToolsHostOptIn()) {
    return true
  }
  // ant residual (not densable QR/Ads; keeps internal surfaces unblocked)
  if (process.env.USER_TYPE === 'ant') {
    return true
  }
  // densable: model undefined or not in blocked set → on
  if (model === undefined || model === null || model === '') {
    return true
  }
  if (modelAllowsTodoToolsByDefault(model)) {
    return true
  }
  // densable: env force-on (schema treats as boolean; accept truthy env)
  if (isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS)) {
    return true
  }
  // densable: GrowthBook tengu_rosy_wren default false
  // Boolean() avoids TS2367 when the cache helper is typed as returning the default literal
  return Boolean(
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_rosy_wren', false as boolean),
  )
}

/**
 * densable Eee — Task* tools: TodoV2 surface AND model gate.
 */
export function isTodoV2ToolsEnabledForModel(
  model: string | undefined = getMainLoopModel(),
): boolean {
  // Lazy require avoids circular import with tasks.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isTodoV2Enabled } =
    require('./tasks.js') as typeof import('./tasks.js')
  return isTodoV2Enabled() && isTodoToolsEnabledForModel(model)
}

/**
 * densable TodoWrite isEnabled: !h5() && uX()
 * (legacy TodoWrite only when V2 off and model gate allows).
 */
export function isTodoWriteToolEnabledForModel(
  model: string | undefined = getMainLoopModel(),
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isTodoV2Enabled } =
    require('./tasks.js') as typeof import('./tasks.js')
  return !isTodoV2Enabled() && isTodoToolsEnabledForModel(model)
}
