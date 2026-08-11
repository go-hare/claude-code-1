import { getSessionId, getMainThreadAgentType } from '../bootstrap/state.js'
import { clearCommandsCache } from '../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { HookResultMessage } from '../types/message.js'
import { createAttachmentMessage, resetSentSkillNames } from './attachments.js'
import { logContextWindowEnforcementStartupNotices } from './context.js'
import { logForDebugging } from './debug.js'
import { withDiagnosticsTiming } from './diagLogs.js'
import { isBareMode } from './envUtils.js'
import { updateWatchPaths } from './hooks/fileChangedWatcher.js'
import { shouldAllowManagedHooksOnly } from './hooks/hooksConfigSnapshot.js'
import { executeSessionStartHooks, executeSetupHooks } from './hooks.js'
import { logError } from './log.js'
import { loadPluginHooks } from './plugins/loadPluginHooks.js'
import { cacheSessionTitle, getCurrentSessionTitle } from './sessionStorage.js'
import { sanitizeSessionTitle } from './sessionTitleSanitize.js'

type SessionStartHooksOptions = {
  sessionId?: string
  agentType?: string
  model?: string
  forceSyncExecution?: boolean
}

// Set by processSessionStartHooks when a hook emits initialUserMessage;
// consumed once by takeInitialUserMessage. This side channel avoids changing
// the Promise<HookResultMessage[]> return type that main.tsx and print.ts
// both already await on (sessionStartHooksPromise is kicked in main.tsx and
// joined later — rippling a structural return-type change through that
// handoff would touch five callsites for what is a print-mode-only value).
let pendingInitialUserMessage: string | undefined

// Official 2.1.x: SessionStart sessionTitle is cached here for startup/resume
// and applied after the session is ready (takeSessionStartTitle).
let pendingSessionTitle: string | undefined

export function takeInitialUserMessage(): string | undefined {
  const v = pendingInitialUserMessage
  pendingInitialUserMessage = undefined
  return v
}

export function takeSessionStartTitle(): string | undefined {
  const v = pendingSessionTitle
  pendingSessionTitle = undefined
  return v
}

/**
 * Apply a SessionStart/UserPromptSubmit sessionTitle to the current session.
 * densable 2.1.221: hook titles go through uge (same FXe funnel as /rename).
 * No-ops when empty, unchanged, or title already matches.
 */
export function applyHookSessionTitle(title: string | undefined): void {
  if (!title) return
  // densable U3t/FXe: sanitize before cache (Cc/Cf → space, C0/C1 strip, OMb=200)
  const sanitized = sanitizeSessionTitle(title)
  if (!sanitized) return
  const sessionId = getSessionId()
  const existing = getCurrentSessionTitle(sessionId)
  if (existing === sanitized) return
  // densable also re-vhn(existing) for equality; uge is a strict superset for
  // already-clean titles, so direct compare is enough once both paths sanitize.
  logForDebugging(`Hook sessionTitle applied (${[...sanitized].length} chars)`)
  cacheSessionTitle(sanitized)
}

