import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import {
  applyAddHookToMap,
  applyRemoveFunctionHookFromMap,
  applyRemoveHookFromMap,
  getSessionHooksRegistry,
  readFunctionHooksFromStore,
  readHookCallbackFromStore,
  readHooksFromStore,
} from 'src/state/sessionHooksRegistry.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from '../debug.js'
import type { AggregatedHookResult } from '../hooks.js'
import type { HookCommand } from '../settings/types.js'
import { isHookEqual } from './hooksSettings.js'

export type OnHookSuccess = (
  hook: HookCommand | FunctionHook,
  result: AggregatedHookResult,
) => void

/** Function hook callback - returns true if check passes, false to block */
export type FunctionHookCallback = (
  messages: Message[],
  signal?: AbortSignal,
) => boolean | Promise<boolean>

/**
 * Function hook type with callback embedded.
 * Session-scoped only, cannot be persisted to settings.json.
 */
export type FunctionHook = {
  type: 'function'
  id?: string // Optional unique ID for removal
  timeout?: number
  callback: FunctionHookCallback
  errorMessage: string
  statusMessage?: string
}

export type SessionHookMatcher = {
  matcher: string
  skillRoot?: string
  hooks: Array<{
    hook: HookCommand | FunctionHook
    onHookSuccess?: OnHookSuccess
  }>
}

export type SessionStore = {
  hooks: {
    [event in HookEvent]?: SessionHookMatcher[]
  }
}

/**
 * Map (not Record) so .set/.delete don't change the container's identity.
 * Mutator functions mutate the Map and return prev unchanged, letting
 * store.ts's Object.is(next, prev) check short-circuit and skip listener
 * notification. Session hooks are ephemeral per-agent runtime callbacks,
 * never reactively read (only getAppState() snapshots in the query loop).
 * Same pattern as agentControllers on LocalWorkflowTaskState.
 *
 * This matters under high-concurrency workflows: parallel() with N
 * schema-mode agents fires N addFunctionHook calls in one synchronous
 * tick. With a Record + spread, each call cost O(N) to copy the growing
 * map (O(N²) total) plus fired all ~30 store listeners. With Map: .set()
 * is O(1), return prev means zero listener fires.
 */
export type SessionHooksState = Map<string, SessionStore>

/**
 * Add a command or prompt hook to the session.
 * Session hooks are temporary, in-memory only, and cleared when session ends.
 */
export function addSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  addHookToSession(
    setAppState,
    sessionId,
    event,
    matcher,
    hook,
    onHookSuccess,
    skillRoot,
  )
}

/**
 * Add a function hook to the session.
 * Function hooks execute TypeScript callbacks in-memory for validation.
 * @returns The hook ID (for removal)
 */
export function addFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  callback: FunctionHookCallback,
  errorMessage: string,
  options?: {
    timeout?: number
    id?: string
  },
): string {
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    const id = registry.addFunctionHook(
      sessionId,
      event,
      matcher,
      callback,
      errorMessage,
      options,
    )
    logForDebugging(
      `Added session hook for event ${event} in session ${sessionId}`,
    )
    return id
  }
  const id = options?.id || `function-hook-${Date.now()}-${Math.random()}`
  const hook: FunctionHook = {
    type: 'function',
    id,
    timeout: options?.timeout || 5000,
    callback,
    errorMessage,
  }
  addHookToSession(setAppState, sessionId, event, matcher, hook)
  return id
}

/**
 * Remove a function hook by ID from the session.
 */
export function removeFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hookId: string,
): void {
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    registry.removeFunctionHook(sessionId, event, hookId)
  } else {
    setAppState(prev => {
      const changed = applyRemoveFunctionHookFromMap(
        prev.sessionHooks,
        sessionId,
        event,
        hookId,
      )
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      if (bound) {
        const boundChanged = applyRemoveFunctionHookFromMap(
          bound.sessions,
          sessionId,
          event,
          hookId,
        )
        if (changed || boundChanged) {
          bound.changed.emit()
        }
      }
      return prev
    })
  }

  logForDebugging(
    `Removed function hook ${hookId} for event ${event} in session ${sessionId}`,
  )
}

/**
 * Internal helper to add a hook to session state
 */
function addHookToSession(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    registry.addHook(sessionId, event, matcher, hook, onHookSuccess, skillRoot)
  } else {
    setAppState(prev => {
      applyAddHookToMap(
        prev.sessionHooks,
        sessionId,
        event,
        matcher,
        hook,
        onHookSuccess,
        skillRoot,
      )
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      if (bound) {
        applyAddHookToMap(
          bound.sessions,
          sessionId,
          event,
          matcher,
          hook,
          onHookSuccess,
          skillRoot,
        )
        bound.changed.emit()
      }
      return prev
    })
  }

  logForDebugging(
    `Added session hook for event ${event} in session ${sessionId}`,
  )
}

function applyRemoveHookWithScope(
  sessions: SessionHooksState,
  sessionId: string,
  event: HookEvent,
  hook: HookCommand,
  options?: { skillRoot?: string; matchByIdentity?: boolean },
): boolean {
  const store = sessions.get(sessionId)
  if (!store) {
    return false
  }
  const eventMatchers = store.hooks[event] || []
  const updatedMatchers = eventMatchers
    .map(matcher => {
      if (options !== undefined && matcher.skillRoot !== options.skillRoot) {
        return matcher
      }
      const updatedHooks = matcher.hooks.filter(h =>
        options?.matchByIdentity ? h.hook !== hook : !isHookEqual(h.hook, hook),
      )
      return updatedHooks.length > 0
        ? { ...matcher, hooks: updatedHooks }
        : null
    })
    .filter((m): m is SessionHookMatcher => m !== null)

  const newHooks =
    updatedMatchers.length > 0
      ? { ...store.hooks, [event]: updatedMatchers }
      : { ...store.hooks }
  if (updatedMatchers.length === 0) {
    delete newHooks[event]
  }
  sessions.set(sessionId, { ...store, hooks: newHooks })
  return true
}

