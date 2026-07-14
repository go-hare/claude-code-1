/**
 * Official CLAUDE_CODE_RESUME_FROM_SESSION hydrate densable (print resume path).
 *
 * Official gate `xit()` is ant/remote feature-gated and currently densable-false
 * in external builds; we still implement the hydrate body so consumers can call
 * when sdkUrl/url resume leaves an empty conversation and env is set.
 *
 * Flow: prepareApiRequest → teleportFromSessionsAPI → deserializeMessages.
 */

import type { Message } from 'src/types/message.js'
import { getResumeFromSessionId } from './residualMoreEnvGates.js'

export type ResumeFromSessionHydrateDeps = {
  prepareApiRequest: () => Promise<{
    accessToken: string
    orgUUID: string
  }>
  teleportFromSessionsAPI: (
    sessionId: string,
    orgUUID: string,
    accessToken: string,
  ) => Promise<{ log: Message[] }>
  deserializeMessages: (log: Message[]) => Message[]
  log?: (msg: string) => void
  errorMessage?: (err: unknown) => string
}

/**
 * Official xit densable — ant builds gate via feature flag; this reverse-
 * engineered build enables the hydrate path when:
 * - forceEnabled (tests), or
 * - CLAUDE_CODE_ENABLE_RESUME_FROM_SESSION is truthy, or
 * - CLAUDE_CODE_RESUME_FROM_SESSION is set (source session id present).
 * Env alone is enough for functional residual alignment (official still
 * requires ant xit; we densify so empty-url/sdkUrl resume can hydrate).
 */
export function isResumeFromSessionHydrateFeatureEnabled(opts?: {
  forceEnabled?: boolean
  env?: NodeJS.ProcessEnv
}): boolean {
  if (opts?.forceEnabled) return true
  const env = opts?.env ?? process.env
  if (env.CLAUDE_CODE_ENABLE_RESUME_FROM_SESSION === '1') return true
  if (env.CLAUDE_CODE_ENABLE_RESUME_FROM_SESSION === 'true') return true
  // Presence of source session id implies opt-in for this build.
  return Boolean(getResumeFromSessionId(env))
}

/**
 * Whether the empty-resume path should attempt source-session hydrate.
 * Official: xit() && CLAUDE_CODE_RESUME_FROM_SESSION && (isUrl || sdkUrl).
 * Portable: feature densable (env/force) && session id && (isUrl || sdkUrl).
 */
export function shouldAttemptResumeFromSessionHydrate(input: {
  isUrl?: boolean
  sdkUrl?: string | undefined
  env?: NodeJS.ProcessEnv
  forceFeature?: boolean
}): { attempt: false } | { attempt: true; sourceSessionId: string } {
  if (
    !isResumeFromSessionHydrateFeatureEnabled({
      forceEnabled: input.forceFeature,
      env: input.env,
    })
  ) {
    return { attempt: false }
  }
  if (!(input.isUrl || input.sdkUrl)) return { attempt: false }
  const sourceSessionId = getResumeFromSessionId(input.env)
  if (!sourceSessionId) return { attempt: false }
  return { attempt: true, sourceSessionId }
}

/**
 * Official resume-from hydrate body densable.
 * Returns messages on success, [] on failure (logged).
 */
export async function hydrateMessagesFromResumeSourceSession(
  sourceSessionId: string,
  deps: ResumeFromSessionHydrateDeps,
): Promise<Message[]> {
  const log = deps.log
  const errMsg =
    deps.errorMessage ??
    ((err: unknown) => (err instanceof Error ? err.message : String(err)))
  try {
    log?.(`[resume-from] Hydrating from source session ${sourceSessionId}`)
    const { accessToken, orgUUID } = await deps.prepareApiRequest()
    const { log: rawLog } = await deps.teleportFromSessionsAPI(
      sourceSessionId,
      orgUUID,
      accessToken,
    )
    const messages = deps.deserializeMessages(rawLog)
    log?.(
      `[resume-from] Loaded ${messages.length} messages from ${sourceSessionId}`,
    )
    return messages
  } catch (err) {
    log?.(
      `[resume-from] Failed to hydrate from ${sourceSessionId}: ${errMsg(err)}`,
    )
    return []
  }
}
