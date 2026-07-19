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

/**
 * densable Tlc — CLAUDE_CODE_BASALT_COVE env OR model on GB basalt_cove map.
 *
 * densable: ye.CLAUDE_CODE_BASALT_COVE || blc("basalt_cove", model)
 * blc reads cM()?.[key] object entries where value===true and model includes key.
 *
 * Back-compat: env-only callers (no model/gb) keep truthy-env semantics.
 */
export function isBasaltCoveEnabled(
  input:
    | NodeJS.ProcessEnv
    | {
        env?: NodeJS.ProcessEnv
        model?: string
        /** densable cM()?.basalt_cove map, or true when any match already resolved. */
        basaltCoveModels?: Record<string, boolean> | null
        modelMatched?: boolean
      } = process.env,
): boolean {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const keys = Object.keys(input)
    if (
      keys.length > 0 &&
      keys.every(
        k =>
          k === 'env' ||
          k === 'model' ||
          k === 'basaltCoveModels' ||
          k === 'modelMatched',
      )
    ) {
      const o = input as {
        env?: NodeJS.ProcessEnv
        model?: string
        basaltCoveModels?: Record<string, boolean> | null
        modelMatched?: boolean
      }
      const env = o.env ?? process.env
      if (isEnvTruthy(env.CLAUDE_CODE_BASALT_COVE)) return true
      if (o.modelMatched === true) return true
      const model = o.model
      const map = o.basaltCoveModels
      if (model && map && typeof map === 'object') {
        return Object.entries(map).some(
          ([k, v]) => v === true && model.includes(k),
        )
      }
      return false
    }
  }
  return isEnvTruthy((input as NodeJS.ProcessEnv).CLAUDE_CODE_BASALT_COVE)
}

/** densable Slc — tengu_cobalt_thistle GB (default false). */
export function isCobaltThistleEnabled(
  input: EnvOrGbInput = process.env,
): boolean {
  const { env, gbValue } = splitEnvOrGb(input)
  if (env.CLAUDE_CODE_COBALT_THISTLE !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_COBALT_THISTLE)
  }
  return gbValue ?? false
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

/**
 * densable ZMy residual — heron_brook freeform system section.
 * Priority: clientData.tengu_heron_brook string > GrowthBook tengu_heron_brook.
 * Empty/whitespace → null. Callers may log tengu_heron_brook_applied.
 */
export function resolveHeronBrookSection(input?: {
  clientDataValue?: unknown
  growthBookValue?: string | null
}): string | null {
  const fromClient = input?.clientDataValue
  if (typeof fromClient === 'string' && fromClient.trim() !== '') {
    return fromClient.trim()
  }
  const fromGb = input?.growthBookValue
  if (typeof fromGb === 'string' && fromGb.trim() !== '') {
    return fromGb.trim()
  }
  return null
}

/**
 * densable p4e residual — fable_5_mitigations model family OR exact mythos-5 id.
 * Local residual: mythos exact match + fable_* / fable-5 / contains fable_5_mitigations.
 */
export function isFableMitigationsOrMythosModel(model: string | undefined): boolean {
  if (!model) return false
  if (model === 'claude-mythos-5') return true
  // densable gG(model, "fable_5_mitigations") — treat family prefix / explicit id
  if (model.includes('fable_5_mitigations')) return true
  if (model.startsWith('claude-fable-')) return true
  return false
}

/**
 * densable eNy / autonomy_append body when amber_sextant is on and model is
 * fable mitigations / mythos-5.
 */
export const AUTONOMY_APPEND_BODY = `You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to…?' or 'Shall I…?' will block the work. For reversible actions that follow from the original request, proceed without asking. Stop only for destructive actions or genuine scope changes the user must decide. Offering follow-ups after the task is done is fine; asking permission before doing the work is not.

Exception: when the user is describing a problem, asking a question, or thinking out loud rather than requesting a change, the deliverable is your assessment. Report your findings and stop. Don't apply a fix until they ask for one.

Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done ('I'll…', 'let me know when…'), do that work now with tool calls. That includes retrying after errors and gathering missing information yourself. Do not stop because the context or session is long. End your turn only when the task is complete or you are blocked on input only the user can provide.

Before running a command that changes system state — restarts, deletes, config edits — check that the evidence actually supports that specific action. A signal that pattern-matches to a known failure may have a different cause.`

/**
 * densable eNy residual — autonomy_append when GB tengu_amber_sextant (default true)
 * and model is fable mitigations / mythos-5.
 */
