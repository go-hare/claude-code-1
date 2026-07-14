/**
 * Official IF / Jb + neh/reh portable — CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT +
 * basalt_cove / model heuristics + velvet_cascade (reh) list.
 *
 * Official polarity (qqt-adjacent):
 *   force env on → true
 *   force env off → false
 *   else → !neh(model) || reh(model)
 *
 * neh(model) is true for known Claude 3 / Haiku / Sonnet / Opus 4.x family
 * (simple OFF by default). neh is false for EAP models and Mythos (simple ON).
 * reh is the velvet_cascade / simple_system_prompt model list (injected).
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import {
  isBasaltCoveEnabled,
  isOwnershipFrameEnabled,
} from './systemPromptArms.js'

const KNOWN_NEH_EXACT = new Set([
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
])

/**
 * Official neh — true means model is in the "default denser prompt" set
 * (simple system prompt OFF unless reh / force).
 */
export function isDenseDefaultSystemPromptModel(
  model: string | undefined,
): boolean {
  if (!model) return false
  // Official nUe: EAP models → neh false
  if (/-eap($|\[)/i.test(model)) return false
  // lean_prompt capability / mythos → neh false (simple ON)
  if (model === 'claude-mythos-5') return false
  if (
    model.includes('claude-3-') ||
    model.includes('haiku') ||
    model.includes('sonnet') ||
    KNOWN_NEH_EXACT.has(model)
  ) {
    return true
  }
  // Unknown models: official falls back to !rm(); densable default denser-off.
  return false
}

/**
 * @deprecated Prefer isDenseDefaultSystemPromptModel; name was inverted vs
 * official neh. Kept for callers that treated opus 4.x as "simple-eligible".
 */
export function isSimpleSystemPromptModel(model: string | undefined): boolean {
  // Historical local helper treated opus 4.5–4.7 as simple-eligible; official
  // neh marks them denser-default. New callers should use shouldUseSimpleSystemPrompt.
  return isDenseDefaultSystemPromptModel(model)
}

/**
 * Official reh — model on velvet_cascade.models list or simple_system_prompt
 * allowlist entry (injected via modelEligible / velvetCascadeModels).
 */
export function isVelvetCascadeModelEligible(
  model: string | undefined,
  velvetCascadeModels?: readonly string[] | null,
): boolean {
  if (!model) return false
  if (!velvetCascadeModels || velvetCascadeModels.length === 0) return false
  return velvetCascadeModels.some(
    entry => typeof entry === 'string' && model.includes(entry),
  )
}

export function shouldUseSimpleSystemPrompt(input: {
  model?: string
  env?: NodeJS.ProcessEnv
  /** Official reh — true when model is on velvet_cascade / simple_system_prompt list. */
  modelEligible?: boolean
  /** Optional lean_prompt capability (official dW). */
  leanPromptCapability?: boolean
  /** Optional GB tengu_velvet_cascade.models list (official reh). */
  velvetCascadeModels?: readonly string[] | null
}): boolean {
  const env = input.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT)) return true
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT)) return false

  // Official reh short-circuit
  if (input.modelEligible === true) return true
  if (isVelvetCascadeModelEligible(input.model, input.velvetCascadeModels)) {
    return true
  }

  const model = input.model
  if (!model) return false

  // Official lean_prompt / mythos → neh false → !neh true → simple ON
  if (input.leanPromptCapability === true || model === 'claude-mythos-5') {
    return true
  }
  // EAP
  if (/-eap($|\[)/i.test(model)) return true

  // BASALT_COVE is a related arm latch; when on, prefer simple for densable path
  // when model is not in the denser-default set.
  if (isBasaltCoveEnabled(env) && !isDenseDefaultSystemPromptModel(model)) {
    return true
  }

  // Official: !neh(model) || reh(model). reh already handled above.
  if (input.modelEligible === false) {
    // reh explicitly false — only !neh can enable
    return !isDenseDefaultSystemPromptModel(model)
  }
  return !isDenseDefaultSystemPromptModel(model)
}

/**
 * Official wrg lean static system-prompt body when Jb(model) is true.
 * Dense path keeps getSimpleIntroSection + getSimpleSystemSection stack.
 */
export function buildLeanSimpleSystemPrompt(input: {
  outputStyleActive?: boolean
  ownershipFrame?: boolean
  env?: NodeJS.ProcessEnv
  cyberRiskInstruction: string
}): string {
  const env = input.env ?? process.env
  const ownership = input.ownershipFrame ?? isOwnershipFrameEnabled(env)
  const style = input.outputStyleActive === true
  let intro: string
  if (ownership) {
    intro = style
      ? 'You work alongside the user and own the outcome of what you take on; your "Output Style" below describes how you should respond to queries.'
      : 'You work alongside the user on software engineering tasks and own the outcome of what you take on.'
  } else {
    intro = style
      ? 'You are an interactive agent that helps users according to your "Output Style" below, which describes how you should respond to user queries.'
      : 'You are an interactive agent that helps users with software engineering tasks.'
  }

  // Official ieu(..., "lean") harness bullet for system-reminder tags.
  const systemReminderLine =
    '`<system-reminder>` tags in messages and tool results are injected by the harness, not the user.'

  return `
${intro}

${input.cyberRiskInstruction}

# Harness
 - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.
 - Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.
 - ${systemReminderLine} Hooks may intercept tool calls; treat hook output as user feedback.
 - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.
 - Reference code as \`file_path:line_number\` — it's clickable.`
}

/**
 * Official arg(e) action_caution section — only when Jb (simple system prompt) is on.
 * Ownership-frame variant shortens the confirm-first sentence.
 */
export function getLeanActionCautionSection(input?: {
  ownershipFrame?: boolean
  env?: NodeJS.ProcessEnv
}): string {
  const env = input?.env ?? process.env
  const ownership = input?.ownershipFrame ?? isOwnershipFrameEnabled(env)
  const confirm = ownership
    ? 'For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking.'
    : "For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next."
  return `${confirm} Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target — if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.`
}
