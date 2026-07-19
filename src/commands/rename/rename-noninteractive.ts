import type { LocalCommandCall } from '../../types/command.js'
import { applyRename } from './applyRename.js'

/** densable ADy / aSs — non-interactive `/rename`. */
export const call: LocalCommandCall = async (args, context) => {
  const { message } = await applyRename(args, context)
  return { type: 'text', value: message }
}
