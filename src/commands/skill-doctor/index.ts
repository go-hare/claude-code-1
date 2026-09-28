import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

/**
 * densable 2.1.283 `JP` — `/skill-doctor` is gated by GrowthBook
 * `tengu_lantern_prism` (default false) or env `CLAUDE_CODE_LANTERN_PRISM`.
 * Raw env is truthy when set to any non-empty string (gold `a.CLAUDE_CODE_LANTERN_PRISM`).
 */
export function isSkillDoctorEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_lantern_prism', false) ||
    Boolean(process.env.CLAUDE_CODE_LANTERN_PRISM)
  )
}

/**
 * densable `q0e` — interactive twin of the text report. Gold has no `load` on
 * the jsx object (`thinClientDispatch:"twin"`); the host runs the local
 * report and posts it as a system message. Do not open /plugin stats UI.
 */
const skillDoctor = {
  type: 'local-jsx',
  name: 'skill-doctor',
  description: 'Show which loaded skills are unused and costing context',
  immediate: true,
  load: () => import('./skill-doctor-jsx.js'),
} satisfies Command

/** densable `Nae` — headless / non-interactive text report. `Ae()` = non-interactive. */
export const skillDoctorNonInteractive = {
  type: 'local',
  name: 'skill-doctor',
  description: 'Show which loaded skills are unused and costing context',
  supportsNonInteractive: true,
  isEnabled: () => getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./skill-doctor.js'),
} satisfies Command

export default skillDoctor