export function getAutonomyAppendSection(input: {
  model?: string
  /** densable et("tengu_amber_sextant", true) */
  amberSextant?: boolean
}): string | null {
  if (input.amberSextant === false) return null
  if (!isFableMitigationsOrMythosModel(input.model)) return null
  return AUTONOMY_APPEND_BODY
}

/**
 * densable ZMy wired for prompts — clientData first, else GB string.
 * Pure when injectables provided; otherwise reads config + growthbook.
 */
export function getHeronBrookSection(input?: {
  clientDataValue?: unknown
  growthBookValue?: string | null
}): string | null {
  if (input && ('clientDataValue' in input || 'growthBookValue' in input)) {
    return resolveHeronBrookSection(input)
  }
  let clientDataValue: unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    clientDataValue = getGlobalConfig().clientDataCache?.['tengu_heron_brook']
  } catch {
    clientDataValue = undefined
  }
  let growthBookValue: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    growthBookValue = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_heron_brook',
      '',
    )
  } catch {
    growthBookValue = null
  }
  return resolveHeronBrookSection({ clientDataValue, growthBookValue })
}

/**
 * densable XMy residual — always-on pronouns guidance for user-visible text.
 */
export const PRONOUNS_SECTION =
  "When you use a pronoun for someone — the user or anyone else you mention — and their pronouns haven't been stated, use they/them. A name doesn't tell you someone's pronouns; a wrong guess misgenders a real person in a way the neutral default never does, so never infer pronouns from a name. This applies to all user-visible text, including visible thinking."

export function getPronounsSection(): string {
  return PRONOUNS_SECTION
}

/**
 * densable KMy residual body — task continuity after agreement.
 * densable vlc(model) currently hard-returns false, so this is never emitted
 * upstream; keep pure helper for env/GB re-enable and tests.
 */
export const TASK_CONTINUITY_BODY =
  "When a task has been agreed, the approval covers it end to end — in-scope steps don't need re-confirmation (irreversible or shared-system actions still do). Announcing a step without the tool call in the same turn hands control back with the work still pending; if the next step is decided, run it. Hand back only when done, waiting on something external, or the next step needs the user's decision. If the user asks something mid-task, answer and continue."

/**
 * densable KMy residual: emit only when modelGate is true and ownershipFrame
 * is not active (ivs).
 */
export function getTaskContinuitySection(input?: {
  /** densable vlc(model) — currently always false upstream. */
  modelGate?: boolean
  /** densable ivs() ownership frame — when true, section is suppressed. */
  ownershipFrame?: boolean
}): string | null {
  if (!input?.modelGate) return null
  if (input.ownershipFrame) return null
  return TASK_CONTINUITY_BODY
}

/**
 * densable BLr — claude-fable-* family prefix.
 */
export function isClaudeFableModel(model: string | undefined): boolean {
  return Boolean(model && model.startsWith('claude-fable-'))
}

/**
 * densable YMy residual — fable_identity freeform (short residual copy).
 * Full densable string is longer product marketing; keep portable core.
 */
export const FABLE_IDENTITY_BODY =
  "This iteration of Claude is Claude Fable 5, the first model in Anthropic's new Claude 5 family and part of a new Mythos-class model tier that sits above Claude Opus in capability. Claude Fable 5 and Claude Mythos 5 share the same underlying model. Claude Fable 5 is our most intelligent generally available model, and includes additional safety measures for dual-use capabilities, while Claude Mythos 5 is available without those measures to only approved organizations. Fable 5 is the most advanced generally available Claude model. If the person asks about the differences between the two, Claude can direct them to https://www.anthropic.com/news/claude-fable-5-mythos-5 for more information."

/**
 * densable fable_identity section when model is claude-fable-* or
 * ANTHROPIC_DEFAULT_FABLE_MODEL alias match (caller supplies isDefaultFableAlias).
 */
export function getFableIdentitySection(input: {
  model?: string
  /** densable Cee — model matches ANTHROPIC_DEFAULT_FABLE_MODEL. */
  isDefaultFableAlias?: boolean
}): string | null {
  if (isClaudeFableModel(input.model) || input.isDefaultFableAlias) {
    return FABLE_IDENTITY_BODY
  }
  return null
}

/**
 * densable VMy residual — anti_verbosity / communicating-with-user branches.
 *
 * densable:
 *   if WMy/basalt_cove family → long "# Communicating with the user" (+ optional
 *     final-message-only paragraph when fable mitigations and not brief/pewter)
 *   else if simpleSystemPrompt (vT) → short code-comment line
 *   else → "# Text output …" denser default
 */
export type AntiVerbosityMode = 'communicating' | 'simple' | 'default'

