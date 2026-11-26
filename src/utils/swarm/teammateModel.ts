import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  aliasMatchesParentTier,
  getDefaultSubagentModel,
} from '../model/agent.js'
import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { getMainLoopModel, parseUserSpecifiedModel } from '../model/model.js'
import {
  isModelAllowed,
  stepDownRestrictedFamilyAliasPick,
} from '../model/modelAllowlist.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// Last-resort only: used when the leader model cannot be resolved (no
// appState / getMainLoopModel). densable 2.1.234 #47: teammates follow the
// leader unless the spawn names a model — no /config default. Provider-aware
// so Bedrock/Vertex/Foundry customers get the correct model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}

export type ResolveTeammateModelDeps = {
  mainLoopModel: string
  hardcodedFallback: string
  /** Official 2.1.331 `yRe()` — `CLAUDE_CODE_SUBAGENT_MODEL` default (or `'inherit'`). */
  defaultSubagentModel?: string
  /** Official 2.1.331 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` — ignore explicit model & defer to env/leader. */
  forceSubagentModel?: boolean
  /** Official 2.1.331 `Hr(model)` — `availableModels` allowlist check. */
  isAllowed?: (model: string) => boolean
  /** Official 2.1.331 `cM(model)` — step down disallowed family alias to newest allowed model in family. */
  stepDownFamily?: (model: string) => string | null
  /** Official 2.1.331 `Xt(spec)` — resolve alias/model spec to canonical model ID. */
  resolveModel?: (spec: string) => string
  /** Official 2.1.331 `dbi(alias, leader)` — bare family alias matches leader tier. */
  matchesParentTier?: (alias: string, leader: string) => boolean
}

function warnTeammateModelNotAllowed(
  requested: string,
  usedFamilyStepDown: boolean,
): void {
  logForDebugging(
    `Teammate model "${requested}" is not in the availableModels allowlist; using the ${
      usedFamilyStepDown
        ? 'newest allowed model in its family'
        : "leader's model"
    } instead`,
    { level: 'warn' },
  )
}

/**
 * Resolve the model newly spawned teammates use.
 *
 * Official 2.1.331 `z` / `N` / `ee` / `W`:
 * 1. If `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, ignore explicit `inputModel`.
 * 2. Explicit `'inherit'` → follow leader (`leaderModel ?? mainLoopModel ?? hardcodedFallback`).
 * 3. Explicit concrete `inputModel`:
 *    - If disallowed by `availableModels`, step down to newest allowed model in its family
 *      (`stepDownFamily`), else fall back to `CLAUDE_CODE_SUBAGENT_MODEL` / leader.
 *    - If allowed and a bare family alias matching `leaderModel`, keep `leaderModel` exact string.
 *    - Otherwise keep `inputModel`.
 * 4. Omitted `inputModel`:
 *    - If `CLAUDE_CODE_SUBAGENT_MODEL` is set (and !== `'inherit'`), resolve it; if allowed use
 *      it, else step down in family or fall back to leader.
 *    - Otherwise follow leader.
 *
 * Pure helper — pass deps explicitly so tests need not mock config/model.
 */
export function resolveTeammateModelWith(
  inputModel: string | undefined,
  leaderModel: string | null,
  deps: ResolveTeammateModelDeps,
): string {
  const followLeader = (): string => {
    return leaderModel ?? deps.mainLoopModel ?? deps.hardcodedFallback
  }
  const isAllowed = deps.isAllowed ?? (() => true)
  const stepDownFamily = deps.stepDownFamily ?? (() => null)
  const resolveModel = deps.resolveModel ?? (spec => spec)
  const matchesParentTier = deps.matchesParentTier ?? (() => false)
  const envDefault = deps.defaultSubagentModel ?? 'inherit'

  const resolveEnvOrLeader = (): string => {
    if (envDefault !== 'inherit') {
      const resolvedEnv = resolveModel(envDefault)
      if (isAllowed(resolvedEnv)) return resolvedEnv
      return stepDownFamily(envDefault) ?? followLeader()
    }
    return followLeader()
  }

  const resolveDisallowed = (requested: string): string => {
    const stepped = stepDownFamily(requested)
    warnTeammateModelNotAllowed(requested, stepped !== null)
    return stepped ?? resolveEnvOrLeader()
  }

  let effectiveInput = inputModel
  if (deps.forceSubagentModel) {
    effectiveInput = undefined
  }
  if (effectiveInput === 'inherit') {
    return followLeader()
  }
  if (effectiveInput !== undefined) {
    const resolved = resolveModel(effectiveInput)
    if (!isAllowed(resolved)) {
      return resolveDisallowed(effectiveInput)
    }
    if (
      leaderModel !== null &&
      matchesParentTier(effectiveInput, leaderModel)
    ) {
      return leaderModel
    }
    return effectiveInput
  }
  if (envDefault !== 'inherit') {
    const resolvedEnv = resolveModel(envDefault)
    if (isAllowed(resolvedEnv)) {
      return resolvedEnv
    }
    return resolveDisallowed(envDefault)
  }
  return followLeader()
}

/**
 * Resolve default teammate model from leader session model.
 */
export function getDefaultTeammateModel(leaderModel: string | null): string {
  return resolveTeammateModel(undefined, leaderModel)
}

/**
 * Resolve a teammate model value. Handles the 'inherit' alias (from agent
 * frontmatter) by substituting the leader's model, `CLAUDE_CODE_SUBAGENT_MODEL`
 * / `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` env fallbacks, and `availableModels`
 * allowlist clamping (Official 2.1.331 `W` / `Z` / `z`).
 */
export function resolveTeammateModel(
  inputModel: string | undefined,
  leaderModel: string | null,
  _modelSource?: 'tool' | 'frontmatter',
): string {
  return resolveTeammateModelWith(inputModel, leaderModel, {
    mainLoopModel: getMainLoopModel(),
    hardcodedFallback: getHardcodedTeammateModelFallback(),
    defaultSubagentModel: getDefaultSubagentModel(),
    forceSubagentModel: isEnvTruthy(
      process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE,
    ),
    isAllowed: isModelAllowed,
    stepDownFamily: stepDownRestrictedFamilyAliasPick,
    resolveModel: parseUserSpecifiedModel,
    matchesParentTier: aliasMatchesParentTier,
  })
}
