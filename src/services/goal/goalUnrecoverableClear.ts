/**
 * densable 2.1.234 #42 — clear `/goal` on unrecoverable turn terminal.
 *
 * SEA:
 *   pXp(activeGoal, toolUseContext, querySource, terminal)
 *   LMv(terminal) → auth | billing | context_limit | model_unavailable | null
 *   MMv labels + errorCode for tengu_feature_bad / notice copy
 *   Gate: tengu_quartz_pipit (default true), main query family, no agentId, not aborted
 */
import { getSessionId } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../analytics/index.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { QuerySource } from '../../constants/querySource.js'
import { getQuerySourceFamily } from '../../utils/observerAgents.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getSdkOauthTokenRefreshCallback } from '../../utils/sdkOauthTokenRefresh.js'
import {
  getSessionHooks,
  removeSessionHook,
} from '../../utils/hooks/sessionHooks.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { createSystemMessage } from '../../utils/messages.js'
import { truncate } from '../../utils/truncate.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

const GOAL_CONDITION_NOTICE_MAX = 80

/** densable MMv */
const CLEAR_KIND_META = {
  auth: {
    label: 'authentication failed',
    errorCode: 'cleared_auth',
  },
  billing: {
    label: 'credit balance too low',
    errorCode: 'cleared_billing',
  },
  context_limit: {
    label: 'context limit reached',
    errorCode: 'cleared_context_limit',
  },
  model_unavailable: {
    label: 'model unavailable',
    errorCode: 'cleared_model_unavailable',
  },
} as const

export type GoalClearKind = keyof typeof CLEAR_KIND_META

/** densable terminal slice consumed by LMv */
export type GoalClearTerminal = {
  reason: string
  errorKind?: string | null
  isTransient?: boolean
  error?: unknown
}

export type ActiveGoalSnapshot = NonNullable<AppState['activeGoal']>

type ClearToolUseContext = {
  agentId?: string
  abortController: AbortController
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
}

/** densable b1 — desktop / local-agent entrypoints skip auth clear. */
function isDesktopOrLocalAgentEntrypoint(): boolean {
  const e = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    e === 'claude-desktop' || e === 'claude-desktop-3p' || e === 'local-agent'
  )
}

/**
 * densable LMv — map turn terminal → goal clear kind, or null to keep goal.
 */
export function classifyGoalClearKind(
  terminal: GoalClearTerminal | null | undefined,
): GoalClearKind | null {
  if (!terminal) return null
  switch (terminal.reason) {
    case 'image_error':
    case 'model_error':
    case 'malformed_tool_use_exhausted':
    case 'aborted_streaming':
    case 'aborted_tools':
    case 'stop_hook_prevented':
    case 'hook_stopped':
    case 'tool_deferred':
    case 'max_turns':
    case 'background_requested':
    case 'completed':
      return null
    case 'blocking_limit':
    case 'prompt_too_long':
    case 'rapid_refill_breaker':
      return 'context_limit'
    case 'api_error': {
      if (terminal.isTransient) return null
      switch (terminal.errorKind ?? undefined) {
        case 'overloaded':
        case 'server_error':
        case 'max_output_tokens':
        case 'rate_limit':
        case 'invalid_request':
        case 'unknown':
        case undefined:
          return null
        case 'authentication_failed':
        case 'oauth_org_not_allowed':
          // densable: CLAUDE_CODE_REMOTE || b1() || Eqt()!==null → keep goal
          if (
            isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
            isDesktopOrLocalAgentEntrypoint() ||
            getSdkOauthTokenRefreshCallback() !== null
          ) {
            return null
          }
          return 'auth'
        case 'billing_error':
          return 'billing'
        case 'model_not_found':
          return 'model_unavailable'
        default:
          return null
      }
    }
    default:
      return null
  }
}

/** densable K1a */
export function isTransientApiErrorMessage(msg: {
  apiErrorIsTransient?: boolean
  error?: string | null
}): boolean {
  return (
    msg.apiErrorIsTransient === true ||
    msg.error === 'overloaded' ||
    msg.error === 'server_error'
  )
}

/** densable TOe — coarsened reason: context_limit | api_error */
function logGoalCleared(goal: ActiveGoalSnapshot, kind: GoalClearKind): void {
  const reason = kind === 'context_limit' ? 'context_limit' : 'api_error'
  logEvent('tengu_goal_cleared', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    iterations: goal.iterations,
    durationMs: Date.now() - goal.setAt,
  })
}

/**
 * densable pXp — generator yielding active_goal clear + sentinel + warning.
 * Call after a main-thread turn terminal is known.
 */
export async function* clearGoalOnUnrecoverableError(
  goal: ActiveGoalSnapshot | undefined,
  toolUseContext: ClearToolUseContext,
  querySource: QuerySource | undefined,
  terminal: GoalClearTerminal | null | undefined,
): AsyncGenerator<
  | { type: 'active_goal'; value: undefined }
  | ReturnType<typeof createAttachmentMessage>
  | ReturnType<typeof createSystemMessage>,
  void,
  undefined
> {
  try {
    if (
      !getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_pipit', true) ||
      !goal ||
      toolUseContext.agentId ||
      toolUseContext.abortController.signal.aborted ||
      getQuerySourceFamily(querySource) !== 'main'
    ) {
      return
    }

    const kind = classifyGoalClearKind(terminal)
    if (kind === null) return

    const { label, errorCode } = CLEAR_KIND_META[kind]
    const sessionId = getSessionId()
    const appState = toolUseContext.getAppState()
    const hooks = getSessionHooks(appState, sessionId, 'Stop')
    const stopMatchers = hooks.get('Stop')
    if (stopMatchers) {
      for (const matcher of stopMatchers) {
        for (const hook of matcher.hooks) {
          if (hook.type === 'prompt' && hook.prompt === goal.condition) {
            removeSessionHook(
              toolUseContext.setAppState,
              sessionId,
              'Stop',
              hook,
            )
            break
          }
        }
      }
    }

    logGoalCleared(goal, kind)
    // densable pe("goal_met", errorCode) → tengu_feature_bad
    logEvent('tengu_feature_bad', {
      feature_name:
        'goal_met' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    yield { type: 'active_goal', value: undefined }
    yield createAttachmentMessage({
      type: 'goal_status',
      met: true,
      sentinel: true,
      condition: goal.condition,
    })
    const truncated = truncate(goal.condition, GOAL_CONDITION_NOTICE_MAX, true)
    yield createSystemMessage(
      `Goal cleared after an unrecoverable error (${label}): "${truncated}". Run /goal again to continue.`,
      'warning',
    )
  } catch (err) {
    logForDebugging(`[goal] unrecoverable clear failed: ${errorMessage(err)}`, {
      level: 'error',
    })
  }
}
