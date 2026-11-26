import { resetSdkInitState } from '../../bootstrap/state.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import { isRestrictedToPluginOnly } from '../settings/pluginOnlyPolicy.js'
// Import as module object so spyOn works in tests (direct imports bypass spies)
import * as settingsModule from '../settings/settings.js'
import {
  getSettingsOwner,
  resetSettingsCache,
} from '../settings/settingsCache.js'
import { loadSettingsUnderPrime } from '../settings/settingsPrimer.js'
import type { HooksSettings } from '../settings/types.js'
import type { StorageV5 } from '../storageV5/createLocalFsBackend.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'

const DEFAULT_SNAPSHOT_KEY = 'cli'

type SessionHooksSnapshotEntry = {
  initialHooksConfig: HooksSettings | null
}

type HostHooksConfigSnapshotState = {
  initialHooksConfig: HooksSettings | null
  snapshotKey: () => string
  snapshotsBySessionId: Map<string, SessionHooksSnapshotEntry>
  unsubscribeSettingsChange: (() => void) | null
}

const hostHooksConfigSnapshotSlot = new HostSlot<HostHooksConfigSnapshotState>(
  () => ({
    initialHooksConfig: null,
    snapshotKey: () => DEFAULT_SNAPSHOT_KEY,
    snapshotsBySessionId: new Map(),
    unsubscribeSettingsChange: null,
  }),
)

function getHostHooksConfigSnapshotState(): HostHooksConfigSnapshotState {
  return hostHooksConfigSnapshotSlot.of(getBootstrapSessionHost())
}

function currentSnapshotEntry(
  state: HostHooksConfigSnapshotState,
): SessionHooksSnapshotEntry {
  const key = state.snapshotKey()
  let entry = state.snapshotsBySessionId.get(key)
  if (!entry) {
    entry = { initialHooksConfig: null }
    state.snapshotsBySessionId.set(key, entry)
  }
  return entry
}

function storeHooksSnapshot(
  state: HostHooksConfigSnapshotState,
  config: HooksSettings,
): void {
  currentSnapshotEntry(state).initialHooksConfig = config
  state.initialHooksConfig = config
}

function ensureSettingsChangeSubscription(
  state: HostHooksConfigSnapshotState,
): void {
  if (state.unsubscribeSettingsChange !== null) {
    return
  }
  let changeDetector:
    | typeof import('../settings/changeDetector.js')['settingsChangeDetector']
    | undefined
  try {
    changeDetector = (
      require('../settings/changeDetector.js') as typeof import('../settings/changeDetector.js')
    ).settingsChangeDetector
  } catch {
    return
  }
  if (!changeDetector) {
    return
  }
  const currentSession = getBootstrapSession()
  const sessionRef = new WeakRef(currentSession.root ?? currentSession)
  const stateRef = new WeakRef(state)
  let unsubscribe: (() => void) | null = null
  unsubscribe = changeDetector.subscribe(source => {
    const targetSession = sessionRef.deref()
    if (!targetSession) {
      unsubscribe?.()
      const currentState = stateRef.deref()
      if (
        currentState &&
        currentState.unsubscribeSettingsChange === unsubscribe
      ) {
        currentState.unsubscribeSettingsChange = null
      }
      return
    }
    runWithSession(targetSession, () => {
      const hostState = getHostHooksConfigSnapshotState()
      const settingsOwner = getSettingsOwner()
      if (source === 'policySettings') {
        settingsOwner.invalidatePolicyLayer()
        settingsOwner.parsedFiles.clear()
      } else {
        settingsOwner.dropDerivedCaches(source)
        settingsOwner.parsedFiles.clear()
      }
      storeHooksSnapshot(hostState, getHooksFromAllowedSources())
    })
  })
  state.unsubscribeSettingsChange = unsubscribe
}

/**
 * Get hooks from allowed sources.
 * If allowManagedHooksOnly is set in policySettings, only managed hooks are returned.
 * If disableAllHooks is set in policySettings, no hooks are returned.
 * If disableAllHooks is set in non-managed settings, only managed hooks are returned
 * (non-managed settings cannot disable managed hooks).
 * Otherwise, returns merged hooks from all sources (backwards compatible).
 */
