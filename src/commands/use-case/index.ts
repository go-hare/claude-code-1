import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isCommandEnabled } from '../../types/command.js'
import { getProgramUseCaseChoices } from './useCaseStore.js'

export const USE_CASE_COMMAND_FLAG = 'tengu_federated_possum'

/**
 * Official 2.1.331 `QB()` — `tengu_federated_possum` gate.
 */
export function isProgramUseCaseEnabled(): boolean {
  return Boolean(
    getFeatureValue_CACHED_MAY_BE_STALE(USE_CASE_COMMAND_FLAG, false),
  )
}

/**
 * Official 2.1.331 `Cuo` — `/use-case` Life Sciences use case selector.
 */
const useCase = {
  type: 'local-jsx',
  name: 'use-case',
  description:
    'Choose the Life Sciences use case that applies to your requests',
  argumentHint: '[use case]',
  availability: ['claude-ai'],
  immediate: true,
  requires: { workspace: true, ink: true },
  isEnabled: () => isProgramUseCaseEnabled() && !getIsRemoteMode(),
  get isHidden(): boolean {
    return !isCommandEnabled(this) || getProgramUseCaseChoices().length === 0
  },
  load: () => import('./use-case.js'),
} satisfies Command

export default useCase