export function resolveAntiVerbosityMode(input: {
  /** densable WMy || Tlc(basalt_cove) — long communicating path. */
  communicatingFamily?: boolean
  simpleSystemPrompt?: boolean
}): AntiVerbosityMode {
  if (input.communicatingFamily) return 'communicating'
  if (input.simpleSystemPrompt) return 'simple'
  return 'default'
}

export const ANTI_VERBOSITY_SIMPLE_BODY =
  'Write code that reads like the surrounding code: match its comment density, naming, and idiom.'

export const ANTI_VERBOSITY_DEFAULT_BODY = `# Text output (does not apply to tool calls)
Assume users can't see most tool calls or thinking — only your text output. Before your first tool call, state in one sentence what you're about to do. While working, give short updates at key moments: when you find something, when you change direction, or when you hit a blocker. Brief is good — silent is not. One sentence per update is almost always enough.

Don't narrate your internal deliberation. User-facing text should be relevant communication to the user, not a running commentary on your thought process. State results and decisions directly, and focus user-facing text on relevant updates for the user.

When you do write updates, write so the reader can pick up cold: complete sentences, no unexplained jargon or shorthand from earlier in the session. But keep it tight — a clear sentence is better than a clear paragraph.

End-of-turn summary: one or two sentences. What changed and what's next. Nothing else.

Match responses to the task: a simple question gets a direct answer, not headers and sections.

In code: default to writing no comments. Never write multi-paragraph docstrings or multi-line comment blocks — one short line max. Don't create planning, decision, or analysis documents unless the user asks for them — work from conversation context, not intermediate files.`

/**
 * densable VMy communicating-family body. When finalMessageOnly (GMy), include
 * the "final text message of your turn" paragraph.
 */
export function buildAntiVerbosityCommunicatingBody(
  finalMessageOnly: boolean,
): string {
  const first =
    finalMessageOnly
      ? "Your text output is what the user reads; they usually can't see your thinking or the raw tool results."
      : "Your text output is what the user reads between tool calls; they usually can't see your thinking or the raw tool results."
  const mid = finalMessageOnly
    ? `

Text you write between tool calls may not be shown to the user. Everything the user needs from this turn — answers, summaries, findings, conclusions, deliverables — must be in the final text message of your turn, with no tool calls after it. Keep text between tool calls to brief status notes. If something important appeared only mid-turn or in your thinking, restate it in that final message.`
    : ''
  return `# Communicating with the user

${first} Write it for a teammate who stepped away and is catching up, not for a log file: they don't know the codenames or shorthand you created along the way, and they didn't watch your process unfold. Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.${mid}

Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find" — the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after, for readers who want them.

Being readable and being concise are different things, and readable matters more. If the user has to reread your summary or ask you to explain, any time saved by brevity is gone. The way to keep output short is to be selective about what you include (drop details that don't change what the reader would do next), not to compress the writing into fragments, abbreviations, arrow chains like \`A → B → fails\`, or jargon. What you do include, write in complete sentences with the technical terms spelled out. Don't make the reader cross-reference labels or numbering you invented earlier; say what you mean in place.

Match the response to the question: a simple question gets a direct answer in prose, not headers and sections. Use tables only for short enumerable facts, with explanations in the surrounding prose rather than the cells. Calibrate to the user — a bit tighter for an expert, more explanatory for someone newer.

Write code that reads like the surrounding code: match its comment density, naming, and idiom.
Only write a code comment to state a constraint the code itself can't show — never to say where it came from, what the next line does, or why your change is correct; that's you talking to the reviewer, not the next reader, and it's noise the moment the PR merges.`
}

/**
 * densable VMy pure residual — pick body by mode.
 * finalMessageOnly only applies to communicating mode (densable GMy).
 */
export function getAntiVerbositySection(input: {
  communicatingFamily?: boolean
  simpleSystemPrompt?: boolean
  finalMessageOnly?: boolean
}): string {
  const mode = resolveAntiVerbosityMode(input)
  if (mode === 'communicating') {
    return buildAntiVerbosityCommunicatingBody(Boolean(input.finalMessageOnly))
  }
  if (mode === 'simple') return ANTI_VERBOSITY_SIMPLE_BODY
  return ANTI_VERBOSITY_DEFAULT_BODY
}

/**
 * densable lxd residual — worktree-only git stash safety note in env_info.
 */
