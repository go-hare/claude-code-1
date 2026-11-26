import type { LocalCommandCall } from '../../types/command.js'
import { getActiveAttachHandle, stopBackgroundSession } from './stopCore.js'

/**
 * Official 2.1.331 `chunk-abdw72ht.js` — headless/bridge `/stop` handler.
 */
export const call: LocalCommandCall = async (_args, _context) => {
  const attach = getActiveAttachHandle()
  if (attach !== null) {
    attach.close()
    return { type: 'skip' }
  }
  await stopBackgroundSession('bridge')
  return { type: 'skip' }
}
