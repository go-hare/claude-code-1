import { HOOK_EVENTS, type HookEvent } from '../entrypoints/agentSdkTypes.js'
import type { HookCommand } from '../utils/settings/types.js'
import { isHookEqual } from '../utils/hooks/hooksSettings.js'
import type {
  FunctionHook,
  FunctionHookCallback,
  FunctionHookMatcher,
  OnHookSuccess,
  SessionDerivedHookMatcher,
  SessionHookMatcher,
  SessionHooksState,
  SessionStore,
} from '../utils/hooks/sessionHooks.js'
import { createSignal } from '../utils/signal.js'
import type { AppStateStore } from './AppStateStore.js'

const registryByStore = new WeakMap<object, SessionHooksRegistry>()

export function getSessionHooksRegistry(
  target: unknown,
): SessionHooksRegistry | undefined {
  if (
    (typeof target !== 'object' && typeof target !== 'function') ||
    target === null
  ) {
    return undefined
  }
  return registryByStore.get(target)
}

export function applyAddHookToMap(
  sessions: SessionHooksState,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  const store = sessions.get(sessionId) ?? { hooks: {} }
  const eventMatchers = store.hooks[event] || []

  const existingMatcherIndex = eventMatchers.findIndex(
    m => m.matcher === matcher && m.skillRoot === skillRoot,
  )

  let updatedMatchers: SessionHookMatcher[]
  if (existingMatcherIndex >= 0) {
    // densable gZc: same-id function hooks replace (not append) so re-init
    // (e.g. teammate-idle-notification) cannot stack duplicate Stop hooks.
    updatedMatchers = [...eventMatchers]
    const existingMatcher = updatedMatchers[existingMatcherIndex]!
    const replaceIdx =
      hook.type === 'function' && hook.id
        ? existingMatcher.hooks.findIndex(
            h => h.hook.type === 'function' && h.hook.id === hook.id,
          )
        : -1
    const nextHooks =
      replaceIdx >= 0
        ? existingMatcher.hooks.map((h, i) =>
            i === replaceIdx ? { hook, onHookSuccess } : h,
          )
        : [...existingMatcher.hooks, { hook, onHookSuccess }]
    updatedMatchers[existingMatcherIndex] = {
      matcher: existingMatcher.matcher,
      skillRoot: existingMatcher.skillRoot,
      hooks: nextHooks,
    }
  } else {
    updatedMatchers = [
      ...eventMatchers,
      {
        matcher,
        skillRoot,
        hooks: [{ hook, onHookSuccess }],
      },
    ]
  }

  const newHooks = { ...store.hooks, [event]: updatedMatchers }
  sessions.set(sessionId, { hooks: newHooks })
}

export function applyRemoveFunctionHookFromMap(
  sessions: SessionHooksState,
  sessionId: string,
  event: HookEvent,
  hookId: string,
): boolean {
  const store = sessions.get(sessionId)
  if (!store) {
    return false
  }

  const eventMatchers = store.hooks[event] || []
  const updatedMatchers = eventMatchers
    .map(matcher => {
      const updatedHooks = matcher.hooks.filter(h => {
        if (h.hook.type !== 'function') return true
        return h.hook.id !== hookId
      })

      return updatedHooks.length > 0
        ? { ...matcher, hooks: updatedHooks }
        : null
    })
    .filter((m): m is SessionHookMatcher => m !== null)

  const newHooks =
    updatedMatchers.length > 0
      ? { ...store.hooks, [event]: updatedMatchers }
      : Object.fromEntries(
          Object.entries(store.hooks).filter(([e]) => e !== event),
        )

  sessions.set(sessionId, { hooks: newHooks })
  return true
}

export function applyRemoveHookFromMap(
  sessions: SessionHooksState,
  sessionId: string,
  event: HookEvent,
  hook: HookCommand,
): boolean {
  const store = sessions.get(sessionId)
  if (!store) {
    return false
  }

  const eventMatchers = store.hooks[event] || []
  const updatedMatchers = eventMatchers
    .map(matcher => {
      const updatedHooks = matcher.hooks.filter(h => !isHookEqual(h.hook, hook))

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

function convertToHookMatchers(
  sessionMatchers: SessionHookMatcher[],
): SessionDerivedHookMatcher[] {
  return sessionMatchers.map(sm => ({
    matcher: sm.matcher,
    skillRoot: sm.skillRoot,
    // Filter out function hooks - they can't be persisted to HookMatcher format
    hooks: sm.hooks
      .map(h => h.hook)
      .filter((h): h is HookCommand => h.type !== 'function'),
  }))
}

export function readHooksFromStore(
  store: SessionStore | undefined,
  event?: HookEvent,
): Map<HookEvent, SessionDerivedHookMatcher[]> {
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, SessionDerivedHookMatcher[]>()

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      result.set(event, convertToHookMatchers(sessionMatchers))
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      result.set(evt, convertToHookMatchers(sessionMatchers))
    }
  }

  return result
}

function extractFunctionHooks(
  sessionMatchers: SessionHookMatcher[],
): FunctionHookMatcher[] {
  return sessionMatchers
    .map(sm => ({
      matcher: sm.matcher,
      hooks: sm.hooks
        .map(h => h.hook)
        .filter((h): h is FunctionHook => h.type === 'function'),
    }))
    .filter(m => m.hooks.length > 0)
}

export function readFunctionHooksFromStore(
  store: SessionStore | undefined,
  event?: HookEvent,
): Map<HookEvent, FunctionHookMatcher[]> {
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, FunctionHookMatcher[]>()

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(event, functionMatchers)
      }
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(evt, functionMatchers)
      }
    }
  }

  return result
}

