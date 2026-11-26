import { getSessionId } from '../../bootstrap/state.js'
import {
  isTerminalState,
  readBgJobState,
  writeBgJobState,
} from '../../daemon/jobState.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  isBgSession,
  registryJobIdFromEnv,
} from '../../utils/concurrentSessions.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'

export type ActiveAttachHandle = {
  close: () => void
}

const stopCoreHostSlot = new HostSlot<{
  activeAttachHandle: ActiveAttachHandle | null
}>(() => ({
  activeAttachHandle: null,
}))

/** Official 2.1.331 `Fdn()` — active attached background session handle, or null. */
export function getActiveAttachHandle(): ActiveAttachHandle | null {
  return stopCoreHostSlot.of(getBootstrapSessionHost()).activeAttachHandle
}

export function setActiveAttachHandle(handle: ActiveAttachHandle | null): void {
  stopCoreHostSlot.of(getBootstrapSessionHost()).activeAttachHandle = handle
}

/**
 * Official 2.1.331 `Y7o(source, finalMessage)` — transition current background
 * job state to `stopped` (preserving transcript & worktree) and exit cleanly.
 */
export async function stopBackgroundSession(
  source: 'stop_command' | 'bridge',
  finalMessage?: string,
): Promise<void> {
  let jobSessionId = ''
  try {
    jobSessionId = getSessionId()
  } catch {
    jobSessionId = ''
  }

  logEvent('tengu_bg_agent_action', {
    action:
      'stop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    jobSessionId:
      jobSessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const jobShort = registryJobIdFromEnv(process.env.CLAUDE_JOB_DIR)
  if (isBgSession() && jobShort) {
    const now = new Date().toISOString()
    try {
      const current = readBgJobState(jobShort)
      if (current && !isTerminalState(current)) {
        writeBgJobState(jobShort, {
          ...current,
          state: 'stopped',
          detail: 'stopped from session',
          tempo: 'idle',
          updatedAt: now,
          firstTerminalAt: current.firstTerminalAt ?? now,
        })
      }
    } catch {
      // best-effort state update before shutdown
    }
  }

  await gracefulShutdown(0, 'prompt_input_exit', {
    suppressResumeHint: true,
    finalMessage: finalMessage ?? 'Session stopped.',
  })
}
