/**
 * Official system-prompt arm env gates (portable pure helpers).
 *
 * Full prompt-section bodies for act_dont_rederive / ownership_frame /
 * investigate_first / skill_desc_reframe remain denser; these are the env
 * switches official uses alongside GrowthBook latches.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

type EnvOrGbInput =
  | NodeJS.ProcessEnv
  | { env?: NodeJS.ProcessEnv; gbValue?: boolean }

function splitEnvOrGb(input: EnvOrGbInput = process.env): {
  env: NodeJS.ProcessEnv
  gbValue?: boolean
} {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const keys = Object.keys(input)
    // Options bag: only { env?, gbValue? } — never a ProcessEnv with CLAUDE_* keys
    if (keys.length > 0 && keys.every(k => k === 'env' || k === 'gbValue')) {
      const o = input as { env?: NodeJS.ProcessEnv; gbValue?: boolean }
      return { env: o.env ?? process.env, gbValue: o.gbValue }
    }
  }
  return { env: (input as NodeJS.ProcessEnv) ?? process.env }
}

/**
 * Official Arg densable — env CLAUDE_CODE_ACT_DONT_REDERIVE when set,
 * else optional GB tengu_cedar_lantern (official default true when GB wired).
 * Env-only callers (no gbValue) stay false when unset.
 */
export function isActDontRederiveEnabled(
  input: EnvOrGbInput = process.env,
): boolean {
  const { env, gbValue } = splitEnvOrGb(input)
  if (env.CLAUDE_CODE_ACT_DONT_REDERIVE !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_ACT_DONT_REDERIVE)
  }
  return gbValue ?? false
}

/**
 * Official a5i densable — env OR GB tengu_walnut_prism (default false).
 */
export function isOwnershipFrameEnabled(
  input: EnvOrGbInput = process.env,
): boolean {
  const { env, gbValue } = splitEnvOrGb(input)
  if (isEnvTruthy(env.CLAUDE_CODE_OWNERSHIP_FRAME)) return true
  return gbValue ?? false
}

export type InvestigateFirstMode = 'off' | 'additive' | 'compact'

/**
 * Official p5i — investigate_first only applies to claude-opus-4-7.
 * Env: additive | compact | truthy→additive | off/falsy→off.
 * When simple system prompt (Jb) is on, official forces off.
 * Optional GB tengu_slate_harrier mode when env unset.
 */
export function resolveInvestigateFirstMode(input: {
  model?: string
  env?: NodeJS.ProcessEnv
  /** Official Jb(model) — when true, mode is off. */
  simpleSystemPrompt?: boolean
  /** Optional GB tengu_slate_harrier value. */
  slateHarrier?: string | null
}): InvestigateFirstMode {
  const model = input.model
  if (!model || model !== 'claude-opus-4-7') return 'off'
  const env = input.env ?? process.env
  const raw = env.CLAUDE_CODE_INVESTIGATE_FIRST
  if (raw === 'additive' || raw === 'compact') return raw
  if (isEnvTruthy(raw)) return 'additive'
  if (raw === 'off' || isEnvDefinedFalsy(raw)) return 'off'
  if (input.simpleSystemPrompt === true) return 'off'
  const gb = input.slateHarrier
  if (gb === 'additive' || gb === 'compact') return gb
  return 'off'
}

export function isInvestigateFirstEnabled(
  env: NodeJS.ProcessEnv = process.env,
  model?: string,
): boolean {
  // Back-compat: env-only callers (no model) keep truthy-env semantics.
  if (model === undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_INVESTIGATE_FIRST)
  }
  return resolveInvestigateFirstMode({ model, env }) !== 'off'
}

export function isSkillDescReframeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKILL_DESC_REFRAME)
}

export function isKbCohesionFixesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_KB_COHESION_FIXES)
}

/**
 * Official JXe densable — GB tengu_lantern_prism OR env.
 */
export function isLanternPrismEnabled(
  input: EnvOrGbInput = process.env,
): boolean {
  const { env, gbValue } = splitEnvOrGb(input)
  if (gbValue) return true
  return isEnvTruthy(env.CLAUDE_CODE_LANTERN_PRISM)
}

export function isBasaltCoveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BASALT_COVE)
}

/**
 * Official TSc densable — GB tengu_walnut_spire OR env.
 */
export function isWalnutSpireEnabled(
  input: EnvOrGbInput = process.env,
): boolean {
  const { env, gbValue } = splitEnvOrGb(input)
  if (gbValue) return true
  return isEnvTruthy(env.CLAUDE_CODE_WALNUT_SPIRE)
}

/**
 * Official $Zc densable (env branch) — PEWTER_OWL or PEWTER_OWL_TOOL truthy.
 * Full model-string + GB tengu_* denser.
 */