/**
 * Remove a specific hook from the session
 * @param setAppState The function to update the app state
 * @param sessionId The session ID
 * @param event The hook event
 * @param hook The hook command to remove
 * @param options Optional scope filter (e.g. skillRoot for skill-scoped once hooks)
 */
export function removeSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hook: HookCommand,
  options?: { skillRoot?: string; matchByIdentity?: boolean },
): void {
  const registry = getSessionHooksRegistry(setAppState)
  if (options !== undefined) {
    if (registry) {
      const changedReg = applyRemoveHookWithScope(
        registry.sessions,
        sessionId,
        event,
        hook,
        options,
      )
      if (changedReg) {
        registry.changed.emit()
      }
    }
    setAppState(prev => {
      const changed = applyRemoveHookWithScope(
        prev.sessionHooks,
        sessionId,
        event,
        hook,
        options,
      )
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      let boundChanged = false
      if (bound && bound !== registry) {
        boundChanged = applyRemoveHookWithScope(
          bound.sessions,
          sessionId,
          event,
          hook,
          options,
        )
      }
      if (changed || boundChanged) {
        bound?.changed.emit()
      }
      return prev
    })
  } else if (registry) {
    registry.removeHook(sessionId, event, hook)
  } else {
    setAppState(prev => {
      const changed = applyRemoveHookFromMap(
        prev.sessionHooks,
        sessionId,
        event,
        hook,
      )
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      if (bound) {
        const boundChanged = applyRemoveHookFromMap(
          bound.sessions,
          sessionId,
          event,
          hook,
        )
        if (changed || boundChanged) {
          bound.changed.emit()
        }
      }
      return prev
    })
  }

  logForDebugging(
    `Removed session hook for event ${event} in session ${sessionId}`,
  )
}

// Extended hook matcher that includes optional skillRoot for skill-scoped hooks
export type SessionDerivedHookMatcher = {
  matcher: string
  hooks: HookCommand[]
  skillRoot?: string
}

/**
 * Get all session hooks for a specific event (excluding function hooks)
 * @param appState The app state
 * @param sessionId The session ID
 * @param event Optional event to filter by
 * @returns Hook matchers for the event, or all hooks if no event specified
 */
export function getSessionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, SessionDerivedHookMatcher[]> {
  const registry =
    getSessionHooksRegistry(appState) ??
    getSessionHooksRegistry(appState.sessionHooks)
  if (registry) {
    return registry.getHooks(sessionId, event)
  }
  return readHooksFromStore(appState.sessionHooks.get(sessionId), event)
}

export type FunctionHookMatcher = {
  matcher: string
  hooks: FunctionHook[]
}

/**
 * Get all session function hooks for a specific event
 * Function hooks are kept separate because they can't be persisted to HookMatcher format.
 * @param appState The app state
 * @param sessionId The session ID
 * @param event Optional event to filter by
 * @returns Function hook matchers for the event
 */
export function getSessionFunctionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, FunctionHookMatcher[]> {
  const registry =
    getSessionHooksRegistry(appState) ??
    getSessionHooksRegistry(appState.sessionHooks)
  if (registry) {
    return registry.getFunctionHooks(sessionId, event)
  }
  return readFunctionHooksFromStore(appState.sessionHooks.get(sessionId), event)
}

/**
 * Get the full hook entry (including callbacks) for a specific session hook
 */
export function getSessionHookCallback(
  appState: AppState,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
):
  | {
      hook: HookCommand | FunctionHook
      onHookSuccess?: OnHookSuccess
    }
  | undefined {
  const registry =
    getSessionHooksRegistry(appState) ??
    getSessionHooksRegistry(appState.sessionHooks)
  if (registry) {
    return registry.getHookCallback(sessionId, event, matcher, hook)
  }
  return readHookCallbackFromStore(
    appState.sessionHooks.get(sessionId),
    event,
    matcher,
    hook,
  )
}

export type SkillHookSourceDraw = {
  hooks: number
  characters: number
  texts: Map<string, 'count' | 'characters' | 'matcher' | undefined>
  unfitTexts: number
}

const skillDrawsBySession = new Map<string, Map<string, SkillHookSourceDraw>>()

export function getSkillHookDraws(
  sessionId: string,
): Map<string, SkillHookSourceDraw> {
  let map = skillDrawsBySession.get(sessionId)
  if (!map) {
    map = new Map()
    skillDrawsBySession.set(sessionId, map)
  }
  return map
}

/**
 * Clear all session hooks for a specific session
 * @param setAppState The function to update the app state
 * @param sessionId The session ID
 */
export function clearSessionHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
): void {
  skillDrawsBySession.delete(sessionId)
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    registry.clearSession(sessionId)
  } else {
    setAppState(prev => {
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      const hadInMap = prev.sessionHooks.has(sessionId)
      const hadInBound = bound?.sessions.has(sessionId) ?? false
      if (!hadInMap && !hadInBound) return prev
      if (bound) {
        // Keep the bound Map identity so registryByStore lookup stays associated
        // across subsequent add/get/clear calls (matches in-place Map mutation
        // contract in addHookToSession / removeFunctionHook / removeSessionHook).
        prev.sessionHooks.delete(sessionId)
        bound.sessions.delete(sessionId)
        bound.changed.emit()
        return prev
      }
      const next = new Map(prev.sessionHooks)
      next.delete(sessionId)
      return { ...prev, sessionHooks: next }
    })
  }

  logForDebugging(`Cleared all session hooks for session ${sessionId}`)
}
