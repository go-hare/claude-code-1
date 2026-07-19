import type { LocalCommandCall } from '../../types/command.js'
import { applyColor } from './applyColor.js'

/** densable Buy / $ms — non-interactive `/color`. */
export const call: LocalCommandCall = async (args, context) => {
  return { type: 'text', value: await applyColor(args, context) }
}
