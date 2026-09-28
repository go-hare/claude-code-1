/**
 * Plugin option storage and substitution.
 *
 * Plugins declare user-configurable options in `manifest.userConfig` — a record
 * of field schemas matching `McpbUserConfigurationOption`. At enable time the
 * user is prompted for values. Storage splits by `sensitive`:
 *   - `sensitive: true`  → secureStorage (keychain on macOS, .credentials.json elsewhere)
 *   - everything else    → settings.json `pluginConfigs[pluginId].options`
 *
 * `loadPluginOptions` reads and merges both. The substitution helpers are also
 * here (moved from mcpPluginIntegration.ts) so hooks/LSP/skills don't all
 * import from MCP-specific code.
 */

import memoize from 'lodash-es/memoize.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { getSecureStorage } from '../secureStorage/index.js'
import {
  getSettingsForSource,
  persistSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import {
  type UserConfigSchema,
  type UserConfigValues,
  validateUserConfig,
} from './mcpbHandler.js'
import {
  loadPluginConfigFromAllowedSources,
  pluginConfigIdAliases,
} from './pluginConfigSources.js'
import { getPluginDataDir } from './pluginDirectories.js'

export type PluginOptionValues = UserConfigValues
export type PluginOptionSchema = UserConfigSchema

export {
  loadPluginConfigFromAllowedSources,
  PLUGIN_CONFIG_SETTING_SOURCES,
} from './pluginConfigSources.js'

/**
 * Canonical storage key for a plugin's options in both `settings.pluginConfigs`
 * and `secureStorage.pluginSecrets`. Today this is `plugin.source` — always
 * `"${name}@${marketplace}"` (pluginLoader.ts:1400). `plugin.repository` is
 * a backward-compat alias that's set to the same string (1401); don't use it
 * for storage. UI code that manually constructs `` `${name}@${marketplace}` ``
 * produces the same key by convention — see PluginOptionsFlow, ManagePlugins.
 *
 * Exists so there's exactly one place to change if the key format ever drifts.
 */
export function getPluginStorageId(plugin: LoadedPlugin): string {
  return plugin.source
}

/**
 * Load saved option values for a plugin, merging non-sensitive (from settings)
 * with sensitive (from secureStorage). SecureStorage wins on key collision.
 *
 * Memoized per-pluginId because hooks can fire per-tool-call and each call
 * would otherwise do a settings read + keychain spawn. Cache cleared via
 * `clearPluginOptionsCache` when settings change or plugins reload.
 */
export const loadPluginOptions = memoize(
  (pluginId: string): PluginOptionValues => {
    // Official 2.1.207: do not read project/local settings for pluginConfigs.
    const nonSensitive =
      loadPluginConfigFromAllowedSources(pluginId).options ??
      ({} as PluginOptionValues)

    // NOTE: storage.read() spawns `security find-generic-password` on macOS
    // (~50-100ms, synchronous). Mitigated by the memoize above (per-pluginId,
    // session-lifetime) + keychain's own 30s TTL cache — so one blocking spawn
    // per session per plugin-with-options. /reload-plugins clears the memoize
    // and the next hook/MCP-load after that eats a fresh spawn.
    const storage = getSecureStorage()
    const sensitive =
      storage.read()?.pluginSecrets?.[pluginId] ??
      ({} as Record<string, string>)

    // secureStorage wins on collision — schema determines destination so
    // collision shouldn't happen, but if a user hand-edits settings.json we
    // trust the more secure source.
    return { ...nonSensitive, ...sensitive }
  },
)

/**
 * densable `q0` / `ct` — settings options + `Un().readAsync(credentials)`
 * pluginSecrets. Promise-memoized per pluginId (`dt().optionValues`); reject
 * drops the cache entry so the next call retries.
 */
const optionValues = new Map<string, Promise<PluginOptionValues>>()

export function loadPluginOptionsNw(
  pluginId: string,
  credentials?: unknown,
): Promise<PluginOptionValues> {
  const cached = optionValues.get(pluginId)
  if (cached !== undefined) {
    return cached
  }
  const pending = loadPluginOptionsCt(pluginId, credentials)
  optionValues.set(pluginId, pending)
  pending.catch(() => {
    if (optionValues.get(pluginId) === pending) {
      optionValues.delete(pluginId)
    }
  })
  return pending
}

async function loadPluginOptionsCt(
  pluginId: string,
  credentials?: unknown,
): Promise<PluginOptionValues> {
  const nonSensitive =
    loadPluginConfigFromAllowedSources(pluginId).options ??
    ({} as PluginOptionValues)
  const storage = getSecureStorage()
  const data =
    typeof storage.readAsync === 'function'
      ? await storage.readAsync(credentials)
      : storage.read()
  return {
    ...nonSensitive,
    ...((data?.pluginSecrets?.[pluginId] ?? {}) as PluginOptionValues),
  }
}

export function clearPluginOptionsCache(): void {
  loadPluginOptions.cache?.clear?.()
  optionValues.clear()
}

async function mutatePluginSecrets(
  mutator: (data: {
    pluginSecrets?: Record<string, unknown>
  }) => {
    pluginSecrets?: Record<string, unknown>
  },
  credentials?: unknown,
): Promise<{ success: boolean; warning?: string }> {
  const storage = getSecureStorage()
  const mutate = storage.mutate as
    | ((
        fn: typeof mutator,
        creds?: unknown,
      ) => Promise<{ success: boolean; warning?: string }> | { success: boolean; warning?: string })
    | undefined
  if (typeof mutate === 'function') {
    return await mutate(mutator, credentials)
  }
  const existing = storage.read() ?? {}
  const next = mutator(existing)
  if (next === existing) {
    return { success: true }
  }
  return storage.update(next)
}

/**
 * densable `BVe` — save option values, splitting by `schema[key].sensitive`.
 * Sensitive → `Un().mutate(..., credentials)`; non-sensitive →
 * `persistSettingsForSource('userSettings', …, storageV5)` with `tce` aliases.
 */
export async function savePluginOptions(
  pluginId: string,
  values: PluginOptionValues,
  schema: PluginOptionSchema,
  storageV5?: unknown,
  credentials?: unknown,
): Promise<void> {
  const nonSensitive: PluginOptionValues = {}
  const sensitive: Record<string, string> = {}

  for (const [key, value] of Object.entries(values)) {
    if (schema[key]?.sensitive === true) {
      sensitive[key] = String(value)
    } else {
      nonSensitive[key] = value
    }
  }

  const sensitiveKeysInThisSave = new Set(Object.keys(sensitive))
  const nonSensitiveKeysInThisSave = new Set(Object.keys(nonSensitive))

  const result = await mutatePluginSecrets(data => {
    const existing = data.pluginSecrets?.[pluginId] as
      | Record<string, string>
      | undefined
    const scrubbed = existing
      ? Object.fromEntries(
          Object.entries(existing).filter(
            ([k]) => !nonSensitiveKeysInThisSave.has(k),
          ),
        )
      : undefined
    const needSecureScrub =
      scrubbed !== undefined &&
      existing !== undefined &&
      Object.keys(scrubbed).length !== Object.keys(existing).length
    if (Object.keys(sensitive).length === 0 && !needSecureScrub) {
      return data
    }
    return {
      ...data,
      pluginSecrets: {
        ...data.pluginSecrets,
        [pluginId]: {
          ...scrubbed,
          ...sensitive,
        },
      },
    }
  }, credentials)
  if (!result.success) {
    const err = new Error(
      `Failed to save sensitive plugin options for ${pluginId} to secure storage`,
    )
    logError(err)
    throw err
  }
  if (result.warning) {
    logForDebugging(`Plugin secrets save warning: ${result.warning}`, {
      level: 'warn',
    })
  }

  const pluginConfigs = getSettingsForSource('userSettings')?.pluginConfigs
  const patch: Record<string, { options: PluginOptionValues }> = {}
  for (const alias of pluginConfigIdAliases(pluginId)) {
    const keysToScrub = Object.keys(
      pluginConfigs?.[alias]?.options ?? {},
    ).filter(k => sensitiveKeysInThisSave.has(k))
    const scrubbed = Object.fromEntries(keysToScrub.map(k => [k, undefined]))
    const written = alias === pluginId ? nonSensitive : {}
    if (Object.keys(written).length > 0 || keysToScrub.length > 0) {
      patch[alias] = {
        options: {
          ...written,
          ...scrubbed,
        } as PluginOptionValues,
      }
    }
  }
  if (Object.keys(patch).length > 0) {
    const persisted = await persistSettingsForSource(
      'userSettings',
      { pluginConfigs: patch },
      undefined,
      storageV5,
    )
    if (persisted.error) {
      logForDebugging(
        `Failed to save plugin options for ${pluginId} to settings.json: ${errorMessage(persisted.error)}`,
        { level: 'error' },
      )
      throw new Error(
        `Failed to save plugin options for ${pluginId}: ${persisted.error.message}`,
      )
    }
  }

  clearPluginOptionsCache()
}

/**
 * Delete all stored option values for a plugin — both the non-sensitive
 * `settings.pluginConfigs[pluginId]` entry and the sensitive
 * `secureStorage.pluginSecrets[pluginId]` entry.
 *
 * Call this when the LAST installation of a plugin is uninstalled (i.e.,
 * alongside `markPluginVersionOrphaned`). Don't call on every uninstall —
 * a plugin can be installed in multiple scopes and the user's config should
 * survive removing it from one scope while it remains in another.
 *
 * Best-effort: keychain write failure is logged but doesn't throw, since
 * the uninstall itself succeeded and we don't want to surface a confusing
 * "uninstall failed" message for a cleanup side-effect.
 */
export async function deletePluginOptions(
  pluginId: string,
  storageV5?: unknown,
  credentials?: unknown,
): Promise<void> {
  // Settings side — also wipes the legacy mcpServers sub-key (same story:
  // orphaned on uninstall, never cleaned up before this PR).
  //
  // Use `undefined` (not `delete`) because `updateSettingsForSource` merges
  // via `mergeWith` — absent keys are ignored, only `undefined` triggers
  // removal. Cast is deliberate (CLAUDE.md's 10% case): adding z.undefined()
  // to the schema instead (like enabledPlugins:466 does) leaks
  // `| {[k: string]: unknown}` into the public SDK type, which subsumes the
  // real object arm and kills excess-property checks for SDK consumers. The
  // mergeWith-deletion contract is internal plumbing — it shouldn't shape
  // the Zod schema. enabledPlugins gets away with it only because its other
  // arms (string[] | boolean) are non-objects that stay distinct.
  // Only clear userSettings — project/local never own pluginConfigs (2.1.207).
  const userSettings = getSettingsForSource('userSettings')
  type PluginConfigs = NonNullable<
    NonNullable<typeof userSettings>['pluginConfigs']
  >
  if (userSettings?.pluginConfigs?.[pluginId]) {
    // Partial<Record<K,V>> = Record<K, V | undefined> — gives us the widening
    // for the undefined value, and Partial-of-X overlaps with X so the cast
    // is a narrowing TS accepts (same approach as marketplaceManager.ts:1795).
    const pluginConfigs: Partial<PluginConfigs> = { [pluginId]: undefined }
    const { error } = await persistSettingsForSource(
      'userSettings',
      {
        pluginConfigs: pluginConfigs as PluginConfigs,
      },
      undefined,
      storageV5,
    )
    if (error) {
      logForDebugging(
        `deletePluginOptions: failed to clear settings.pluginConfigs[${pluginId}]: ${error.message}`,
        { level: 'warn' },
      )
    }
  }

  // Secure storage side — delete both the top-level pluginSecrets[pluginId]
  // and any per-server composite keys `${pluginId}/${server}` (from
  // saveMcpServerUserConfig's sensitive split). `/` prefix match is safe:
  // plugin IDs are `name@marketplace`, never contain `/`, so
  // startsWith(`${id}/`) can't false-positive on a different plugin.
  try {
    const storage = getSecureStorage()
    const prefix = `${pluginId}/`
    const mutator = (data: {
      pluginSecrets?: Record<string, unknown>
    }): typeof data => {
      if (!data.pluginSecrets) return data
      const survivingEntries = Object.entries(data.pluginSecrets).filter(
        ([k]) => k !== pluginId && !k.startsWith(prefix),
      )
      if (survivingEntries.length === Object.keys(data.pluginSecrets).length) {
        return data
      }
      return {
        ...data,
        pluginSecrets:
          survivingEntries.length > 0
            ? Object.fromEntries(survivingEntries)
            : undefined,
      }
    }
    const mutate = storage.mutate as
      | ((
          fn: typeof mutator,
          creds?: unknown,
        ) => Promise<{ success: boolean }> | { success: boolean })
      | undefined
    const result =
      typeof mutate === 'function'
        ? await mutate(mutator, credentials)
        : (() => {
            const existing = storage.read() ?? {}
            const next = mutator(existing)
            if (next === existing) return { success: true }
            return storage.update(next)
          })()
    if (!result.success) {
      logForDebugging(
        `deletePluginOptions: failed to clear pluginSecrets for ${pluginId} from keychain`,
        { level: 'warn' },
      )
    }
  } catch (error) {
    logForDebugging(
      `deletePluginOptions: storage lock unavailable for ${pluginId}: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }

  clearPluginOptionsCache()
}

/**
 * densable `sst` — schema slice for keys that still need prompting.
 * Sensitive fields are unconfigured only when missing/empty; non-sensitive
 * also re-validate via `Rme` / `validateUserConfig`.
 */
export async function getUnconfiguredOptions(
  plugin: LoadedPlugin,
  credentials?: unknown,
): Promise<PluginOptionSchema> {
  const manifestSchema = plugin.manifest.userConfig
  if (!manifestSchema || Object.keys(manifestSchema).length === 0) {
    return {}
  }

  const saved = await loadPluginOptionsNw(getPluginStorageId(plugin), credentials)
  const unconfigured: PluginOptionSchema = {}
  for (const [key, fieldSchema] of Object.entries(manifestSchema)) {
    const value = saved[key]
    if (
      value === undefined ||
      value === '' ||
      (fieldSchema.sensitive !== true &&
        !validateUserConfig(
          { [key]: value } as PluginOptionValues,
          { [key]: fieldSchema },
        ).valid)
    ) {
      unconfigured[key] = fieldSchema
    }
  }
  return unconfigured
}

/**
 * Substitute ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_DATA} with their paths.
 * On Windows, normalizes backslashes to forward slashes so shell commands
 * don't interpret them as escape characters.
 *
 * ${CLAUDE_PLUGIN_ROOT} — version-scoped install dir (recreated on update)
 * ${CLAUDE_PLUGIN_DATA} — persistent state dir (survives updates)
 *
 * Both patterns use the function-replacement form of .replace(): ROOT so
 * `$`-patterns in NTFS paths ($$, $', $`, $&) aren't interpreted; DATA so
 * getPluginDataDir (which lazily mkdirs) only runs when actually present.
 *
 * Used in MCP/LSP server command/args/env, hook commands, skill/agent content.
 */
export function substitutePluginVariables(
  value: string,
  plugin: { path: string; source?: string },
): string {
  const normalize = (p: string) =>
    process.platform === 'win32' ? p.replace(/\\/g, '/') : p
  let out = value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () =>
    normalize(plugin.path),
  )
  // source can be absent (e.g. hooks where pluginRoot is a skill root without
  // a plugin context). In that case ${CLAUDE_PLUGIN_DATA} is left literal.
  if (plugin.source) {
    const source = plugin.source
    out = out.replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, () =>
      normalize(getPluginDataDir(source)),
    )
  }
  return out
}

/**
 * Substitute ${user_config.KEY} with saved option values.
 *
 * Throws on missing keys — callers pass this only after `validateUserConfig`
 * succeeded, so a miss here means a plugin references a key it never declared
 * in its schema. That's a plugin authoring bug; failing loud surfaces it.
 *
 * Use `substituteUserConfigInContent` for skill/agent prose — it handles
 * missing keys and sensitive-filtering instead of throwing.
 */
export function substituteUserConfigVariables(
  value: string,
  userConfig: PluginOptionValues,
): string {
  return value.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key) => {
    const configValue = userConfig[key]
    if (configValue === undefined) {
      throw new Error(
        `Missing required user configuration value: ${key}. ` +
          `This should have been validated before variable substitution.`,
      )
    }
    return String(configValue)
  })
}

/**
 * Content-safe variant for skill/agent prose. Differences from
 * `substituteUserConfigVariables`:
 *
 *   - Sensitive-marked keys substitute to a descriptive placeholder instead of
 *     the actual value — skill/agent content goes to the model prompt, and
 *     we don't put secrets in the model's context.
 *   - Unknown keys stay literal (no throw) — matches how `${VAR}` env refs
 *     behave today when the var is unset.
 *
 * A ref to a sensitive key produces obvious-looking output so plugin authors
 * notice and move the ref into a hook/MCP env instead.
 */
export function substituteUserConfigInContent(
  content: string,
  options: PluginOptionValues,
  schema: PluginOptionSchema,
): string {
  return content.replace(/\$\{user_config\.([^}]+)\}/g, (match, key) => {
    if (schema[key]?.sensitive === true) {
      return `[sensitive option '${key}' not available in skill content]`
    }
    const value = options[key]
    if (value === undefined) {
      return match
    }
    return String(value)
  })
}