function reloadSkillsFromSessionStartHook(): void {
  // Official: YN() + Zee() + sV.emit() equivalent — clear skill/command caches
  // so skills installed by SessionStart hooks are visible this session.
  clearCommandsCache()
  resetSentSkillNames()
  logEvent('hook_session_start_reload_skills', {
    source:
      'session_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  logForDebugging('SessionStart hook requested reloadSkills — caches cleared')
}

// Note to CLAUDE: do not add ANY "warmup" logic. It is **CRITICAL** that you do not add extra work on startup.
export async function processSessionStartHooks(
  // densable 2.1.214 #47: SessionStart source includes "fork" (branch / --fork-session)
  source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork',
  {
    sessionId,
    agentType,
    model,
    forceSyncExecution,
  }: SessionStartHooksOptions = {},
): Promise<HookResultMessage[]> {
  // --bare skips all hooks. executeHooks already early-returns under --bare
  // (hooks.ts:1861), but this skips the loadPluginHooks() await below too —
  // no point loading plugin hooks that'll never run.
  if (isBareMode()) {
    return []
  }
  // densable 2.1.223 #16/#17 — startup notices for DISABLE_1M / unknown model window
  if (model) {
    logContextWindowEnforcementStartupNotices(model)
  }
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []
  const allWatchPaths: string[] = []
  let shouldReloadSkills = false
  let sessionTitleFromHooks: string | undefined

  // Skip loading plugin hooks if restricted to managed hooks only
  // Plugin hooks are untrusted external code that should be blocked by policy
  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    // Ensure plugin hooks are loaded before executing SessionStart hooks.
    // loadPluginHooks() may be called early during startup (fire-and-forget, non-blocking)
    // to pre-load hooks, but we must guarantee hooks are registered before executing them.
    // This function is memoized, so if hooks are already loaded, this returns immediately
    // with negligible overhead (just a cache lookup).
    try {
      await withDiagnosticsTiming('load_plugin_hooks', () => loadPluginHooks())
    } catch (error) {
      // Log error but don't crash - continue with session start without plugin hooks
      /* eslint-disable no-restricted-syntax -- both branches wrap with context, not a toError case */
      const enhancedError =
        error instanceof Error
          ? new Error(
              `Failed to load plugin hooks during ${source}: ${error.message}`,
            )
          : new Error(
              `Failed to load plugin hooks during ${source}: ${String(error)}`,
            )
      /* eslint-enable no-restricted-syntax */

      if (error instanceof Error && error.stack) {
        enhancedError.stack = error.stack
      }

      logError(enhancedError)

      // Provide specific guidance based on error type
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      let userGuidance = ''

      if (
        errorMessage.includes('Failed to clone') ||
        errorMessage.includes('network') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND')
      ) {
        userGuidance =
          'This appears to be a network issue. Check your internet connection and try again.'
      } else if (
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('EACCES') ||
        errorMessage.includes('EPERM')
      ) {
        userGuidance =
          'This appears to be a permissions issue. Check file permissions on ~/.claude/plugins/'
      } else if (
        errorMessage.includes('Invalid') ||
        errorMessage.includes('parse') ||
        errorMessage.includes('JSON') ||
        errorMessage.includes('schema')
      ) {
        userGuidance =
          'This appears to be a configuration issue. Check your plugin settings in .claude/settings.json'
      } else {
        userGuidance =
          'Please fix the plugin configuration or remove problematic plugins from your settings.'
      }

      logForDebugging(
        `Warning: Failed to load plugin hooks. SessionStart hooks from plugins will not execute. ` +
          `Error: ${errorMessage}. ${userGuidance}`,
        { level: 'warn' },
      )

      // Continue execution - plugin hooks won't be available, but project-level hooks
      // from .claude/settings.json (loaded via captureHooksConfigSnapshot) will still work
    }
  }

  // Execute SessionStart hooks, ignoring blocking errors
  // Use the provided agentType or fall back to the one stored in bootstrap state
  const resolvedAgentType = agentType ?? getMainThreadAgentType()
  for await (const hookResult of executeSessionStartHooks(
    source,
    sessionId,
    resolvedAgentType,
    model,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
    if (hookResult.initialUserMessage) {
      pendingInitialUserMessage = hookResult.initialUserMessage
    }
    if (hookResult.sessionTitle) {
      sessionTitleFromHooks = hookResult.sessionTitle
    }
    if (hookResult.reloadSkills) {
      shouldReloadSkills = true
    }
    if (hookResult.watchPaths && hookResult.watchPaths.length > 0) {
      allWatchPaths.push(...hookResult.watchPaths)
    }
  }

  // Official 2.1.x: reload skills before applying title so skills installed
  // by this SessionStart run are available in the same session.
  if (shouldReloadSkills) {
    reloadSkillsFromSessionStartHook()
  }

  // densable: Wos = e==="startup"||e==="resume"||e==="fork" ? c : void 0
  // (title cache for startup/resume/fork; not clear/compact).
  if (
    (source === 'startup' || source === 'resume' || source === 'fork') &&
    sessionTitleFromHooks
  ) {
    pendingSessionTitle = sessionTitleFromHooks
    // Also apply immediately so interactive UI can show it without waiting
    // for takeSessionStartTitle consumers.
    applyHookSessionTitle(sessionTitleFromHooks)
  }

  if (allWatchPaths.length > 0) {
    updateWatchPaths(allWatchPaths)
  }

  // If hooks provided additional context, add it as a message
  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'SessionStart',
      toolUseID: 'SessionStart',
      hookEvent: 'SessionStart',
    })
    hookMessages.push(contextMessage)
  }

  return hookMessages
}

export async function processSetupHooks(
  trigger: 'init' | 'maintenance',
  { forceSyncExecution }: { forceSyncExecution?: boolean } = {},
): Promise<HookResultMessage[]> {
  // Same rationale as processSessionStartHooks above.
  if (isBareMode()) {
    return []
  }
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []

  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    try {
      await loadPluginHooks()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(
        `Warning: Failed to load plugin hooks. Setup hooks from plugins will not execute. Error: ${errorMessage}`,
        { level: 'warn' },
      )
    }
  }

  for await (const hookResult of executeSetupHooks(
    trigger,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
  }

  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'Setup',
      toolUseID: 'Setup',
      hookEvent: 'Setup',
    })
    hookMessages.push(contextMessage)
  }

  return hookMessages
}