export const WORKTREE_GIT_STASH_NOTE =
  'The git stash stack is shared with the main checkout and all other worktrees, and other Claude sessions may push or pop it concurrently. Never use bare `git stash` / `git stash pop` — you could pop another session\'s changes. Prefer a temporary WIP commit to set work aside; if you must stash, use `git stash push -u -m "<unique-tag>"`, immediately capture your entry\'s SHA via `git stash list --format=\'%H %gs\'`, restore with `git stash apply <sha>` (not pop), and afterwards drop the entry, re-finding its current `stash@{n}` by tag first.'

/**
 * densable gNy: when isWorktree, emit worktree isolation + stash note.
 */
export function getWorktreeEnvNotes(isWorktree: boolean): string[] {
  if (!isWorktree) return []
  return [
    'This is a git worktree — an isolated copy of the repository. Run all commands from this directory. Do NOT `cd` to the original repository root.',
    WORKTREE_GIT_STASH_NOTE,
  ]
}

/**
 * densable JMy residual — tool_param_json strictness body.
 */
export const TOOL_PARAM_JSON_BODY =
  'Object and array parameter values must be a single JSON value — never write parameter-tag markup inside a JSON value.'

/**
 * densable RHc/JMy — emit when toolParamStrictness is on, or when
 * fable mitigations/mythos + silent_harbor GB.
 */
export function getToolParamJsonSection(input: {
  toolParamStrictness?: boolean
  fableOrMythos?: boolean
  silentHarbor?: boolean
}): string | null {
  if (input.toolParamStrictness) return TOOL_PARAM_JSON_BODY
  if (input.fableOrMythos && input.silentHarbor) return TOOL_PARAM_JSON_BODY
  return null
}

/**
 * densable oNy residual — mid-conversation system turns notice.
 */
export const MID_CONVERSATION_SYSTEM_NOTICE =
  'The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results.'

/**
 * densable sxd residual — system-reminder tag guidance by mode.
 */
export function getSystemReminderTagSection(input: {
  /** densable ixd — mid-conversation system path active. */
  midConversationSystem?: boolean
  mode?: 'standard' | 'harness'
}): string {
  if (input.midConversationSystem) return MID_CONVERSATION_SYSTEM_NOTICE
  if (input.mode === 'standard') {
    return 'Tool results and user messages may include <system-reminder> or other tags. Tags contain information from the system. They bear no direct relation to the specific tool results or user messages in which they appear.'
  }
  return '`<system-reminder>` tags in messages and tool results are injected by the harness, not the user.'
}

/** densable EHc / vHc — marsh_lantern tool-search reminder defaults. */
export const JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS = 15
export const JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES = 10

export type JuniperToolSearchReminder = {
  everyNTurns: number
  maxNames: number
}

/**
 * densable K2r residual — parse clientData.juniper_shoal (or equivalent) into
 * product flags. Invalid / missing → defaults (all false, reminder null).
 */
export type JuniperShoalFlags = {
  toolSearchReminder: JuniperToolSearchReminder | null
  toolParamStrictness: boolean
  emptyInputRepair: boolean
  toolSearchFetchRule: boolean
  schemaDescFixes: boolean
}

export const DEFAULT_JUNIPER_SHOAL_FLAGS: JuniperShoalFlags = Object.freeze({
  toolSearchReminder: null,
  toolParamStrictness: false,
  emptyInputRepair: false,
  toolSearchFetchRule: false,
  schemaDescFixes: false,
})

export function resolveJuniperShoalFlags(
  juniperShoal: unknown,
): JuniperShoalFlags {
  if (
    typeof juniperShoal !== 'object' ||
    juniperShoal === null ||
    Array.isArray(juniperShoal)
  ) {
    return DEFAULT_JUNIPER_SHOAL_FLAGS
  }
  const t = juniperShoal as Record<string, unknown>
  let toolSearchReminder: JuniperToolSearchReminder | null = null
  const marsh = t.marsh_lantern
  if (marsh === true) {
    toolSearchReminder = Object.freeze({
      everyNTurns: JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS,
      maxNames: JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES,
    })
  } else if (typeof marsh === 'object' && marsh !== null && !Array.isArray(marsh)) {
    const o = marsh as Record<string, unknown>
    const stride =
      typeof o.stride === 'number' &&
      Number.isInteger(o.stride) &&
      o.stride >= 1
        ? o.stride
        : JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS
    const span =
      typeof o.span === 'number' && Number.isInteger(o.span) && o.span >= 1
        ? o.span
        : JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES
    toolSearchReminder = Object.freeze({
      everyNTurns: stride,
      maxNames: span,
    })
  }
  return Object.freeze({
    toolSearchReminder,
    toolParamStrictness: t.bracken_spool === true,
    emptyInputRepair: t.teasel_cove === true,
    toolSearchFetchRule: t.gorse_hollow === true,
    schemaDescFixes: t.thistle_skein === true,
  })
}

