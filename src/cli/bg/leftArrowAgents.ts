/**
 * Official Sj4 densable — left-arrow open AgentsView from REPL.
 *
 * Flow (2.1.153):
 *   Vy6/p1t seed → A8q write job dir → ky6 fire-and-forget resume/fork spawn
 *   → mount FleetView with CLAUDE_AGENTS_SELECT = short
 *
 * Local mapping:
 *   seedForLeftArrow → writeA8qJobState → submitDispatch(resume/fork)
 *   → renderAgentView({ restoreSessionId: short })
 */

import { randomUUID } from 'crypto'
import { rm } from 'fs/promises'
import {
  deriveBackgroundSeed,
  seedForLeftArrow,
  type BackgroundSeedMessage,
} from './helpers.js'
import { writeA8qJobState } from '../../daemon/jobState.js'
import {
  getOriginalCwd,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js'
import { asSessionId } from '../../types/ids.js'

export type LeftArrowOpenResult =
  | { ok: true; short: string; sessionId: string }
  | { ok: false; error: string }

/**
 * Official Sj4 body (without process.exit). Returns short/sessionId for FleetView.
 * Spawn is fire-and-forget like official ky6().then(...).
 */
export async function openAgentsViaLeftArrow(
  messages: readonly BackgroundSeedMessage[],
  options?: {
    /** Official Sj4 `z` — haiku/AI title when seed has no name. */
    haikuTitle?: string | null
    sessionTitle?: string | null
    agentColor?: string
  },
): Promise<LeftArrowOpenResult> {
  let resumeSessionId: string | undefined
  try {
    resumeSessionId = getSessionId()
  } catch {
    resumeSessionId = undefined
  }

  const sessionTitle =
    options?.sessionTitle ??
    (resumeSessionId
      ? getCurrentSessionTitle(asSessionId(resumeSessionId))
      : undefined)

  // Official Sj4: Vy6 non-null + persistence disabled → refuse.
  // Empty conversation (Vy6 null) still opens agents.
  if (
    isSessionPersistenceDisabled() &&
    deriveBackgroundSeed(messages, '', {
      sessionTitle,
      sessionAiTitle: options?.haikuTitle,
      agentColor: options?.agentColor,
    }) !== null
  ) {
    return {
      ok: false,
      error:
        'Cannot open agents — session persistence is disabled, so this conversation cannot be backgrounded.',
    }
  }

  const seed = seedForLeftArrow(messages, {
    sessionTitle,
    haikuTitle: options?.haikuTitle,
    agentColor: options?.agentColor,
  })

  // Official A8q: always allocate a fresh job session id.
  const providedSessionId = randomUUID()
  const cwd = getOriginalCwd()

  let short: string
  let jobDir: string
  try {
    ;({ short, jobDir } = writeA8qJobState({
      sessionId: providedSessionId,
      cwd,
      intent: seed.intent ?? '',
      name: seed.name,
      nameSource: seed.nameSource,
      detail: seed.detail,
      color: seed.color,
    }))
  } catch (e) {
    return {
      ok: false,
      error: `Cannot open agents — ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Official ky6 fire-and-forget; on failure rm job dir.
  if (resumeSessionId) {
    void (async () => {
      try {
        const { ensureDaemonRunning } = await import(
          '../../daemon/installPrompt.js'
        )
        const daemon = await ensureDaemonRunning({
          forceTransient: true,
          mayPromptInstall: false,
        })
        if (!daemon.ok) {
          await rm(jobDir, { recursive: true, force: true }).catch(() => {})
          return
        }
        const { submitDispatch } = await import('../../daemon/bgManager.js')
        await submitDispatch({
          intent: seed.intent ?? '',
          name: seed.name,
          cwd,
          source: 'left_arrow',
          resumeSessionId,
          forkSession: true,
          providedSessionId,
        })
      } catch {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {})
      }
    })()
  }

  return { ok: true, short, sessionId: providedSessionId }
}
