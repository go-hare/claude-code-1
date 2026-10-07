/**
 * densable 2.1.289 `ne` / `ae` / `TQt` / `RQt` — bridge RC-child grants attach.
 *
 * Gold: SEA around `bridge_rc_child_grants` + `remote_control_attach`.
 * Do **not** export minify `ne`/`ae`/`TQt`/`RQt`/`kLe`.
 */

import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  onGrowthBookRefresh,
} from '../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { ToolPermissionContext } from '../Tool.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { setPermissionModeWithGuards } from '../utils/permissions/permissionSetup.js'
import {
  getFlagSettingsInline,
  setFlagSettingsInline,
} from '../bootstrap/state.js'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import { getSettingsForSource } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'
import { isSdkArtifactDefaultOffEntrypoint } from '../utils/artifactGates.js'
import { getBridgeBaseUrl } from './bridgeConfig.js'
import {
  parseSessionOriginRoles,
  readBridgeSessionTags,
  type SessionOriginRoles,
} from './sessionOriginTags.js'

/** densable `lp` defaults marker — never seed into environment. */
export const AUTO_MODE_DEFAULTS_SENTINEL = '$defaults'

export type BridgeChildGrantRoles = {
  autoDefault: boolean
  autoOverSettings: boolean
  artifact: boolean
  machineSettings: boolean
  autoCompact: boolean
}

export type BridgeChildGrantsHandle = {
  granted: {
    autoMode: boolean
    facts: number
    artifact: boolean
    autoCompact: boolean
  }
  undo: () => string | null
}

export type BridgeChildGrantsDeps = {
  sessionId: string
  credentials?: unknown
  autoModeEnvironment: string[]
  permission: {
    get: () => ToolPermissionContext
    set: (
      updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
    ) => void
  }
  stillWanted: () => boolean
  applyAfter?: Promise<unknown>
  inheritLiftedFrom?: string | null
  keepChosenMode: () => boolean
  /** Optional inject for tests. */
  readTags?: typeof readBridgeSessionTags
  setMode?: typeof setPermissionModeWithGuards
}

const EMPTY_GRANTS: BridgeChildGrantsHandle = {
  undo: () => null,
  granted: { autoMode: false, facts: 0, artifact: false, autoCompact: false },
}

/**
 * densable `SXn` / `$6r` / `bXn` / `wXn` / `EXn` — child grant gates.
 * LOCAL_GATE_DEFAULTS may pin these true when GB is hollow.
 */
export function isBridgeChildAutoModeGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_child_auto_mode',
      true,
    ) !== false
  )
}

export function isBridgeChildAutoOverSettingsGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_child_auto_over_settings',
      true,
    ) !== false
  )
}

export function isBridgeRcChildArtifactGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_rc_child_artifact',
      true,
    ) !== false
  )
}

export function isBridgeChildMachineSettingsGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_child_machine_settings',
      true,
    ) !== false
  )
}

export function isBridgeRcChildAutoCompactGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_rc_child_auto_compact',
      true,
    ) !== false
  )
}

/**
 * densable `TQt("attach"|"spawn")`.
 */
export function shouldAttachBridgeChildGrants(
  reason: 'attach' | 'spawn' = 'attach',
): boolean {
  if (isBridgeChildAutoModeGate() || isBridgeRcChildArtifactGate()) return true
  return (
    isBridgeRcChildAutoCompactGate() ||
    (reason === 'spawn' && isBridgeChildMachineSettingsGate())
  )
}

/**
 * densable `kBe` — sdk-host lane apply gate.
 */
export function isBridgeApplyServerSessionConfigGate(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_bridge_apply_server_session_config',
      true,
    ) !== false
  )
}

/**
 * densable `RQt({roles, modePinned, settings})`.
 */
export function deriveBridgeChildGrantRoles(input: {
  roles: SessionOriginRoles
  modePinned: boolean
}): BridgeChildGrantRoles {
  const autoDefault =
    input.roles.rcChild && !input.modePinned && isBridgeChildAutoModeGate()
  const autoOverSettings = autoDefault && isBridgeChildAutoOverSettingsGate()
  const attended = input.roles.attended || input.roles.projectThreadChild
  return {
    autoDefault,
    autoOverSettings,
    artifact: attended && isBridgeRcChildArtifactGate(),
    machineSettings:
      input.roles.projectThreadChild && isBridgeChildMachineSettingsGate(),
    autoCompact:
      input.roles.projectThreadChild && isBridgeRcChildAutoCompactGate(),
  }
}

/**
 * densable `ue` — remove one multiset occurrence of each held fact from env.
 */
