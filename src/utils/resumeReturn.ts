/**
 * Official resume-return offer (CBp / kdo / vde portable subset).
 *
 * When a session is old + large enough, official offers:
 *   compact | continue | never
 * gated by GrowthBook `tengu_gleaming_fair` and globalConfig.resumeReturnDismissed.
 * Full dialog UI (Oga) is denser; pure evaluation + copy land here.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getGlobalConfig } from './config.js'
import { parseEnvInt as parseEnvIntShared } from './envUtils.js'
import { formatTokens } from './format.js'

/** Official default: 70 minutes of idle age before offering. */
export const RESUME_THRESHOLD_MINUTES_DEFAULT = 70

/** Official default: 100_000 estimated tokens before offering. */
export const RESUME_TOKEN_THRESHOLD_DEFAULT = 100_000

/** Official "freshness" window — last message must be older than 60s. */
export const RESUME_FRESHNESS_MS = 60_000

/** Official kdo default continuation prompt. */
export const RESUME_PROMPT_DEFAULT = 'Continue from where you left off.'

export type ResumeReturnChoice = 'compact' | 'continue' | 'never'

export type ResumeReturnOffer = {
  sessionAgeMinutes: number
  estimatedTokens: number
}

export type ResumeReturnMessage = {
  type: string
  timestamp?: string
}

/**
 * Official vde + densable 2.1.211: integer env parse accepting `1e6` / `64_000`.
 * Re-export of shared `envUtils.parseEnvInt` so resume callers keep one import.
 */
export function parseEnvInt(raw: string | undefined, fallback: number): number {
  return parseEnvIntShared(raw, fallback)
}

/** Official kdo — CLAUDE_CODE_RESUME_PROMPT or default. */
export function getResumePrompt(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CODE_RESUME_PROMPT || RESUME_PROMPT_DEFAULT
}

export function getResumeThresholdMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseEnvInt(
    env.CLAUDE_CODE_RESUME_THRESHOLD_MINUTES,
    RESUME_THRESHOLD_MINUTES_DEFAULT,
  )
}

export function getResumeTokenThreshold(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseEnvInt(
    env.CLAUDE_CODE_RESUME_TOKEN_THRESHOLD,
    RESUME_TOKEN_THRESHOLD_DEFAULT,
  )
}

/**
 * Official dialog copy / options (Oga pure subset).
 */
export const RESUME_RETURN_OPTIONS: ReadonlyArray<{
  value: ResumeReturnChoice
  label: string
}> = [
  { value: 'compact', label: 'Resume from summary (recommended)' },
  { value: 'continue', label: 'Resume full session as-is' },
  { value: 'never', label: "Don't ask me again" },
]

/**
 * densable tXg — age for W8c banner.
 * Dump has e<60 and t<24 arms; t>=24 continues the same `Xh` / `Xh Ym`
 * formula (no invented day unit).
 */
export function formatResumeReturnAge(minutes: number): string {
  if (minutes < 60) return `${Math.floor(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const remaining = Math.floor(minutes % 60)
  return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`
}

export function formatResumeReturnBanner(
  sessionAgeMinutes: number,
  estimatedTokens: number,
  formatAge: (minutes: number) => string = formatResumeReturnAge,
  formatTokenCount: (n: number) => string = formatTokens,
): string {
  return `This session is ${formatAge(sessionAgeMinutes)} old and ${formatTokenCount(estimatedTokens)} tokens.`
}

export function getResumeReturnWarning(): string {
  return 'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.'
}

/**
 * Official CBp pure body — evaluate whether to offer resume-return.
 * @param estimateTokens injected so callers can use tokenCountWithEstimation without circular deps.
 * @param nowMs injectable clock for tests.
 */
export function evaluateResumeReturnOffer(
  messages: readonly ResumeReturnMessage[],
  estimateTokens: (msgs: readonly ResumeReturnMessage[]) => number,
  opts: {
    env?: NodeJS.ProcessEnv
    gbEnabled?: boolean
    resumeReturnDismissed?: boolean
    nowMs?: number
  } = {},
): ResumeReturnOffer | null {
  const gbEnabled =
    opts.gbEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_gleaming_fair', false)
  if (!gbEnabled) return null

  const dismissed =
    opts.resumeReturnDismissed ??
    Boolean(getGlobalConfig().resumeReturnDismissed)
  if (dismissed) return null

  const env = opts.env ?? process.env
  const thresholdMinutes = getResumeThresholdMinutes(env)
  const tokenThreshold = getResumeTokenThreshold(env)
  const now = opts.nowMs ?? Date.now()
  const freshnessCutoff = now - RESUME_FRESHNESS_MS

  // findLast user/assistant message older than 60s
  let lastTs: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type !== 'user' && m.type !== 'assistant') continue
    if (!m.timestamp) continue
    const parsed = Date.parse(m.timestamp)
    if (Number.isNaN(parsed)) continue
    if (parsed < freshnessCutoff) {
      lastTs = m.timestamp
      break
    }
  }
  if (!lastTs) return null

  const sessionAgeMinutes = (now - Date.parse(lastTs)) / 60_000
  if (sessionAgeMinutes < thresholdMinutes) return null

  const estimatedTokens = estimateTokens(messages)
  if (estimatedTokens < tokenThreshold) return null

  return { sessionAgeMinutes, estimatedTokens }
}
