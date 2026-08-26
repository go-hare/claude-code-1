import type { PermissionMode } from '../permissions/PermissionMode.js'
import { logForDebugging } from '../debug.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES, type ModelAlias } from './aliases.js'
import { applyBedrockRegionPrefix, getBedrockRegionPrefix } from './bedrock.js'
import {
  getCanonicalName,
  getRuntimeMainLoopModel,
  parseUserSpecifiedModel,
} from './model.js'
import {
  isModelAllowed,
  stepDownRestrictedFamilyAliasPick,
} from './modelAllowlist.js'
import { getAPIProvider } from './providers.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * densable Idp — bare family alias matches parent model tier.
 * When true and the resolved model is allowlisted, subagent keeps parent exact
 * string (no surprising downgrade). densable 2.1.222 #8: when the resolved
 * family default is NOT allowlisted, step down to newest org-allowed in family
 * instead of dropping to parent.
 */
export function aliasMatchesParentTier(
  alias: string,
  parentModel: string,
): boolean {
  const canonical = getCanonicalName(parentModel)
  switch (alias.toLowerCase()) {
    case 'fable':
      return canonical.includes('fable')
    case 'opus':
      return canonical.includes('opus')
    case 'sonnet':
      return canonical.includes('sonnet')
    case 'haiku':
      return canonical.includes('haiku')
    default:
      return false
  }
}

/**
 * densable $eb — warn when subagent model is not on availableModels.
 */
function warnSubagentModelNotAllowed(
  requested: string,
  usedFamilyStepDown: boolean,
): void {
  logForDebugging(
    `Subagent model "${requested}" is not in the availableModels allowlist; ${
      usedFamilyStepDown
        ? 'using the newest allowed model in its family'
        : 'inheriting the parent model'
    } instead`,
    { level: 'warn' },
  )
}

/**
 * densable s() inside coe — when resolved model fails isModelAllowed:
 * try a$(family step-down); else inherit parent (runtime).
 */
function resolveWhenNotAllowed(
  requestedSpec: string,
  parentModel: string,
  permissionMode: PermissionMode | undefined,
): string {
  const stepped = stepDownRestrictedFamilyAliasPick(requestedSpec)
  const usedFamily = stepped !== null
  warnSubagentModelNotAllowed(requestedSpec, usedFamily)

  if (usedFamily && stepped !== null) {
    return stepped
  }

  // densable: h!==null ? … : i() — no step-down → parent inherit
  return getRuntimeMainLoopModel({
    permissionMode: permissionMode ?? 'default',
    mainLoopModel: parentModel,
    exceeds200kTokens: false,
  })
}

/**
 * Get the effective model string for an agent.
 *
 * densable coe/Rdp (2.1.222 #8):
 * - CLAUDE_CODE_SUBAGENT_MODEL env (if set and not inherit)
 * - tool-specified model
 * - agent frontmatter model (default inherit)
 * - bare family alias matching parent → parent exact IF allowlisted
 * - else resolve alias; if not allowlisted → newest in family (a$) else parent
 *
 * For Bedrock, if the parent model uses a cross-region inference prefix (e.g., "eu.", "us."),
 * that prefix is inherited by subagents using alias models (e.g., "sonnet", "haiku", "opus").
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: ModelAlias,
  permissionMode?: PermissionMode,
): string {
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    const envSpec = process.env.CLAUDE_CODE_SUBAGENT_MODEL
    if (envSpec !== 'inherit') {
      const resolved = parseUserSpecifiedModel(envSpec)
      if (!isModelAllowed(resolved)) {
        return resolveWhenNotAllowed(envSpec, parentModel, permissionMode)
      }
      return resolved
    }
  }

  // Extract Bedrock region prefix from parent model to inherit for subagents.
  const parentRegionPrefix = getBedrockRegionPrefix(parentModel)

  const applyParentRegionPrefix = (
    resolvedModel: string,
    originalSpec: string,
  ): string => {
    if (parentRegionPrefix && getAPIProvider() === 'bedrock') {
      if (getBedrockRegionPrefix(originalSpec)) return resolvedModel
      return applyBedrockRegionPrefix(resolvedModel, parentRegionPrefix)
    }
    return resolvedModel
  }

  const resolveSpec = (spec: string): string => {
    if (spec === 'inherit') {
      return getRuntimeMainLoopModel({
        permissionMode: permissionMode ?? 'default',
        mainLoopModel: parentModel,
        exceeds200kTokens: false,
      })
    }

    // densable Idp: family matches parent → return parent only when allowed
    // (222 #8: if resolved default not allowed, step down in family)
    if (aliasMatchesParentTier(spec, parentModel)) {
      const resolvedAsDefault = parseUserSpecifiedModel(spec)
      if (isModelAllowed(resolvedAsDefault)) {
        return parentModel
      }
      // Parent tier match but org blocks default → family step-down
      return applyParentRegionPrefix(
        resolveWhenNotAllowed(spec, parentModel, permissionMode),
        spec,
      )
    }

    const model = parseUserSpecifiedModel(spec)
    const withRegion = applyParentRegionPrefix(model, spec)
    if (!isModelAllowed(withRegion)) {
      return applyParentRegionPrefix(
        resolveWhenNotAllowed(spec, parentModel, permissionMode),
        spec,
      )
    }
    return withRegion
  }

  // Prioritize tool-specified model if provided
  if (toolSpecifiedModel) {
    return resolveSpec(toolSpecifiedModel)
  }

  const agentModelWithExp = agentModel ?? getDefaultSubagentModel()
  return resolveSpec(agentModelWithExp)
}

export function getAgentModelDisplay(model: string | undefined): string {
  // When model is omitted, getDefaultSubagentModel() returns 'inherit' at runtime
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

/**
 * Get available model options for agents
 */
export function getAgentModelOptions(): AgentModelOption[] {
  return [
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient for simple tasks',
    },
    {
      // Official Que / aVt / URa descriptionForModel
      value: 'fable',
      label: 'Fable',
      description:
        'Fable 5 - most capable for your hardest and longest-running tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
}
