import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isDisklessLaunch } from '../../utils/sessionHost.js'

export const IMPORT_COMMAND_FLAG = 'tengu_import'

export const IMPORT_DETERMINISTIC_GUARD =
  'Do NOT read the foreign-agent config files or write Claude Code config yourself — the deterministic import (triggered by `--yes`) applies the same safe-name and path-traversal guards as the terminal picker.'

/**
 * Official 2.1.331 `zit()` — `w("tengu_import", false)`.
 */
export function isImportCommandEnabled(): boolean {
  return Boolean(
    getFeatureValue_CACHED_MAY_BE_STALE(IMPORT_COMMAND_FLAG, false),
  )
}

/**
 * Official 2.1.331 `J1s` / `Mio` — interactive `/import` picker.
 */
const importCommand = {
  type: 'local-jsx',
  name: 'import',
  description: 'Import config from another AI coding agent',
  immediate: true,
  argumentHint: '[codex|gemini|cursor] [--dry-run]',
  isEnabled: () => isImportCommandEnabled(),
  get isHidden(): boolean {
    return !isImportCommandEnabled()
  },
  load: () => import('./import.js'),
} satisfies Command

/**
 * Official 2.1.331 `Oio` — headless / non-interactive `/import` twin.
 */
export const importNonInteractive = {
  type: 'local',
  name: 'import',
  supportsNonInteractive: true,
  description: 'Import config from another AI coding agent',
  isEnabled: () =>
    isImportCommandEnabled() &&
    getIsNonInteractiveSession() &&
    !isDisklessLaunch(),
  get isHidden(): boolean {
    return (
      !isImportCommandEnabled() ||
      !getIsNonInteractiveSession() ||
      isDisklessLaunch()
    )
  },
  load: () => import('./import-noninteractive.js'),
} satisfies Command

export default importCommand
