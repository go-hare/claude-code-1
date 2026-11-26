import {
  memoryToggledOff,
  replaceMemoryToggledOff,
} from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isBgSession } from '../../utils/concurrentSessions.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getAgentId } from '../../utils/teammate.js'

let cloudPauseTold = false

export function resetCloudPauseToldForTesting(): void {
  cloudPauseTold = false
}

/**
 * Official 2.1.331 `xq()` — true for child/headless-spawned sessions where
 * memory cannot be unpaused mid-session.
 */
export function isSubordinateNonInteractiveSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION)) return true
  if (!env.CLAUDECODE) return false
  return (
    isEnvTruthy(env.CLAUDE_CODE_SKIP_PROMPT_HISTORY) ||
    (!process.stdin.isTTY && !process.stdout.isTTY)
  )
}

/**
 * Official 2.1.331 `TRt()` — user-started interactive sessions may resume
 * memory after pausing; bg, teammate, and child tool-call sessions may not.
 */
export function canResumeMemoryInSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isBgSession()) return false
  if (env.CLAUDE_CODE_SESSION_KIND !== undefined) return false
  if (getAgentId() !== undefined) return false
  return !isSubordinateNonInteractiveSession(env)
}

const CANNOT_RESUME_MESSAGE =
  'Memory stays paused · it cannot be resumed from a session a tool call started or from a background session. Resume it from a Claude Code session you started yourself, or start a new session.'

function resumeHint(): string {
  return canResumeMemoryInSession()
    ? 'Run /pause-memory again to resume.'
    : 'This session cannot turn memory back on; resume from a Claude Code session you started yourself, or start a new session.'
}

export const call: LocalCommandCall = async (_args, _context) => {
  const nextPaused = !memoryToggledOff()
  if (!nextPaused && !canResumeMemoryInSession()) {
    return { type: 'text', value: CANNOT_RESUME_MESSAGE }
  }

  replaceMemoryToggledOff(nextPaused)
  void cloudPauseTold

  logEvent('tengu_memory_toggled', {
    toggled_off: nextPaused,
  })

  if (nextPaused) {
    return {
      type: 'text',
      value: `Memory paused for this session · this conversation will not write or read new memories, and previously-loaded memory content should not be referenced.\n\n${resumeHint()}`,
    }
  }

  return {
    type: 'text',
    value:
      'Memory resumed · memory content may be referenced and new memories can be saved.',
  }
}
