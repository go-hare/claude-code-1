import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js'
import { isDisklessLaunch } from '../../utils/sessionHost.js'

export const PROJECT_COMMAND_FLAG = 'tengu_gentle_cupcake'

/**
 * Official 2.1.331 `OGi()` — attribution Project requires claude.ai subscriber,
 * direct Anthropic connection, non-remote, non-diskless, and
 * `CLAUDE_CODE_ATTRIBUTION_HEADER` not set to falsy (`0`).
 */
export function isAttributionProjectEligible(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isDisklessLaunch()) return false
  if (!isClaudeAISubscriber()) return false
  if (!isFirstPartyAnthropicBaseUrl()) return false
  if (isEnvTruthy(env.CLAUDE_CODE_REMOTE)) return false
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_ATTRIBUTION_HEADER)) return false
  return true
}

export function isProjectCommandEnabled(): boolean {
  return (
    isAttributionProjectEligible() &&
    Boolean(getFeatureValue_CACHED_MAY_BE_STALE(PROJECT_COMMAND_FLAG, false))
  )
}

/**
 * Official 2.1.331 `M1s` / `pio` — `/project` slash command.
 */
const project = {
  type: 'local',
  name: 'project',
  description: "Set the claude.ai Project for this session's usage reports",
  argumentHint: '[Project ID or claude.ai address] [--save] | clear [--save]',
  isEnabled: () => isProjectCommandEnabled(),
  supportsNonInteractive: true,
  load: () => import('./project.js'),
} satisfies Command

export default project
