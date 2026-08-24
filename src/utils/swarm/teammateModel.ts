import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { getMainLoopModel } from '../model/model.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// Last-resort only: used when the leader model cannot be resolved (no
// appState / getMainLoopModel). densable 2.1.234 #47: teammates follow the
// leader unless the spawn names a model — no /config default. Provider-aware
// so Bedrock/Vertex/Foundry customers get the correct model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}

/**
 * Resolve the model newly spawned teammates use when the tool call omits
 * `model` / uses inherit.
 *
 * densable 2.1.234 #47: no configured default — follow leader, then
 * mainLoopModel / ANTHROPIC_MODEL, then hardcoded Opus last-resort.
 * Spawn-named model and `inherit` still work.
 *
 * Pure helper — pass deps explicitly so tests need not mock config/model.
 */
export function resolveTeammateModelWith(
  inputModel: string | undefined,
  leaderModel: string | null,
  deps: {
    mainLoopModel: string
    hardcodedFallback: string
  },
): string {
  const followLeader = (): string => {
    return leaderModel ?? deps.mainLoopModel ?? deps.hardcodedFallback
  }

  if (inputModel === 'inherit') {
    return leaderModel ?? followLeader()
  }
  return inputModel ?? followLeader()
}

/**
 * Resolve default teammate model from leader session model.
 */
export function getDefaultTeammateModel(leaderModel: string | null): string {
  return resolveTeammateModelWith(undefined, leaderModel, {
    mainLoopModel: getMainLoopModel(),
    hardcodedFallback: getHardcodedTeammateModelFallback(),
  })
}

/**
 * Resolve a teammate model value. Handles the 'inherit' alias (from agent
 * frontmatter) by substituting the leader's model. gh-31069: 'inherit' was
 * passed literally to --model, producing "It may not exist or you may not
 * have access". If leader model is null (not yet set), falls through to the
 * default.
 */
export function resolveTeammateModel(
  inputModel: string | undefined,
  leaderModel: string | null,
): string {
  return resolveTeammateModelWith(inputModel, leaderModel, {
    mainLoopModel: getMainLoopModel(),
    hardcodedFallback: getHardcodedTeammateModelFallback(),
  })
}
