import { getGlobalConfig } from '../config.js'
import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { getMainLoopModel, parseUserSpecifiedModel } from '../model/model.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// Last-resort only: used when teammateDefaultModel is unset/null AND the
// leader model cannot be resolved (no appState / getMainLoopModel). Prefer
// following the leader (see getDefaultTeammateModel). Provider-aware so
// Bedrock/Vertex/Foundry customers get the correct model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}

/**
 * Resolve the model newly spawned teammates use when the tool call omits
 * `model` / uses inherit.
 *
 * - unset (`undefined`) and explicit Default (`null`) both follow the leader
 * - `leaderModel` may be null ("use default"); fall through to
 *   `mainLoopModel` so ANTHROPIC_MODEL / settings / tier defaults apply
 * - hardcoded Opus remains only the last-resort safety net
 *
 * Pure helper — pass deps explicitly so tests need not mock config/model.
 */
export function resolveTeammateModelWith(
  inputModel: string | undefined,
  leaderModel: string | null,
  deps: {
    configured: string | null | undefined
    mainLoopModel: string
    hardcodedFallback: string
  },
): string {
  const followDefault = (): string => {
    const { configured, mainLoopModel, hardcodedFallback } = deps
    if (configured === null || configured === undefined) {
      return leaderModel ?? mainLoopModel ?? hardcodedFallback
    }
    return parseUserSpecifiedModel(configured)
  }

  if (inputModel === 'inherit') {
    return leaderModel ?? followDefault()
  }
  return inputModel ?? followDefault()
}

/**
 * Resolve default teammate model from global config + leader session model.
 */
export function getDefaultTeammateModel(leaderModel: string | null): string {
  return resolveTeammateModelWith(undefined, leaderModel, {
    configured: getGlobalConfig().teammateDefaultModel,
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
    configured: getGlobalConfig().teammateDefaultModel,
    mainLoopModel: getMainLoopModel(),
    hardcodedFallback: getHardcodedTeammateModelFallback(),
  })
}
