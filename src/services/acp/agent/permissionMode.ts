import type { PermissionMode } from '../../../types/permissions.js'
import { resolvePermissionMode } from '../utils.js'

export const permissionModeIds: readonly PermissionMode[] = [
  'auto',
  'default',
  'acceptEdits',
  'bypassPermissions',
  'dontAsk',
  'plan',
]

export function isPermissionMode(modeId: string): modeId is PermissionMode {
  return (permissionModeIds as readonly string[]).includes(modeId)
}

export function resolveSessionPermissionMode(
  metaMode: unknown,
  hasMetaMode: boolean,
  settingsMode: unknown,
): PermissionMode {
  if (hasMetaMode) {
    const metaResolved = resolveRequiredPermissionMode(
      metaMode,
      '_meta.permissionMode',
    )
    if (
      metaResolved === 'bypassPermissions' &&
      !isAcpBypassPermissionModeAvailable()
    ) {
      throw new Error(
        'Mode not available: bypassPermissions cannot run as root (start the agent as a non-root user, or set IS_SANDBOX=1).',
      )
    }

    return metaResolved
  }

  const settingsResolved = resolveConfiguredPermissionMode(settingsMode)
  return settingsResolved ?? 'default'
}

function resolveRequiredPermissionMode(
  mode: unknown,
  source: string,
): PermissionMode {
  if (mode === undefined || mode === null) {
    throw new Error(`Invalid ${source}: expected a string.`)
  }

  return resolvePermissionMode(mode, source) as PermissionMode
}

function resolveConfiguredPermissionMode(
  mode: unknown,
): PermissionMode | undefined {
  if (mode === undefined || mode === null) return undefined

  try {
    return resolvePermissionMode(
      mode,
      'permissions.defaultMode',
    ) as PermissionMode
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      '[ACP] Invalid permissions.defaultMode, using default:',
      reason,
    )
    return undefined
  }
}

export function hasOwnField(
  value: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  return !!value && Object.hasOwn(value, key)
}

/**
 * Whether bypassPermissions is selectable by ACP clients.
 *
 * densable: list when the process itself allows bypass — non-root (geteuid/getuid)
 * or IS_SANDBOX. Tip previously added an extra opt-in env/settings gate that made
 * the mode invisible to standard clients; that was removed to match gold listing.
 *
 * Platforms without uid semantics (Windows): densable also falls through when
 * geteuid/getuid are absent — fail-open listable. Do not invent a Windows-only
 * fail-closed gate here.
 */
export function isAcpBypassPermissionModeAvailable(): boolean {
  return isProcessBypassPermissionModeAvailable()
}

function isProcessBypassPermissionModeAvailable(): boolean {
  if (process.env.IS_SANDBOX) return true
  if (typeof process.geteuid === 'function') return process.geteuid() !== 0
  if (typeof process.getuid === 'function') return process.getuid() !== 0
  // densable / Node on win32: no uid APIs → available (fail-open)
  return true
}
