/**
 * densable 2.1.214 #33 — plugins enabled only via `--settings` (flagSettings)
 * must be included in install-record sync (Dhy).
 *
 * densable:
 *   for ([f,m] of Object.entries(Cr("flagSettings")?.enabledPlugins||{})) {
 *     if (m!==true || !valid || r.has(f) || iI(f)) continue
 *     r.set(f,{scope:"user"}); o.add(f)
 *   }
 *   for (f of policyTrue) { r.set(f,{scope:"managed"}); o.delete(f) }
 *
 * Pure helpers for unit tests; migrateFromEnabledPlugins applies them.
 */

export type PluginScopeFromSettings = {
  scope: 'user' | 'project' | 'local' | 'managed'
  projectPath: string | undefined
}

export type EnabledPluginsMap = Record<string, unknown> | undefined | null

function isPluginId(id: string): boolean {
  return id.includes('@')
}

/**
 * densable iI(e): policy force-disabled plugins must not get flag records.
 */
export function isPluginForceDisabledByPolicy(
  pluginId: string,
  policyEnabled: EnabledPluginsMap,
): boolean {
  return policyEnabled?.[pluginId] === false
}

/**
 * Merge editable scopes first (user → project → local), then flag-only
 * (true, not already present, not policy-disabled) as user scope, then
 * policy true as managed (clears flag-only set).
 *
 * Returns scopes map + flag-only ids that need versioned-cache materialize.
 */
export function resolveEnabledPluginScopesForInstallSync(input: {
  user?: EnabledPluginsMap
  project?: EnabledPluginsMap
  local?: EnabledPluginsMap
  flag?: EnabledPluginsMap
  policy?: EnabledPluginsMap
  projectPath: string
}): {
  scopes: Map<string, PluginScopeFromSettings>
  flagOnlyPluginIds: Set<string>
} {
  const scopes = new Map<string, PluginScopeFromSettings>()
  const flagOnlyPluginIds = new Set<string>()

  const applyEditable = (
    map: EnabledPluginsMap,
    scope: 'user' | 'project' | 'local',
  ): void => {
    if (!map) return
    for (const pluginId of Object.keys(map)) {
      if (!isPluginId(pluginId)) continue
      scopes.set(pluginId, {
        scope,
        projectPath: scope === 'user' ? undefined : input.projectPath,
      })
    }
  }

  applyEditable(input.user, 'user')
  applyEditable(input.project, 'project')
  applyEditable(input.local, 'local')

  const policy = input.policy || {}
  for (const [pluginId, value] of Object.entries(input.flag || {})) {
    if (value !== true) continue
    if (!isPluginId(pluginId)) continue
    if (scopes.has(pluginId)) continue
    if (isPluginForceDisabledByPolicy(pluginId, policy)) continue
    scopes.set(pluginId, { scope: 'user', projectPath: undefined })
    flagOnlyPluginIds.add(pluginId)
  }

  for (const [pluginId, value] of Object.entries(policy)) {
    if (value !== true) continue
    if (!isPluginId(pluginId)) continue
    scopes.set(pluginId, { scope: 'managed', projectPath: undefined })
    flagOnlyPluginIds.delete(pluginId)
  }

  return { scopes, flagOnlyPluginIds }
}

/**
 * densable early exit uses per-source maps, not only merged settings.
 * If flag/policy declare plugins, sync must still run even when merged
 * enabledPlugins is empty (or not yet hydrated).
 */
export function shouldRunEnabledPluginsInstallSync(
  mergedEnabledPlugins: EnabledPluginsMap,
  flagEnabled: EnabledPluginsMap,
  policyEnabled: EnabledPluginsMap,
): boolean {
  if (mergedEnabledPlugins && Object.keys(mergedEnabledPlugins).length > 0) {
    return true
  }
  for (const [id, v] of Object.entries(flagEnabled || {})) {
    if (v === true && isPluginId(id)) return true
  }
  for (const [id, v] of Object.entries(policyEnabled || {})) {
    if (v === true && isPluginId(id)) return true
  }
  return false
}