function getHooksFromAllowedSources(): HooksSettings {
  const policySettings = settingsModule.getSettingsForSource('policySettings')

  // If managed settings disables all hooks, return empty
  if (policySettings?.disableAllHooks === true) {
    return {}
  }

  // If allowManagedHooksOnly is set in managed settings, only use managed hooks
  if (policySettings?.allowManagedHooksOnly === true) {
    return policySettings.hooks ?? {}
  }

  // strictPluginOnlyCustomization: block user/project/local settings hooks.
  // Plugin hooks (registered channel, hooks.ts:1391) are NOT affected —
  // they're assembled separately and the managedOnly skip there is keyed
  // on shouldAllowManagedHooksOnly(), not on this policy. Agent frontmatter
  // hooks are gated at REGISTRATION (runAgent.ts:~535) by agent source —
  // plugin/built-in/policySettings agents register normally, user-sourced
  // agents skip registration under ["hooks"]. A blanket execution-time
  // block here would over-kill plugin agents' hooks.
  if (isRestrictedToPluginOnly('hooks')) {
    return policySettings?.hooks ?? {}
  }

  const mergedSettings = settingsModule.getSettings_DEPRECATED()

  // If disableAllHooks is set in non-managed settings, only managed hooks still run
  // (non-managed settings cannot override managed hooks)
  if (mergedSettings.disableAllHooks === true) {
    return policySettings?.hooks ?? {}
  }

  // Otherwise, use all hooks (merged from all sources) - backwards compatible
  return mergedSettings.hooks ?? {}
}

/**
 * Check if only managed hooks should run.
 * This is true when:
 * - policySettings has allowManagedHooksOnly: true, OR
 * - disableAllHooks is set in non-managed settings (non-managed settings
 *   cannot disable managed hooks, so they effectively become managed-only)
 */
export function shouldAllowManagedHooksOnly(): boolean {
  const policySettings = settingsModule.getSettingsForSource('policySettings')
  if (policySettings?.allowManagedHooksOnly === true) {
    return true
  }
  // If disableAllHooks is set but NOT from managed settings,
  // treat as managed-only (non-managed hooks disabled, managed hooks still run)
  if (
    settingsModule.getSettings_DEPRECATED().disableAllHooks === true &&
    policySettings?.disableAllHooks !== true
  ) {
    return true
  }
  return false
}

/**
 * Check if all hooks (including managed) should be disabled.
 * This is only true when managed/policy settings has disableAllHooks: true.
 * When disableAllHooks is set in non-managed settings, managed hooks still run.
 */
export function shouldDisableAllHooksIncludingManaged(): boolean {
  return (
    settingsModule.getSettingsForSource('policySettings')?.disableAllHooks ===
    true
  )
}

/**
 * Capture a snapshot of the current hooks configuration
 * This should be called once during application startup
 * Respects the allowManagedHooksOnly setting
 */
export function captureHooksConfigSnapshot(): void {
  const state = getHostHooksConfigSnapshotState()
  storeHooksSnapshot(state, getHooksFromAllowedSources())
  ensureSettingsChangeSubscription(state)
}

/**
 * Update the hooks configuration snapshot
 * This should be called when hooks are modified through the settings
 * Respects the allowManagedHooksOnly setting
 */
export function updateHooksConfigSnapshot(): void {
  // Reset the session cache to ensure we read fresh settings from disk.
  // Without this, the snapshot could use stale cached settings when the user
  // edits settings.json externally and then runs /hooks - the session cache
  // may not have been invalidated yet (e.g., if the file watcher's stability
  // threshold hasn't elapsed).
  resetSettingsCache()
  const state = getHostHooksConfigSnapshotState()
  storeHooksSnapshot(state, getHooksFromAllowedSources())
  ensureSettingsChangeSubscription(state)
}

/**
 * Official nHe @180749964 — Gqe then refresh hooks snapshot, dispose retainers.
 * Leftover: updateHooksConfigSnapshotUnderPrime.
 */
export async function updateHooksConfigSnapshotUnderPrime(
  storageV5: StorageV5 | undefined,
): Promise<void> {
  if (!isHoverRestOn() || storageV5 === undefined) {
    updateHooksConfigSnapshot()
    return
  }
  const dispose = await loadSettingsUnderPrime(storageV5)
  try {
    const state = getHostHooksConfigSnapshotState()
    storeHooksSnapshot(state, getHooksFromAllowedSources())
    ensureSettingsChangeSubscription(state)
  } finally {
    dispose?.()
  }
}

/**
 * Get the current hooks configuration from snapshot
 * Falls back to settings if no snapshot exists
 * @returns The hooks configuration
 */
export function getHooksConfigFromSnapshot(): HooksSettings | null {
  const state = getHostHooksConfigSnapshotState()
  const entry = currentSnapshotEntry(state)
  if (entry.initialHooksConfig === null) {
    captureHooksConfigSnapshot()
  }
  return currentSnapshotEntry(state).initialHooksConfig
}

/**
 * Reset the hooks configuration snapshot (useful for testing)
 * Also resets SDK init state to prevent test pollution
 */
export function resetHooksConfigSnapshot(): void {
  const state = getHostHooksConfigSnapshotState()
  state.unsubscribeSettingsChange?.()
  state.unsubscribeSettingsChange = null
  state.snapshotsBySessionId.clear()
  state.snapshotKey = () => DEFAULT_SNAPSHOT_KEY
  state.initialHooksConfig = null
  resetSdkInitState()
}
