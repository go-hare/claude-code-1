/**
 * Official densable fast-path policy helpers (a8_ / V64 / aDO / yh6):
 *   ensureFastPathSettingsLoaded — enableConfigs + MDM await + apply safe env
 *   loadFastPathPolicy — above + optional policy-helper binary (none locally)
 *
 * Used by emO-style CLI fast paths (daemon-worker, bridge, daemon, --bg)
 * so managed settings.env is applied without full main.tsx preAction.
 */

import { enableConfigs } from './config.js'
import { applySafeConfigEnvironmentVariables } from './managedEnv.js'
import {
  KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS,
  ensureKeychainPrefetchCompleted,
} from './secureStorage/keychainPrefetch.js'
import { ensureMdmSettingsLoaded } from './settings/mdm/settings.js'

let settingsLoaded = false
let policyCached: { error: string | null } | null = null

/**
 * densable `Ftn` — enable configs, await MDM, then keychain prefetch with
 * `LDn(Uoa)` (250ms deadline). Hung `security` must not stall remote-control
 * / daemon / `--bg`. REPL `preAction` still awaits unbounded `LDn()`.
 * Idempotent.
 */
export async function ensureFastPathSettingsLoaded(): Promise<void> {
  if (settingsLoaded) return
  settingsLoaded = true
  enableConfigs()
  await ensureMdmSettingsLoaded()
  await ensureKeychainPrefetchCompleted(KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS)
  applySafeConfigEnvironmentVariables()
}

/**
 * Official yh6 / aDO policy-helper step.
 * Official runs an external policyHelper binary when managed settings set one;
 * local reverse-build has no policyHelper path — always null (no error).
 */
async function runFastPathPolicyHelper(): Promise<string | null> {
  if (policyCached) return policyCached.error
  policyCached = { error: null }
  // densable: o8_.error = await vF_(p3_(), RpH()) — omitted when no helper.
  return policyCached.error
}

/**
 * Official aDO — load settings then run policy helper; returns error string or null.
 */
export async function loadFastPathPolicy(): Promise<string | null> {
  await ensureFastPathSettingsLoaded()
  return runFastPathPolicyHelper()
}

/** Test-only reset (official sDO). */
export function resetFastPathPolicyForTesting(): void {
  settingsLoaded = false
  policyCached = null
}
