import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  applyModelSet,
  formatCurrentModel,
  modelUsageText,
} from './applyModel.js'

/** densable zOy / iEs — non-interactive `/model`. */
export const call: LocalCommandCall = async (args, context) => {
  const r = args?.trim() || ''
  if (!r || COMMON_INFO_ARGS.includes(r)) {
    const s = context.getAppState()
    return {
      type: 'text',
      value: `${formatCurrentModel(
        s.mainLoopModel,
        s.mainLoopModelForSession,
        s.effortValue,
      )}\n${modelUsageText()}`,
    }
  }
  if (COMMON_HELP_ARGS.includes(r)) {
    return { type: 'text', value: modelUsageText() }
  }
  // densable: non-interactive does not persist as default (session only)
  const message = await applyModelSet(r, context, { persistDefault: false })
  return { type: 'text', value: message }
}