export function readHookCallbackFromStore(
  store: SessionStore | undefined,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
):
  | {
      hook: HookCommand | FunctionHook
      onHookSuccess?: OnHookSuccess
    }
  | undefined {
  if (!store) {
    return undefined
  }

  const eventMatchers = store.hooks[event]
  if (!eventMatchers) {
    return undefined
  }

  for (const matcherEntry of eventMatchers) {
    if (matcherEntry.matcher === matcher || matcher === '') {
      const hookEntry = matcherEntry.hooks.find(h => isHookEqual(h.hook, hook))
      if (hookEntry) {
        return hookEntry
      }
    }
  }

  return undefined
}

/**
 * Official `E0` / `ZJ()` @186246913 — SessionHooksRegistry mounted by `<AppStateProvider />`.
 * Manages session-scoped hooks independently of AppState re-renders while mirroring
 * `AppState.sessionHooks` for non-React `ToolUseContext` consumers.
 */
export class SessionHooksRegistry {
  readonly sessions: SessionHooksState = new Map()
  readonly changed = createSignal()
  #boundStore: Pick<AppStateStore, 'getState' | 'setState'> | undefined

  bindStore(store: Pick<AppStateStore, 'getState' | 'setState'>): void {
    this.#boundStore = store
    registryByStore.set(store, this)
    registryByStore.set(store.setState, this)
    const initial = store.getState().sessionHooks
    registryByStore.set(initial, this)
    for (const [k, v] of initial) {
      if (!this.sessions.has(k)) {
        this.sessions.set(k, v)
      }
    }
    for (const [k, v] of this.sessions) {
      if (!initial.has(k)) {
        initial.set(k, v)
      }
    }
  }

  get(sessionId: string) {
    return (
      this.sessions.get(sessionId) ??
      this.#boundStore?.getState().sessionHooks.get(sessionId)
    )
  }

  has(sessionId: string, event: HookEvent): boolean {
    const entry = this.get(sessionId)
    return entry?.hooks[event] !== undefined
  }

  addHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: HookCommand | FunctionHook,
    onHookSuccess?: OnHookSuccess,
    skillRoot?: string,
  ): void {
    applyAddHookToMap(
      this.sessions,
      sessionId,
      event,
      matcher,
      hook,
      onHookSuccess,
      skillRoot,
    )
    this.#boundStore?.setState(prev => {
      applyAddHookToMap(
        prev.sessionHooks,
        sessionId,
        event,
        matcher,
        hook,
        onHookSuccess,
        skillRoot,
      )
      return prev
    })
    this.changed.emit()
  }

  addFunctionHook(
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
    const hook: FunctionHook = {
      type: 'function',
      id,
      timeout: options?.timeout || 5000,
      callback,
      errorMessage,
    }
    this.addHook(sessionId, event, matcher, hook)
    return id
  }

  removeFunctionHook(
    sessionId: string,
    event: HookEvent,
    hookId: string,
  ): void {
    const changedReg = applyRemoveFunctionHookFromMap(
      this.sessions,
      sessionId,
      event,
      hookId,
    )
    let changedStore = false
    this.#boundStore?.setState(prev => {
      changedStore = applyRemoveFunctionHookFromMap(
        prev.sessionHooks,
        sessionId,
        event,
        hookId,
      )
      return prev
    })
    if (changedReg || changedStore) {
      this.changed.emit()
    }
  }

  removeHook(sessionId: string, event: HookEvent, hook: HookCommand): void {
    const changedReg = applyRemoveHookFromMap(
      this.sessions,
      sessionId,
      event,
      hook,
    )
    let changedStore = false
    this.#boundStore?.setState(prev => {
      changedStore = applyRemoveHookFromMap(
        prev.sessionHooks,
        sessionId,
        event,
        hook,
      )
      return prev
    })
    if (changedReg || changedStore) {
      this.changed.emit()
    }
  }

  getHooks(
    sessionId: string,
    event?: HookEvent,
  ): Map<HookEvent, SessionDerivedHookMatcher[]> {
    return readHooksFromStore(this.get(sessionId), event)
  }

  getFunctionHooks(
    sessionId: string,
    event?: HookEvent,
  ): Map<HookEvent, FunctionHookMatcher[]> {
    return readFunctionHooksFromStore(this.get(sessionId), event)
  }

  getHookCallback(
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
    return readHookCallbackFromStore(this.get(sessionId), event, matcher, hook)
  }

  clearSession(sessionId: string): void {
    const hadSession = this.sessions.delete(sessionId)
    let hadStore = false
    this.#boundStore?.setState(prev => {
      if (!prev.sessionHooks.has(sessionId)) return prev
      hadStore = true
      const next = new Map(prev.sessionHooks)
      next.delete(sessionId)
      registryByStore.set(next, this)
      return { ...prev, sessionHooks: next }
    })
    if (hadSession || hadStore) {
      this.changed.emit()
    }
  }

  clear(sessionId: string): void {
    this.clearSession(sessionId)
  }

  subscribe(listener: () => void): () => void {
    return this.changed.subscribe(listener)
  }
}

export function createSessionHooksRegistry(): SessionHooksRegistry {
  return new SessionHooksRegistry()
}