export function isPewterOwlEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CLAUDE_CODE_PEWTER_OWL !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_PEWTER_OWL)
  }
  if (env.CLAUDE_CODE_PEWTER_OWL_TOOL !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_PEWTER_OWL_TOOL)
  }
  return false
}

/** Official act_dont_rederive system-prompt body (portable). */
export const ACT_DONT_REDERIVE_BODY =
  'When you have enough information to act, act. Do not re-derive facts already established in the conversation, re-litigate a decision the user has already made, or narrate options you will not pursue. If you are weighing a choice, give a recommendation, not an exhaustive survey'

/**
 * Official ownership_frame densable core (binary string).
 * Related opening-frame variants also exist for Output Style; this is the arm body.
 */
export const OWNERSHIP_FRAME_BODY =
  'You work alongside the user on software engineering tasks and own the outcome of what you take on.'

/** Official Frg investigate_first system-prompt body. */
export const INVESTIGATE_FIRST_BODY =
  'Asking the user a clarifying question has a cost: it interrupts them, and often they could have answered it themselves with a grep. Before asking, spend up to a minute on read-only investigation (grep the codebase, check docs, search memory) so your question is specific. "I found tunnels X and Y in the config — which one?" beats "what tunnel?"'

/**
 * Official skill_desc_reframe Skill tool description body (Eyg / string table).
 * Tag name for the already-loaded marker is injected by the Skill tool prompt.
 */
export const SKILL_DESC_REFRAME_BODY_PREFIX =
  'Execute a skill within the main conversation\n' +
  '\n' +
  'When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.\n' +
  '\n' +
  'When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.\n' +
  '\n' +
  'How to invoke:\n' +
  '- Set `skill` to the exact name of an available skill (no leading slash). For plugin-namespaced skills use the fully qualified `plugin:skill` form.\n' +
  '- Set `args` to pass optional arguments.\n' +
  "- Some skills are scoped to a directory: their name is prefixed with the directory (e.g. `apps/web:deploy`) and their description says which directory they apply to. When a skill name has both a scoped and an unscoped variant, pick by the files you are working on: if the files are under a variant's directory, invoke that variant (most specific directory wins); otherwise invoke the unscoped one.\n" +
  '\n' +
  'Important:\n' +
  '- Available skills are listed in system-reminder messages in the conversation\n' +
  '- Only invoke a skill that appears in that list, or one the user explicitly typed as `/<name>` in their message. Never guess or invent a skill name from training data; otherwise do not call this tool\n' +
  "- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task\n" +
  '- NEVER mention a skill without actually calling this tool\n' +
  '- Do not invoke a skill that is already running\n' +
  '- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)\n' +
  '- If you see a <'

export const SKILL_DESC_REFRAME_BODY_SUFFIX =
  '> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again\n'

export function getSkillDescReframeBody(commandNameTag: string): string {
  return (
    SKILL_DESC_REFRAME_BODY_PREFIX +
    commandNameTag +
    SKILL_DESC_REFRAME_BODY_SUFFIX
  )
}

export function getActDontRederiveSection(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isActDontRederiveEnabled(env)) return null
  return ACT_DONT_REDERIVE_BODY
}

export function getOwnershipFrameSection(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isOwnershipFrameEnabled(env)) return null
  return OWNERSHIP_FRAME_BODY
}

/**
 * Official investigate_first densable body (Frg).
 * Prefer resolveInvestigateFirstMode with model for official p5i polarity.
 */
export function getInvestigateFirstSection(
  envOrInput:
    | NodeJS.ProcessEnv
    | {
        env?: NodeJS.ProcessEnv
        model?: string
        simpleSystemPrompt?: boolean
        slateHarrier?: string | null
      } = process.env,
): string | null {
  if (
    envOrInput &&
    typeof envOrInput === 'object' &&
    !Array.isArray(envOrInput) &&
    ('model' in envOrInput ||
      'simpleSystemPrompt' in envOrInput ||
      'slateHarrier' in envOrInput ||
      'env' in envOrInput)
  ) {
    const input = envOrInput as {
      env?: NodeJS.ProcessEnv
      model?: string
      simpleSystemPrompt?: boolean
      slateHarrier?: string | null
    }
    if (
      resolveInvestigateFirstMode({
        model: input.model,
        env: input.env,
        simpleSystemPrompt: input.simpleSystemPrompt,
        slateHarrier: input.slateHarrier,
      }) === 'off'
    ) {
      return null
    }
    return INVESTIGATE_FIRST_BODY
  }
  const env = envOrInput as NodeJS.ProcessEnv
  if (!isInvestigateFirstEnabled(env)) return null
  return INVESTIGATE_FIRST_BODY
}
