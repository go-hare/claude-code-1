import { AsyncLocalStorage } from 'async_hooks'
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
import { getBootstrapSession, getBootstrapSessionHost } from '../sessionHost.js'
import type { HookCommand } from '../settings/types.js'
import { isHookEqual } from './hooksSettings.js'

/**
 * Official 2.1.331 `class W` (`06_W_host_slot_class.js`) — lazy per-host/object
 * `WeakMap` slot so concurrent `SessionHost` instances never share mutable state.
 */
class WeakOwnerSlot<T> {
  #create: () => T
  #values = new WeakMap<object, T>()

  constructor(create: () => T) {
    this.#create = create
  }

  of(owner: object): T {
    const existing = this.#values.get(owner)
    if (existing !== undefined) return existing
    const created = this.#create()
    this.#values.set(owner, created)
    return created
  }

  delete(owner: object): void {
    this.#values.delete(owner)
  }
}

/**
 * Official 2.1.331 `GWo(set, item)` (`02_host_slot_als.js`) — add `item` as a
 * `WeakRef` to `set` if not already live, pruning collected `WeakRef` entries.
 */
export function addWeakRef<T extends object>(
  set: Set<WeakRef<T>>,
  item: T,
): boolean {
  let found = false
  for (const ref of set) {
    const deref = ref.deref()
    if (deref === undefined) {
      set.delete(ref)
    } else if (deref === item) {
      found = true
    }
  }
  if (found) return false
  set.add(new WeakRef(item))
  return true
}

/**
 * Official 2.1.331 `kDt(set)` (`02_host_slot_als.js`) — return live `T[]` from
 * a `Set<WeakRef<T>>`, deleting garbage-collected `WeakRef` entries in place.
 */
export function collectWeakRefs<T extends object>(set: Set<WeakRef<T>>): T[] {
  const live: T[] = []
  for (const ref of set) {
    const deref = ref.deref()
    if (deref === undefined) {
      set.delete(ref)
    } else {
      live.push(deref)
    }
  }
  return live
}

export type HookExecutionContext = {
  hookEvent?: HookEvent | string
  sessionId?: string
  hookId?: string
  hookName?: string
}

const hookExecutionStorage = new AsyncLocalStorage<HookExecutionContext>()
let hookExecutionEverEntered = false
const hostHookExecutionEntrySlot = new WeakOwnerSlot(() => ({
  hasEntered: false,
}))

/** Official 2.1.331 `o7()` — whether any hook execution scope has been entered. */
export function hasEnteredHookExecution(): boolean {
  return hookExecutionEverEntered
}

/** Official 2.1.331 `H` per-host slot — whether the active `SessionHost` has entered hook execution. */
export function hasHostEnteredHookExecution(): boolean {
  return hostHookExecutionEntrySlot.of(getBootstrapSessionHost()).hasEntered
}

/** Official 2.1.331 `Xye()` — whether the current async call chain is inside a hook execution scope. */
export function isInsideHookExecution(): boolean {
  return hookExecutionStorage.getStore() !== undefined
}

export function getHookExecutionContext(): HookExecutionContext | undefined {
  return hookExecutionStorage.getStore()
}

/** Enter an `AsyncLocalStorage` hook execution scope (`p.run(...)`). */
export function runInsideHookExecution<T>(
  fn: () => T,
  context: HookExecutionContext = {},
): T {
  hookExecutionEverEntered = true
  hostHookExecutionEntrySlot.of(getBootstrapSessionHost()).hasEntered = true
  return hookExecutionStorage.run(context, fn)
}

/** Exit any enclosing `AsyncLocalStorage` hook execution scope (`p.exit(...)`). */
export function exitHookExecution<T>(fn: () => T): T {
  return hookExecutionStorage.exit(fn)
}

export function _resetHookExecutionStateForTesting(): void {
  hookExecutionEverEntered = false
  hostHookExecutionEntrySlot.delete(getBootstrapSessionHost())
}

export type HostHookRegistryOwner = {
  session?: {
    hookRegistry?: {
      holder(): { registeredHooks: unknown }
      mainThreadAgentHooks(): unknown
    }
  }
  registeredHooks?: unknown
  mainThreadAgentHooks?: unknown
}

const hostHookOwnersSlot = new WeakOwnerSlot(
  () => new Set<WeakRef<HostHookRegistryOwner>>(),
)

/**
 * Official 2.1.331 `GWo(S(), owner)` (`02_host_slot_als.js`) — register a
 * session/hook registry owner on the active `SessionHost` via `WeakRef`.
 */
export function registerHostHookOwner(owner: HostHookRegistryOwner): boolean {
  return addWeakRef(hostHookOwnersSlot.of(getBootstrapSessionHost()), owner)
}