function retractHeldFactsOnce(
  environment: string[],
  held: readonly string[],
): string[] {
  const remaining = [...held]
  const out: string[] = []
  for (const entry of environment) {
    const idx = remaining.indexOf(entry)
    if (idx === -1) {
      out.push(entry)
      continue
    }
    remaining.splice(idx, 1)
  }
  return out
}

function sanitizeIncomingFacts(facts: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const fact of facts) {
    if (!fact || fact === AUTO_MODE_DEFAULTS_SENTINEL) continue
    if (seen.has(fact)) continue
    seen.add(fact)
    out.push(fact)
  }
  return out
}

/**
 * densable `X(n, f, S)` — retract previously held, merge incoming facts, write
 * when changed. Returns the new held list (gold `T`).
 *
 * Gold writes **flagSettings** via `tN`/`_y` (session inline). Do **not** write
 * durable `userSettings` — RC-child facts must not persist on the host.
 */
export function applyAutoModeEnvironmentFacts(
  incoming: string[],
  previouslyHeld: readonly string[] = [],
): string[] {
  const inline = (getFlagSettingsInline() ?? {}) as SettingsJson
  const existing = inline.autoMode?.environment ?? []
  const afterRetract = retractHeldFactsOnce(existing, previouslyHeld)
  const nextHeld = sanitizeIncomingFacts(incoming)
  const nextEnvironment = [...afterRetract, ...nextHeld]
  const same =
    nextEnvironment.length === existing.length &&
    nextEnvironment.every((entry, i) => entry === existing[i])
  if (same) return nextHeld
  const { autoMode: _prevAuto, ...restInline } = inline
  const nextAuto =
    nextEnvironment.length > 0
      ? {
          ...(typeof _prevAuto === 'object' && _prevAuto ? _prevAuto : {}),
          environment: nextEnvironment,
        }
      : (() => {
          if (!(_prevAuto && typeof _prevAuto === 'object')) return undefined
          const { environment: _e, ...restAuto } = _prevAuto as Record<
            string,
            unknown
          >
          return Object.keys(restAuto).length > 0 ? restAuto : undefined
        })()
  const nextInline =
    nextAuto === undefined
      ? Object.keys(restInline).length > 0
        ? restInline
        : null
      : { ...restInline, autoMode: nextAuto }
  try {
    setFlagSettingsInline(nextInline as Record<string, unknown> | null)
    settingsChangeDetector.notifyChange('flagSettings')
  } catch (error) {
    logForDebugging(
      `[bridge:server-config] autoMode.environment seed failed: ${errorMessage(error)}`,
      { level: 'warn' },
    )
    return [...previouslyHeld]
  }
  return nextHeld
}

/**
 * densable first-fire helper — seed with empty prior held (append-shaped).
 * Subscribe reseed uses `applyAutoModeEnvironmentFacts` with held tracking.
 */
export function seedAutoModeEnvironmentFacts(
  facts: string[],
  onSeeded?: (seeded: string[]) => void,
): string[] {
  const seeded = applyAutoModeEnvironmentFacts(facts, [])
  onSeeded?.(seeded)
  return seeded
}

function retractAutoModeEnvironmentFacts(facts: string[]): void {
  applyAutoModeEnvironmentFacts([], facts)
}

/**
 * densable `ne(opts)` — attach RC-child grants.
 */
