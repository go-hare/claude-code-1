import {
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import type { Session } from '../sessionRoot.js'
import { getSettingsForSource } from './settings.js'
import type { CUSTOMIZATION_SURFACES } from './types.js'

export type CustomizationSurface = (typeof CUSTOMIZATION_SURFACES)[number]

/**
 * Check whether a customization surface is locked to plugin-only sources
 * by the managed `strictPluginOnlyCustomization` policy.
 *
 * "Locked" means user-level (~/.claude/*) and project-level (.claude/*)
 * sources are skipped for that surface. Managed (policySettings) and
 * plugin-provided sources always load regardless — the policy is admin-set,
 * so managed sources are already admin-controlled, and plugins are gated
 * separately via `strictKnownMarketplaces`.
 *
 * `true` locks all four surfaces; array form locks only those listed.
 * Absent/undefined → nothing locked (the default).
 */
export function isRestrictedToPluginOnly(
  surface: CustomizationSurface,
): boolean {
  const state = trackCurrentPluginOnlyPolicyHost()
  const policy =
    getSettingsForSource('policySettings')?.strictPluginOnlyCustomization
  if (state.lastStrictPluginOnlySnapshot === undefined) {
    state.lastStrictPluginOnlySnapshot = serializeStrictPluginOnlyPolicy(policy)
  }
  if (policy === true) return true
  if (Array.isArray(policy)) return policy.includes(surface)
  return false
}

/**
 * Sources that bypass strictPluginOnlyCustomization. Admin-trusted because:
 *   plugin — gated separately by strictKnownMarketplaces
 *   policySettings — from managed settings, admin-controlled by definition
 *   built-in / builtin / bundled — ship with the CLI, not user-authored
 *
 * Everything else (userSettings, projectSettings, localSettings, flagSettings,
 * mcp, undefined) is user-controlled and blocked when the relevant surface
 * is locked. Covers both AgentDefinition.source ('built-in' with hyphen) and
 * Command.source ('builtin' no hyphen, plus 'bundled').
 */
const ADMIN_TRUSTED_SOURCES: ReadonlySet<string> = new Set([
  'plugin',
  'policySettings',
  'built-in',
  'builtin',
  'bundled',
])

/**
 * Whether a customization's source is admin-trusted under
 * strictPluginOnlyCustomization. Use this to gate frontmatter-hook
 * registration and similar per-item checks where the item carries a
 * source tag but the surface's filesystem loader already ran.
 *
 * Pattern at call sites:
 *   const allowed = !isRestrictedToPluginOnly(surface) || isSourceAdminTrusted(item.source)
 *   if (item.hooks && allowed) { register(...) }
 */
export function isSourceAdminTrusted(source: string | undefined): boolean {
  return source !== undefined && ADMIN_TRUSTED_SOURCES.has(source)
}

export type StrictPluginOnlyPolicyValue =
  | boolean
  | readonly CustomizationSurface[]
  | undefined

type StrictPluginOnlyChangeCallback = (
  nextPolicy: StrictPluginOnlyPolicyValue,
) => void

type StrictPluginOnlyCallbackEntry = {
  callback: StrictPluginOnlyChangeCallback
  persistent: boolean
}

type PluginOnlyPolicyHostState = {
  lastStrictPluginOnlySnapshot: string | undefined
  liveEntry: LivePluginOnlyPolicyHostEntry | null
}

type LivePluginOnlyPolicyHostEntry = {
  sessionRef: WeakRef<Session>
  state: PluginOnlyPolicyHostState
}

const strictPluginOnlyChangeCallbacks = new Set<StrictPluginOnlyCallbackEntry>()

const pluginOnlyPolicyHostSlot = new HostSlot<PluginOnlyPolicyHostState>(
  () => ({
    lastStrictPluginOnlySnapshot: undefined,
    liveEntry: null,
  }),
)

const livePluginOnlyPolicyHosts = new Set<
  WeakRef<LivePluginOnlyPolicyHostEntry>
>()

function getPluginOnlyPolicyHostState(): PluginOnlyPolicyHostState {
  return pluginOnlyPolicyHostSlot.of(getBootstrapSessionHost())
}

function trackCurrentPluginOnlyPolicyHost(): PluginOnlyPolicyHostState {
  const state = getPluginOnlyPolicyHostState()
  try {
    const currentSession = getBootstrapSession()
    const rootSession = currentSession.root ?? currentSession
    if (state.liveEntry === null) {
      if (livePluginOnlyPolicyHosts.size > 64) {
        for (const ref of livePluginOnlyPolicyHosts) {
          const entry = ref.deref()
          if (entry === undefined || entry.sessionRef.deref() === undefined) {
            livePluginOnlyPolicyHosts.delete(ref)
          }
        }
      }
      state.liveEntry = {
        sessionRef: new WeakRef(rootSession),
        state,
      }
      livePluginOnlyPolicyHosts.add(new WeakRef(state.liveEntry))
    } else if (state.liveEntry.sessionRef.deref() !== rootSession) {
      state.liveEntry.sessionRef = new WeakRef(rootSession)
    }
  } catch {
    // sessionHost may be partially mocked in isolated unit tests
  }
  return state
}

function serializeStrictPluginOnlyPolicy(
  value: StrictPluginOnlyPolicyValue,
): string {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (Array.isArray(value)) return JSON.stringify([...value].sort())
  return 'undefined'
}

function evaluateAndNotifyForHost(
  state: PluginOnlyPolicyHostState,
  explicitPolicy?: StrictPluginOnlyPolicyValue,
): boolean {
  const nextPolicy =
    explicitPolicy !== undefined
      ? explicitPolicy
      : getSettingsForSource('policySettings')?.strictPluginOnlyCustomization
  const nextSnapshot = serializeStrictPluginOnlyPolicy(nextPolicy)
  if (state.lastStrictPluginOnlySnapshot === nextSnapshot) {
    return false
  }
  const hadPrevious = state.lastStrictPluginOnlySnapshot !== undefined
  state.lastStrictPluginOnlySnapshot = nextSnapshot
  // Notify on any real change (or initial transition into a restrictive policy).
  if (!hadPrevious && nextSnapshot === 'undefined') {
    return false
  }
  for (const entry of strictPluginOnlyChangeCallbacks) {
    try {
      entry.callback(nextPolicy)
    } catch {
      // Isolate individual cache-clear callback failures
    }
  }
  return true
}

/**
 * Official 2.1.325 #2332: register a cache-clear callback to run whenever
 * managed `strictPluginOnlyCustomization` changes mid-session (e.g., to
 * invalidate cached skills/agents loaded before the policy took effect).
 */
export function registerStrictPluginOnlyChangeCallback(
  callback: StrictPluginOnlyChangeCallback,
  opts?: { persistent?: boolean },
): () => void {
  const entry: StrictPluginOnlyCallbackEntry = {
    callback,
    persistent: opts?.persistent === true,
  }
  strictPluginOnlyChangeCallbacks.add(entry)
  return () => {
    strictPluginOnlyChangeCallbacks.delete(entry)
  }
}

/**
 * Official 2.1.325 #2332: check whether `policySettings.strictPluginOnlyCustomization`
 * changed since the last observation and, if so, invoke all registered
 * cache-clear callbacks. When invoked without an explicit override (e.g. from
 * `changeDetector` on a managed policy update outside ALS), checks and notifies
 * every live host inside its own `runWithSession(targetSession, ...)`.
 * Returns true when a change was broadcast.
 */
export function notifyStrictPluginOnlyPolicyIfChanged(
  explicitPolicy?: StrictPluginOnlyPolicyValue,
): boolean {
  const activeState = trackCurrentPluginOnlyPolicyHost()
  if (explicitPolicy !== undefined) {
    return evaluateAndNotifyForHost(activeState, explicitPolicy)
  }
  let anyChanged = evaluateAndNotifyForHost(activeState)
  const visited = new Set<PluginOnlyPolicyHostState>([activeState])
  for (const ref of livePluginOnlyPolicyHosts) {
    const entry = ref.deref()
    if (entry === undefined) {
      livePluginOnlyPolicyHosts.delete(ref)
      continue
    }
    const targetSession = entry.sessionRef.deref()
    if (targetSession === undefined) {
      livePluginOnlyPolicyHosts.delete(ref)
      entry.state.liveEntry = null
      continue
    }
    if (visited.has(entry.state)) {
      continue
    }
    visited.add(entry.state)
    const changed = runWithSession(targetSession, () =>
      evaluateAndNotifyForHost(entry.state),
    )
    if (changed) {
      anyChanged = true
    }
  }
  return anyChanged
}

export function resetStrictPluginOnlyChangeStateForTests(): void {
  for (const entry of strictPluginOnlyChangeCallbacks) {
    if (!entry.persistent) {
      strictPluginOnlyChangeCallbacks.delete(entry)
    }
  }
  getPluginOnlyPolicyHostState().lastStrictPluginOnlySnapshot = undefined
}