/** Official 2.1.331 `kDt(S())` — return live hook owners for the active `SessionHost`. */
export function getHostHookOwners(): HostHookRegistryOwner[] {
  return collectWeakRefs(hostHookOwnersSlot.of(getBootstrapSessionHost()))
}

/**
 * Official 2.1.331 `Q8l()` (`02_host_slot_als.js`) — collect
 * `[registeredHooks, mainThreadAgentHooks, ...]` across all live hook owners on
 * the active `SessionHost`.
 */
export function collectHostRegisteredHooks(): unknown[] {
  const out: unknown[] = []
  for (const owner of getHostHookOwners()) {
    const reg = owner.session?.hookRegistry
    out.push(
      reg ? reg.holder().registeredHooks : owner.registeredHooks,
      reg ? reg.mainThreadAgentHooks() : owner.mainThreadAgentHooks,
    )
  }
  return out
}

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

const hostSessionHookStoresSlot = new WeakOwnerSlot(
  () => new Set<WeakRef<SessionHooksState>>(),
)
const sessionHooksStateByRootSession = new WeakOwnerSlot<SessionHooksState>(
  () => new Map(),
)

function trackHostSessionHooksState(storeMap: SessionHooksState): void {
  addWeakRef(hostSessionHookStoresSlot.of(getBootstrapSessionHost()), storeMap)
}

/** Live `SessionHooksState` maps registered under the active `SessionHost`. */
export function getHostSessionHookStores(): SessionHooksState[] {
  return collectWeakRefs(
    hostSessionHookStoresSlot.of(getBootstrapSessionHost()),
  )
}

/** Per-`Session.root` ephemeral `SessionHooksState` map (registered on its `SessionHost`). */
export function getBootstrapSessionHooksState(): SessionHooksState {
  const rootSession = getBootstrapSession().root
  const storeMap = sessionHooksStateByRootSession.of(rootSession)
  trackHostSessionHooksState(storeMap)
  return storeMap
}

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
  const id = options?.id || `function-hook-${Date.now()}-${Math.random()}`
  const wrappedCallback: FunctionHookCallback = (messages, signal) =>
    isInsideHookExecution()
      ? callback(messages, signal)
      : runInsideHookExecution(() => callback(messages, signal), {
          hookEvent: event,
          sessionId,
          hookId: id,
        })
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    trackHostSessionHooksState(registry.sessions)
    const registeredId = registry.addFunctionHook(
      sessionId,
      event,
      matcher,
      wrappedCallback,
      errorMessage,
      { ...options, id },
    )
    logForDebugging(
      `Added session hook for event ${event} in session ${sessionId}`,
    )
    return registeredId
  }
  const hook: FunctionHook = {
    type: 'function',
    id,
    timeout: options?.timeout || 5000,
    callback: wrappedCallback,
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
  const wrappedOnHookSuccess: OnHookSuccess | undefined = onHookSuccess
    ? (firedHook, result) =>
        isInsideHookExecution()
          ? onHookSuccess(firedHook, result)
          : runInsideHookExecution(() => onHookSuccess(firedHook, result), {
              hookEvent: event,
              sessionId,
            })
    : undefined
  const registry = getSessionHooksRegistry(setAppState)
  if (registry) {
    trackHostSessionHooksState(registry.sessions)
    registry.addHook(
      sessionId,
      event,
      matcher,
      hook,
      wrappedOnHookSuccess,
      skillRoot,
    )
  } else {
    setAppState(prev => {
      trackHostSessionHooksState(prev.sessionHooks)
      applyAddHookToMap(
        prev.sessionHooks,
        sessionId,
        event,
        matcher,
        hook,
        wrappedOnHookSuccess,
        skillRoot,
      )
      const bound = getSessionHooksRegistry(prev.sessionHooks)
      if (bound) {
        trackHostSessionHooksState(bound.sessions)
        applyAddHookToMap(
          bound.sessions,
          sessionId,
          event,
          matcher,
          hook,
          wrappedOnHookSuccess,
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

const skillDrawsByHost = new WeakOwnerSlot(
  () => new Map<string, Map<string, SkillHookSourceDraw>>(),
)

export function getSkillHookDraws(
  sessionId: string,
): Map<string, SkillHookSourceDraw> {
  const skillDrawsBySession = skillDrawsByHost.of(getBootstrapSessionHost())
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
  skillDrawsByHost.of(getBootstrapSessionHost()).delete(sessionId)
  sessionHooksStateByRootSession
    .of(getBootstrapSession().root)
    .delete(sessionId)
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
      if (next.size > 0) {
        trackHostSessionHooksState(next)
      }
      return { ...prev, sessionHooks: next }
    })
  }

  logForDebugging(`Cleared all session hooks for session ${sessionId}`)
}