export async function attachBridgeChildGrants(
  deps: BridgeChildGrantsDeps,
): Promise<BridgeChildGrantsHandle> {
  const attachGate = shouldAttachBridgeChildGrants('attach')
  const hasFacts = deps.autoModeEnvironment.length > 0
  if (!attachGate && !hasFacts) return EMPTY_GRANTS

  const readTags = deps.readTags ?? readBridgeSessionTags
  const setMode = deps.setMode ?? setPermissionModeWithGuards
  const tags =
    attachGate || hasFacts
      ? await readTags(deps.sessionId, {
          baseUrl: getBridgeBaseUrl(),
          credentials: deps.credentials,
        })
      : null

  if (deps.applyAfter) await deps.applyAfter
  if (!deps.stillWanted()) return EMPTY_GRANTS

  const roles = parseSessionOriginRoles(tags)
  let factsUnread: 'session_tags_unread' | 'session_untagged' | null = null
  if (hasFacts && !roles.projectThreadChild) {
    factsUnread = tags === null ? 'session_tags_unread' : 'session_untagged'
  }

  const modePinned =
    getSettingsForSource('policySettings')?.permissions?.defaultMode !==
    undefined
  const grantRoles = deriveBridgeChildGrantRoles({ roles, modePinned })
  if (attachGate && roles.rcChild && modePinned) {
    logEvent('bridge_rc_child_grants', {
      status:
        'auto_policy_pinned' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  let autoModeGranted = false
  let restoredMode: string | null = null
  if (grantRoles.autoOverSettings) {
    const mode = deps.permission.get().mode
    const inherit = deps.inheritLiftedFrom ?? null
    const soft = mode === 'default' || mode === 'acceptEdits'
    const planLift =
      mode === 'plan' &&
      inherit !== null &&
      deps.permission.get().prePlanMode === inherit
    if ((soft || planLift) && deps.keepChosenMode()) {
      logEvent('bridge_rc_child_grants', {
        status:
          'auto_withheld_mode_chosen' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (planLift) {
      deps.permission.set(ctx => ({ ...ctx, prePlanMode: 'auto' }))
      autoModeGranted = true
      restoredMode = inherit
      logEvent('bridge_rc_child_grants', {
        status:
          'ok' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (!soft) {
      logEvent('bridge_rc_child_grants', {
        status:
          'auto_host_mode_kept' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      const result = setMode(
        'auto',
        deps.permission.get(),
        updater => deps.permission.set(updater),
        'remote_control_attach',
      )
      if (result.ok) {
        autoModeGranted = true
        restoredMode = mode
        logEvent('bridge_rc_child_grants', {
          status:
            'ok' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else {
        logEvent('bridge_rc_child_grants', {
          status:
            'auto_refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
    }
  }

  let seededFacts: string[] = []
  let unsubscribe: (() => void) | null = null
  if (factsUnread !== null) {
    logEvent('bridge_rc_child_grants', {
      status:
        `facts_${factsUnread}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else if (hasFacts) {
    // densable F/X + ea.subscribe + Iu(onRefresh): retract-then-merge on each fire.
    const reseed = (): void => {
      seededFacts = applyAutoModeEnvironmentFacts(
        deps.autoModeEnvironment,
        seededFacts,
      )
    }
    reseed()
    const unsubSettings = settingsChangeDetector.subscribe(() => {
      reseed()
    })
    const unsubGrowthBook = onGrowthBookRefresh(() => {
      reseed()
    })
    unsubscribe = () => {
      unsubSettings()
      unsubGrowthBook()
      // densable undo: H?.() then F([]) — retract held after unsub.
      seededFacts = applyAutoModeEnvironmentFacts([], seededFacts)
    }
  }

  // densable attach: E.artifact && I7n() — stamp only on SDK default-off
  // surfaces. Spawn stamps RQt.artifact without I7n (sessionRunner overlay).
  let artifact = false
  if (grantRoles.artifact && isSdkArtifactDefaultOffEntrypoint()) {
    process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT = '1'
    artifact = true
  }

  // densable ne: E.autoCompact && flagSettings.autoCompactEnabled===undefined →
  // tN({..._y(), autoCompactEnabled:true}) + ea.notifyChange('flagSettings').
  // Do not stamp unread CLAUDE_CODE_BRIDGE_CHILD_AUTO_COMPACT — isAutoCompactEnabled
  // consults settings (Yo) over GlobalConfig, and setFlagSettingsInline is live.
  let autoCompact = false
  let stampedAutoCompactInline = false
  if (
    grantRoles.autoCompact &&
    getSettingsForSource('flagSettings')?.autoCompactEnabled === undefined
  ) {
    const inline = (getFlagSettingsInline() ?? {}) as SettingsJson
    setFlagSettingsInline({
      ...inline,
      autoCompactEnabled: true,
    } as Record<string, unknown>)
    settingsChangeDetector.notifyChange('flagSettings')
    autoCompact = true
    stampedAutoCompactInline = true
  }

  let undone = false
  return {
    granted: {
      autoMode: autoModeGranted,
      facts: seededFacts.length,
      artifact,
      autoCompact,
    },
    undo() {
      if (undone) return null
      undone = true
      unsubscribe?.()
      if (artifact) delete process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT
      if (stampedAutoCompactInline) {
        const inline = (getFlagSettingsInline() ?? {}) as SettingsJson
        if (inline.autoCompactEnabled === true) {
          const { autoCompactEnabled: _cleared, ...rest } = inline
          setFlagSettingsInline(
            Object.keys(rest).length > 0
              ? (rest as Record<string, unknown>)
              : null,
          )
          settingsChangeDetector.notifyChange('flagSettings')
        }
      }
      if (restoredMode !== null) {
        const cur = deps.permission.get()
        if (cur.mode === 'auto') {
          setMode(
            restoredMode as 'default',
            cur,
            updater => deps.permission.set(updater),
            'remote_control_detach',
          )
          return restoredMode
        }
        if (cur.mode === 'plan' && cur.prePlanMode === 'auto') {
          const prior = restoredMode
          deps.permission.set(ctx => ({ ...ctx, prePlanMode: prior as never }))
          return prior
        }
      }
      return null
    },
  }
}
