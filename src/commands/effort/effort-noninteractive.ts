import type { LocalCommandCall } from '../../types/command.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { executeEffort, showCurrentEffort } from './effort.js'

const HELP = `Usage: /effort [low|medium|high|xhigh|max|auto|ultracode]

Effort levels:
- low: Quick, straightforward implementation
- medium: Balanced approach with standard testing
- high: Comprehensive implementation with extensive testing
- xhigh: Extended reasoning beyond high, short of max; including ChatGPT Codex models
- max: Maximum capability with deepest reasoning
- auto: Use the default effort level for your model
- ultracode: Session-only xhigh + dynamic workflow orchestration`

/** densable lLy / yEs — non-interactive `/effort`. */
export const call: LocalCommandCall = async (args, context) => {
  const r = args?.trim() || ''
  const state = context.getAppState()
  const model =
    state.mainLoopModelForSession ?? state.mainLoopModel ?? getMainLoopModel()

  if (r === 'help' || r === '-h' || r === '--help') {
    return { type: 'text', value: HELP }
  }
  if (r === 'current' || r === 'status') {
    return {
      type: 'text',
      value: showCurrentEffort(state.effortValue, model, state.ultracode)
        .message,
    }
  }
  // densable: empty in noninteractive → usage (no panel)
  if (!r) {
    return {
      type: 'text',
      value: 'Usage: /effort <low|medium|high|xhigh|max|auto|ultracode>',
    }
  }

  const result = executeEffort(r, { model })
  if (result.effortUpdate) {
    context.setAppState(prev => ({
      ...prev,
      effortValue: result.effortUpdate!.value,
      ultracode: result.effortUpdate!.ultracode === true,
    }))
  }
  return { type: 'text', value: result.message }
}
