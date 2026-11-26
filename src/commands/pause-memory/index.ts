import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/**
 * Official 2.1.331 `Gwo()` — remote/managed session where only local
 * auto-memory (not account memory) is toggled.
 */
export function isRemoteOnlyMemorySession(): boolean {
  return getIsRemoteMode() || isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
}

/**
 * Official 2.1.331 `V1s` / `GMt` — `/pause-memory` slash command.
 * Compile-time disabled in external 2.1.331 (`isEnabled: () => false`) while
 * keeping its real local toggle handler loadable and aligned 1:1.
 */
const pauseMemory = {
  type: 'local',
  name: 'pause-memory',
  aliases: ['memory-pause', 'toggle-memory'],
  get description(): string {
    if (isRemoteOnlyMemorySession()) {
      return 'Pause auto-memory for this session'
    }
    return 'Pause account memory and local auto-memory for this session (run again to turn both back on)'
  },
  isEnabled: () => false,
  get isHidden(): boolean {
    return !isRemoteOnlyMemorySession() && isEnvTruthy(process.env.IS_DEMO)
  },
  supportsNonInteractive: true,
  load: () => import('./pause-memory.js'),
  userFacingName(): string {
    return 'pause-memory'
  },
} satisfies Command

export default pauseMemory
