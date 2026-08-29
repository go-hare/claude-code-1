/**
 * densable _Gw (local-jsx) + xPl (local) — dual /auto-mode-setup.
 * Gold: gold-auto-mode-setup-callgraph.md · gold-wide-xPl.txt
 */
import type { Command } from '../../commands.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  isAutoModeSetupLocalEnabled,
  isAutoModeSetupLocalJsxEnabled,
  isAutoModeSetupSkillAllowed,
} from '../../services/autoModeSetup/gates.js'

const DESCRIPTION =
  'Teach auto mode about your environment, plus optional rule tweaks'

/** densable _Gw — interactive ink wizard. Listing uses fqi (isHidden). */
export const autoModeSetup: Command = {
  type: 'local-jsx',
  name: 'auto-mode-setup',
  description: DESCRIPTION,
  isEnabled: () => isAutoModeSetupLocalJsxEnabled(),
  get isHidden() {
    return !isAutoModeSetupSkillAllowed()
  },
  load: () => import('./autoModeSetup.js'),
}

/**
 * densable xPl — non-interactive --propose / --apply-file.
 * Gold: get isHidden(){return!jn()} — hidden in interactive regardless of KHl.
 */
export const autoModeSetupNonInteractive: Command = {
  type: 'local',
  name: 'auto-mode-setup',
  description: DESCRIPTION,
  supportsNonInteractive: true,
  argumentHint:
    '[--request-id <uuid>] (--wizard posture=… scope=… depth=… --propose | --expect-sha256 <64-hex> --apply-file <path>)',
  isEnabled: () => isAutoModeSetupLocalEnabled(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./headless.js'),
}
