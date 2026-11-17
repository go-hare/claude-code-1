import { constants as bufferConstants } from 'buffer'
import { join as joinPath } from 'path'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { getFeatureValueWithSource } from 'src/services/analytics/growthbook.js'
import {
  getMainThreadAgentHooks,
  getMainThreadAgentType,
  getIsNonInteractiveSession,
  getPromptId,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import { checkHasTrustDialogAccepted } from '../config.js'
import { getCwd } from '../cwd.js'
import {
  convertEffortValueToLevel,
  modelSupportsEffort,
  pdSessionEffort,
  resolveHookStdinEffort,
  type EffortLevel,
  type EffortValue,
} from '../effort.js'
import { errorMessage } from '../errors.js'
import { isEvalConfined } from '../permissions/evalConfined.js'
import {
  getProjectTempDir,
  isScratchpadEnabled,
} from '../permissions/filesystem.js'
import { resolveSessionEndHooksTimeoutMs } from '../residualMsEnvGates.js'
import { getTranscriptPathForSession } from '../sessionPaths.js'
import {
  getHooksConfigFromSnapshot,
  shouldAllowManagedHooksOnly,
} from './hooksConfigSnapshot.js'
import type { AggregatedHookResult, HookBlockingError } from './hookTypes.js'

/** densable `ygo` — SessionEnd per-hook / bound floor. */
const SESSIONEND_HOOKS_TIMEOUT_FLOOR_MS = 1500
/** densable `ARo` — SessionEnd bound ceiling when env is unset. */
const SESSIONEND_HOOKS_TIMEOUT_CEILING_MS = 60_000

/**
 * densable `_go`. Per-hook SessionEnd timeout: env
 * CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS if a positive int, else 1500.
 * Not the overall AbortSignal bound — see getSessionEndHooksBoundMs.
 */
export function getSessionEndHookTimeoutMs(): number {
  return resolveSessionEndHooksTimeoutMs()
}

function sessionEndHooksTimeoutEnvMs(): number | undefined {
  const raw = process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * densable `Kfe` body. Env if set; else max(matcher hook.timeout*1000)
 * clamped to [1500, 60000].
 */
export function computeSessionEndHooksBoundMs(
  envMs: number | undefined,
  sessionEndMatchers: ReadonlyArray<{
    hooks: ReadonlyArray<{ timeout?: number }>
  }>,
): number {
  if (envMs !== undefined) {
    return envMs
  }
  let maxTimeoutMs = 0
  for (const matcher of sessionEndMatchers) {
    for (const hook of matcher.hooks) {
      if (hook.timeout && hook.timeout * 1000 > maxTimeoutMs) {
        maxTimeoutMs = hook.timeout * 1000
      }
    }
  }
  return Math.max(
    SESSIONEND_HOOKS_TIMEOUT_FLOOR_MS,
    Math.min(maxTimeoutMs, SESSIONEND_HOOKS_TIMEOUT_CEILING_MS),
  )
}

/**
 * densable `Kfe`. Overall SessionEnd AbortSignal bound.
 * Env if set; else max(SessionEnd matcher hook.timeout*1000) clamped to
 * [1500, 60000]. Do not pass this as timeoutMs — that is `_go`.
 */
export function getSessionEndHooksBoundMs(): number {
  const agentSessionEnd = shouldAllowManagedHooksOnly()
    ? []
    : (getMainThreadAgentHooks()?.SessionEnd ?? [])
  return computeSessionEndHooksBoundMs(sessionEndHooksTimeoutEnvMs(), [
    ...(getHooksConfigFromSnapshot()?.SessionEnd ?? []),
    ...agentSessionEnd,
  ])
}

/**
 * Checks if a hook should be skipped due to lack of workspace trust.
 *
 * ALL hooks require workspace trust because they execute arbitrary commands from
 * .claude/settings.json. This is a defense-in-depth security measure.
 *
 * Context: Hooks are captured via captureHooksConfigSnapshot() before the trust
 * dialog is shown. While most hooks won't execute until after trust is established
 * through normal program flow, enforcing trust for ALL hooks prevents:
 * - Future bugs where a hook might accidentally execute before trust
 * - Any codepath that might trigger hooks before trust dialog
 * - Security issues from hook execution in untrusted workspaces
 *
 * Historical vulnerabilities that prompted this check:
 * - SessionEnd hooks executing when user declines trust dialog
 * - SubagentStop hooks executing when subagent completes before trust
 *
 * @returns true if hook should be skipped, false if it should execute
 */
export function shouldSkipHookDueToTrust(): boolean {
  // In non-interactive mode (SDK), trust is implicit - always execute
  const isInteractive = !getIsNonInteractiveSession()
  if (!isInteractive) {
    return false
  }

  // In interactive mode, ALL hooks require trust
  const hasTrust = checkHasTrustDialogAccepted()
  return !hasTrust
}

/**
 * Format a list of blocking errors from a PreTool hook's configured commands.
 * @param hookName The name of the hook (e.g., 'PreToolUse:Write', 'PreToolUse:Edit', 'PreToolUse:Bash')
 * @param blockingErrors Array of blocking errors from hooks
 * @returns Formatted blocking message
 */
export function getPreToolHookBlockingMessage(
  hookName: string,
  blockingError: HookBlockingError,
): string {
  return `${hookName} hook error: ${blockingError.blockingError}`
}

/**
 * Format a list of blocking errors from a Stop hook's configured commands.
 * @param blockingErrors Array of blocking errors from hooks
 * @returns Formatted message to give feedback to the model
 */
export function getStopHookMessage(blockingError: HookBlockingError): string {
  return `Stop hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TeammateIdle hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTeammateIdleHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TeammateIdle hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TaskCreated hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTaskCreatedHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TaskCreated hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TaskCompleted hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTaskCompletedHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TaskCompleted hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a list of blocking errors from a UserPromptSubmit hook's configured commands.
 * @param blockingErrors Array of blocking errors from hooks
 * @returns Formatted blocking message
 */
export function getUserPromptSubmitHookBlockingMessage(
  blockingError: HookBlockingError,
): string {
  return `UserPromptSubmit operation blocked by hook:\n${blockingError.blockingError}`
}

/**
 * densable Ze — format a blocking error from a UserPromptExpansion hook.
 */
export function getUserPromptExpansionHookBlockingMessage(
  blockingError: HookBlockingError,
): string {
  return `UserPromptExpansion operation blocked by hook:\n${blockingError.blockingError}`
}

function hasUsedNonDefaultGrowthBookHost(): boolean {
  if (isEvalConfined()) return true
  for (const raw of [
    process.env.CLAUDE_CODE_GB_BASE_URL,
    process.env.ANTHROPIC_BASE_URL,
  ]) {
    if (!raw) continue
    try {
      if (new URL(raw).hostname.toLowerCase() !== 'api.anthropic.com') {
        return true
      }
    } catch {
      return true
    }
  }
  return false
}

export function shouldFailClosedHookInput(hookEvent: HookEvent): boolean {
  if (hookEvent !== 'PreToolUse' && hookEvent !== 'PermissionRequest')
    return false
  try {
    const { value, source } = getFeatureValueWithSource(
      'tengu_quiet_hopcroft',
      false,
    )
    return !(
      value === true &&
      source === 'payload' &&
      !hasUsedNonDefaultGrowthBookHost()
    )
  } catch {
    return true
  }
}

/** densable `mct` @187788000 */
export function formatHookMatchBlockedMessage(
  hookEvent: HookEvent,
  err?: unknown,
): string {
  return `Blocked: Claude Code could not work out which hooks apply to this call. Retry with a different input. If every call is blocked, check the ${hookEvent} hooks in /hooks or in your settings.${err === undefined ? '' : ` (${errorMessage(err)})`}`
}

/** densable `aee` @187786800 */
export function buildFailClosedHookMatchResult(
  hookEvent: HookEvent,
  hookName: string,
  message: string,
): AggregatedHookResult | undefined {
  if (!shouldFailClosedHookInput(hookEvent)) return undefined
  return {
    blockingError: { blockingError: message, command: hookName },
    ...(hookEvent === 'PermissionRequest' && {
      permissionRequestResult: { behavior: 'deny', message },
    }),
  }
}

/** densable `Gqn` @189484700 */
export function shouldDowngradeMissingHookScriptExit2(opts: {
  hookEvent: HookEvent
  stdout: string
  stderr: string
  pluginId?: string
  stdioIncomplete?: boolean
  stdioClosedWithoutEnd?: boolean
}): boolean {
  if (opts.stdioIncomplete === true || opts.stdioClosedWithoutEnd === true) {
    return false
  }
  return (
    (opts.hookEvent === 'Stop' ||
      opts.hookEvent === 'SubagentStop' ||
      opts.hookEvent === 'TaskCompleted' ||
      opts.hookEvent === 'TeammateIdle' ||
      (Boolean(opts.pluginId) && opts.hookEvent === 'UserPromptSubmit')) &&
    !opts.stdout.trim() &&
    /no such file|can't open/i.test(opts.stderr)
  )
}

export function validateHookInputSize(
  hookEvent: HookEvent,
  json: string,
): void {
  if (
    json.length > Math.floor(bufferConstants.MAX_STRING_LENGTH / 2) &&
    shouldFailClosedHookInput(hookEvent)
  ) {
    throw new RangeError('Hook input is over the size limit')
  }
}
