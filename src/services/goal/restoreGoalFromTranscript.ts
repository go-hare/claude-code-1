/**
 * densable 2.1.239 #49 — restore AppState.activeGoal on /resume picker + print.
 *
 * SEA:
 *   nuy = findGoalToRestore
 *   ueu = restoreGoalFromTranscript
 *   OMo calls ueu after fileHistory (print/SDK after S1; REPL picker after S1)
 *   wro = gates (hooks_gate / trust_gate). Official `!jn() && !Km()`:
 *     jn = !isInteractive; Km auto-accept (riv) is not ported — trust is
 *     getSessionTrustAccepted only.
 *   be("goal_set", code, {origin:"restored"}) → tengu_feature_sad
 *   HFe(goal, "resume_swap") → tengu_goal_cleared
 *   kx() = totalOutputTokens
 *
 * Do not walk JSONL `type:"goal"` (that's hydrateGoalFromTranscript).
 * Do not invent queuedGoalOrigin, Km/riv, or a CLI --continue OMo (official
 * interactive launch has no OMo; only picker + print).
 */
import {
  getIsInteractive,
  getSessionId,
  getSessionTrustAccepted,
  getTotalOutputTokens,
} from '../../bootstrap/state.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../analytics/index.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import { addSessionHook } from '../../utils/hooks/sessionHooks.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from '../../utils/hooks/hooksConfigSnapshot.js'

export type ActiveGoal = NonNullable<AppState['activeGoal']>

type SetAppState = (updater: (prev: AppState) => AppState) => void

/** densable nuy — last goal_status; met/failed abort the whole restore. */
export function findGoalToRestore(
  messages: readonly Message[] | undefined | null,
): string | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const attachment = msg?.type === 'attachment' ? msg.attachment : undefined
    if (attachment?.type !== 'goal_status') {
      continue
    }
    if (attachment.met || attachment.failed) return null
    const condition = attachment.condition
    return typeof condition === 'string' && condition.length > 0
      ? condition
      : null
  }
  return null
}

/** densable wro — no Km()/riv auto-trust. */
export function getGoalRestoreGate(): { message: string; code: string } | null {
  if (
    shouldDisableAllHooksIncludingManaged() ||
    shouldAllowManagedHooksOnly()
  ) {
    return {
      message:
        "/goal can't run while hooks are disabled (disableAllHooks or allowManagedHooksOnly is set in settings or by policy).",
      code: 'hooks_gate',
    }
  }
  // Official: if (!jn() && !Km()) — interactive and not trusted.
  if (getIsInteractive() && !getSessionTrustAccepted()) {
    return {
      message:
        '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.',
      code: 'trust_gate',
    }
  }
  return null
}

function logGoalResumeSwap(goal: ActiveGoal): void {
  logEvent('tengu_goal_cleared', {
    reason:
      'resume_swap' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    iterations: goal.iterations,
    durationMs: Date.now() - goal.setAt,
    origin:
      goal.origin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

function cancelIdleTimer(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  ;(
    require('./goalIdleCheckin.js') as typeof import('./goalIdleCheckin.js')
  ).cancelPendingGoalIdleCheckin()
  /* eslint-enable @typescript-eslint/no-require-imports */
}

/** densable ueu */
export function restoreGoalFromTranscript(
  messages: readonly Message[] | undefined,
  setAppState: SetAppState,
): void {
  const condition = findGoalToRestore(messages)
  const gate = condition !== null ? getGoalRestoreGate() : null
  if (gate !== null) {
    logEvent('tengu_feature_sad', {
      feature_name:
        'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        gate.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      origin:
        'restored' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  let previous: ActiveGoal | undefined
  if (condition === null || gate !== null) {
    setAppState(prev => {
      previous = prev.activeGoal
      return prev.activeGoal === undefined
        ? prev
        : { ...prev, activeGoal: undefined }
    })
    if (previous !== undefined) {
      cancelIdleTimer()
      logGoalResumeSwap(previous)
    }
    return
  }

  addSessionHook(setAppState, getSessionId(), 'Stop', '', {
    type: 'prompt',
    prompt: condition,
  })
  setAppState(prev => {
    previous = prev.activeGoal
    return {
      ...prev,
      activeGoal: {
        condition,
        iterations: 0,
        setAt: Date.now(),
        origin: 'restored',
        tokensAtStart: getTotalOutputTokens(),
      },
    }
  })
  if (previous !== undefined) {
    cancelIdleTimer()
    logGoalResumeSwap(previous)
  }
  logEvent('tengu_goal_restored_on_resume', {
    promptLength: condition.length,
  })
  logEvent('tengu_stop_hook_added', {
    promptLength: condition.length,
    via: 'goal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    origin:
      'restored' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