/**
 * densable K2r reader — clientDataCache.juniper_shoal when available.
 */
export function getJuniperShoalFlagsFromClientData(
  clientData?: Record<string, unknown> | null,
): JuniperShoalFlags {
  if (clientData && 'juniper_shoal' in clientData) {
    return resolveJuniperShoalFlags(clientData.juniper_shoal)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    const cache = getGlobalConfig().clientDataCache
    return resolveJuniperShoalFlags(cache?.['juniper_shoal'])
  } catch {
    return DEFAULT_JUNIPER_SHOAL_FLAGS
  }
}

/** densable f1i / RHc / xHc / kHc / m1i convenience readers. */
export function getJuniperToolSearchReminder(
  clientData?: Record<string, unknown> | null,
): JuniperToolSearchReminder | null {
  return getJuniperShoalFlagsFromClientData(clientData).toolSearchReminder
}

export function isJuniperToolParamStrictnessEnabled(
  clientData?: Record<string, unknown> | null,
): boolean {
  return getJuniperShoalFlagsFromClientData(clientData).toolParamStrictness
}

export function isJuniperEmptyInputRepairEnabled(
  clientData?: Record<string, unknown> | null,
): boolean {
  return getJuniperShoalFlagsFromClientData(clientData).emptyInputRepair
}

export function isJuniperToolSearchFetchRuleEnabled(
  clientData?: Record<string, unknown> | null,
): boolean {
  return getJuniperShoalFlagsFromClientData(clientData).toolSearchFetchRule
}

export function isJuniperSchemaDescFixesEnabled(
  clientData?: Record<string, unknown> | null,
): boolean {
  return getJuniperShoalFlagsFromClientData(clientData).schemaDescFixes
}

/**
 * densable h1i — true when value is a plain empty object `{}`.
 */
export function isEmptyPlainObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  )
}

/**
 * densable QFh — placeholder sample values for required Zod fields when
 * building a minimal valid call shape for empty-input repair messaging.
 * Accepts a Zod-like type with constructor name / options / values so tests
 * don't need a live Zod instance for every branch.
 */
export function sampleValueForZodField(
  fieldName: string,
  schema: unknown,
): unknown {
  if (!schema || typeof schema !== 'object') return `<${fieldName}>`
  const s = schema as {
    constructor?: { name?: string }
    options?: unknown
    values?: unknown
  }
  const name = s.constructor?.name
  if (name === 'ZodString') return `<${fieldName}>`
  if (name === 'ZodNumber') return 0
  if (name === 'ZodBoolean') return false
  if (name === 'ZodArray') return []
  if (name === 'ZodEnum') {
    const opts = s.options
    if (Array.isArray(opts) && opts.length > 0) return opts[0]
  }
  if (name === 'ZodLiteral') {
    const values = s.values
    if (values instanceof Set) {
      const first = values.values().next().value
      if (first !== undefined) return first
    }
    if (Array.isArray(values) && values.length > 0) return values[0]
  }
  return `<${fieldName}>`
}

/**
 * densable IHc — when the model sent `{}` for a ZodObject with required
 * params, return a steerable error that shows the minimal valid call shape.
 * Returns null when schema is not a ZodObject, has no required fields, or the
 * minimal sample fails safeParse.
 */
export function formatEmptyInputRepairMessage(
  toolName: string,
  inputSchema: unknown,
  jsonStringify: (v: unknown) => string = JSON.stringify,
): string | null {
  try {
    if (
      !inputSchema ||
      typeof inputSchema !== 'object' ||
      (inputSchema as { constructor?: { name?: string } }).constructor?.name !==
        'ZodObject'
    ) {
      return null
    }
    const schema = inputSchema as {
      shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>
      safeParse: (v: unknown) => { success: boolean }
    }
    const shape = schema.shape
    if (!shape || typeof shape !== 'object') return null
    const required = Object.entries(shape).filter(
      ([, field]) => !field.safeParse(undefined).success,
    )
    if (required.length === 0) return null
    const sample: Record<string, unknown> = {}
    for (const [key, field] of required) {
      sample[key] = sampleValueForZodField(key, field)
    }
    if (!schema.safeParse(sample).success) return null
    const listed = required.map(([k]) => `\`${k}\``).join(', ')
    return `The ${toolName} tool was called with an empty input object ({}), but it has required parameters: ${listed}. Minimal valid call shape: ${jsonStringify(sample)}. Re-issue the call with real values for each required parameter.`
  } catch {
    return null
  }
}
