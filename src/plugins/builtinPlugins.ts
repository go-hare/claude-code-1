/**
 * Built-in Plugin Registry
 *
 * Manages built-in plugins that ship with the CLI and can be enabled/disabled
 * by users via the /plugin UI.
 *
 * Built-in plugins differ from bundled skills (src/skills/bundled/) in that:
 * - They appear in the /plugin UI under a "Built-in" section
 * - Users can enable/disable them (persisted to user settings)
 * - They can provide multiple components (skills, hooks, MCP servers)
 *
 * Plugin IDs use the format `{name}@builtin` to distinguish them from
 * marketplace plugins (`{name}@{marketplace}`).
 */

import type { Command } from '../commands.js'
import type { BundledSkillDefinition } from '../skills/bundledSkills.js'
import type { BuiltinPluginDefinition, LoadedPlugin } from '../types/plugin.js'
import { errorMessage, toError } from '../utils/errors.js'
import {
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
} from '../utils/sessionHost.js'
import {
  getEnabledSettingSources,
  type SettingSource,
} from '../utils/settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../utils/settings/settings.js'

export type BuiltinPluginFailurePhase =
  | 'require'
  | 'shape'
  | 'register'
  | 'is_available'

export type BuiltinPluginFailure = {
  name: string
  phase: BuiltinPluginFailurePhase
  message: string
}

type BuiltinPluginsHostState = {
  plugins: Map<string, BuiltinPluginDefinition>
  initialized: boolean | undefined
  failures: Map<string, BuiltinPluginFailure>
  wiredSkills: WeakMap<
    BundledSkillDefinition,
    {
      skillRoot: string | undefined
      getPromptForCommand: BundledSkillDefinition['getPromptForCommand']
    }
  >
  /** True when clearBuiltinPlugins() was called explicitly in an isolated host. */
  cleared: boolean
  /** Names explicitly removed in this host (e.g. failed register phase). */
  deletedPlugins: Set<string>
}

// Boot-default catalog populated whenever registration runs outside ALS (on the
// process-default host, e.g. startup initBuiltinPlugins()). Fresh isolated hosts
// (such as --acp sessions) inherit this catalog while evaluating isAvailable()
// and settings per host and still allowing per-host test overrides/clears.
const bootDefaultPlugins = new Map<string, BuiltinPluginDefinition>()
let bootDefaultInitialized = false
const bootDefaultFailures = new Map<string, BuiltinPluginFailure>()

const builtinPluginsHostSlot = new HostSlot<BuiltinPluginsHostState>(() => ({
  plugins: new Map(bootDefaultPlugins),
  initialized: undefined,
  failures: new Map(bootDefaultFailures),
  wiredSkills: new WeakMap(),
  cleared: false,
  deletedPlugins: new Set(),
}))

function getBuiltinPluginsHostState(): BuiltinPluginsHostState {
  return builtinPluginsHostSlot.of(getBootstrapSessionHost())
}

function getEffectiveBuiltinPlugins(
  hostState: BuiltinPluginsHostState,
): ReadonlyMap<string, BuiltinPluginDefinition> {
  if (hostState.cleared || bootDefaultPlugins.size === 0) {
    return hostState.plugins
  }
  const merged = new Map<string, BuiltinPluginDefinition>()
  for (const [name, def] of bootDefaultPlugins) {
    if (!hostState.deletedPlugins.has(name)) {
      merged.set(name, def)
    }
  }
  for (const [name, def] of hostState.plugins) {
    merged.set(name, def)
  }
  return merged
}

function getEffectiveBuiltinPluginFailures(
  hostState: BuiltinPluginsHostState,
): ReadonlyMap<string, BuiltinPluginFailure> {
  if (hostState.cleared || bootDefaultFailures.size === 0) {
    return hostState.failures
  }
  let missingBoot = false
  for (const key of bootDefaultFailures.keys()) {
    if (!hostState.failures.has(key)) {
      missingBoot = true
      break
    }
  }
  if (!missingBoot) return hostState.failures
  const merged = new Map<string, BuiltinPluginFailure>(bootDefaultFailures)
  for (const [name, failure] of hostState.failures) {
    merged.set(name, failure)
  }
  return merged
}

export const BUILTIN_MARKETPLACE_NAME = 'builtin'

/**
 * densable externalized short-id → canonical `cc-plugin-*` name map (`A` / `dvn` / `mk`).
 */
const EXTERNAL_BUILTIN_SHORT_TO_CANONICAL = new Map<string, string>([
  ['responsive-mode', 'cc-plugin-responsive-mode'],
  ['tips', 'cc-plugin-tips'],
  ['mermaid', 'cc-plugin-mermaid'],
  ['claude-test', 'cc-plugin-claude-test'],
  ['agents-md', 'cc-plugin-agents-md'],
  ['diff', 'cc-plugin-diff'],
  ['telemetry', 'cc-plugin-telemetry'],
  ['plugin-authoring', 'cc-plugin-plugin-authoring'],
  ['sec-default', 'cc-plugin-sec-default'],
])

const TRUSTED_BUILTIN_SETTING_SOURCES: readonly SettingSource[] = [
  'userSettings',
  'flagSettings',
  'policySettings',
]

export function normalizeCanonicalBuiltinPluginId(pluginId: string): string {
  const at = pluginId.lastIndexOf('@')
  if (at <= 0) return pluginId
  const rawName = pluginId.slice(0, at)
  const rawMarket = pluginId.slice(at + 1)
  if (rawMarket.toLowerCase() !== BUILTIN_MARKETPLACE_NAME) return pluginId
  const canonical =
    EXTERNAL_BUILTIN_SHORT_TO_CANONICAL.get(rawName) ??
    EXTERNAL_BUILTIN_SHORT_TO_CANONICAL.get(rawName.toLowerCase()) ??
    rawName
  return `${canonical}@${BUILTIN_MARKETPLACE_NAME}`
}

function legacyBuiltinPluginIdsFor(pluginId: string): string[] {
  const normalized = normalizeCanonicalBuiltinPluginId(pluginId)
  const suffix = `@${BUILTIN_MARKETPLACE_NAME}`
  if (!normalized.endsWith(suffix)) return []
  const canonicalName = normalized.slice(0, -suffix.length)
  const shorts: string[] = []
  for (const [shortName, target] of EXTERNAL_BUILTIN_SHORT_TO_CANONICAL) {
    if (target === canonicalName || target === canonicalName.toLowerCase()) {
      shorts.push(`${shortName}@${BUILTIN_MARKETPLACE_NAME}`)
    }
  }
  return shorts.toReversed()
}

/**
 * densable short namespace name for `@builtin` MCP servers & agents
 * (`cc-plugin-claude-test` + `cc-plugin-claude-test@builtin` → `claude-test`).
 */
export function externalBuiltinNamespaceName(
  pluginName: string,
  pluginSource: string,
): string {
  const suffix = `@${BUILTIN_MARKETPLACE_NAME}`
  if (!pluginSource.endsWith(suffix)) return pluginName
  for (const [shortName, target] of EXTERNAL_BUILTIN_SHORT_TO_CANONICAL) {
    if (target === pluginName || target === pluginName.toLowerCase()) {
      return shortName
    }
  }
  const normalized = normalizeCanonicalBuiltinPluginId(`${pluginName}${suffix}`)
  return normalized.endsWith(suffix)
    ? normalized.slice(0, -suffix.length)
    : pluginName
}

function lookupBuiltinEnabledPluginsValue(
  enabledPlugins: Record<string, unknown> | undefined,
  pluginId: string,
): unknown {
  if (!enabledPlugins) return undefined
  const canonical = normalizeCanonicalBuiltinPluginId(pluginId)
  for (const key of [
    canonical,
    ...legacyBuiltinPluginIdsFor(canonical),
    pluginId,
  ]) {
    const val = enabledPlugins[key]
    if (val !== undefined) return val
  }
  return undefined
}

function resolveTrustedBuiltinPluginSetting(pluginId: string): unknown {
  const active = new Set(getEnabledSettingSources())
  let result: unknown
  for (const src of TRUSTED_BUILTIN_SETTING_SOURCES) {
    if (!active.has(src)) continue
    const found = lookupBuiltinEnabledPluginsValue(
      getSettingsForSource(src)?.enabledPlugins,
      pluginId,
    )
    if (found !== undefined) result = found
  }
  return result
}

/**
 * densable `rGt` — precedence-ordered `Fz(ge(src)?.enabledPlugins, id)`.
 */
export function resolveBuiltinPluginEnabledSetting(pluginId: string): unknown {
  const sources = getEnabledSettingSources()
  for (let i = sources.length - 1; i >= 0; i--) {
    const src = sources[i]
    if (src === undefined) continue
    const found = lookupBuiltinEnabledPluginsValue(
      getSettingsForSource(src)?.enabledPlugins,
      pluginId,
    )
    if (found !== undefined) return found
  }
  return undefined
}

function describeInvalidBuiltinModule(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'object') {
    return `an object with keys [${Object.keys(value).join(', ')}]`
  }
  return `a ${typeof value}`
}

function recordBuiltinPluginFailure(
  name: string,
  phase: BuiltinPluginFailurePhase,
  error: unknown,
): void {
  const hostState = getBuiltinPluginsHostState()
  if (getEffectiveBuiltinPluginFailures(hostState).has(name)) return
  const failure: BuiltinPluginFailure = {
    name,
    phase,
    message: errorMessage(error),
  }
  hostState.failures.set(name, failure)
  if (!hasActiveSessionAls()) {
    bootDefaultFailures.set(name, failure)
  }
  try {
    const { logError } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/log.js') as typeof import('../utils/log.js')
    logError(toError(error))
  } catch {
    // log optional during early init
  }
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
    type Meta =
      import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    // leftover m — tengu_feature_bad (not leftover p / tengu_feature_sad)
    logEvent('tengu_feature_bad', {
      feature_name: 'plugin_bundled_register' as Meta,
      error_code: phase as Meta,
    })
  } catch {
    // analytics optional during early init
  }
}

export function isBuiltinPluginsInitialized(): boolean {
  const hostState = getBuiltinPluginsHostState()
  if (hostState.initialized !== undefined) return hostState.initialized
  return hostState.cleared ? false : bootDefaultInitialized
}

export function markBuiltinPluginsInitialized(): void {
  getBuiltinPluginsHostState().initialized = true
  if (!hasActiveSessionAls()) {
    bootDefaultInitialized = true
  }
}

export function getBuiltinPluginFailures(): ReadonlyMap<
  string,
  BuiltinPluginFailure
> {
  return getEffectiveBuiltinPluginFailures(getBuiltinPluginsHostState())
}

/**
 * densable `yfe(e, o)` — 3-phase isolated builtin module registration.
 */
export function registerBuiltinPluginModule(
  name: string,
  loader: () => unknown,
): void {
  let raw: unknown
  try {
    raw = loader()
  } catch (err) {
    recordBuiltinPluginFailure(name, 'require', err)
    return
  }
  let shaped: { registerPlugin: () => void }
  try {
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'registerPlugin' in raw &&
      typeof (raw as { registerPlugin?: unknown }).registerPlugin === 'function'
    ) {
      shaped = raw as { registerPlugin: () => void }
    } else {
      throw new Error(
        `a built-in module has no registerPlugin function: ${describeInvalidBuiltinModule(raw)}`,
      )
    }
  } catch (err) {
    recordBuiltinPluginFailure(name, 'shape', err)
    return
  }
  try {
    shaped.registerPlugin()
  } catch (err) {
    const hostState = getBuiltinPluginsHostState()
    hostState.plugins.delete(name)
    hostState.deletedPlugins.add(name)
    if (!hasActiveSessionAls()) {
      bootDefaultPlugins.delete(name)
    }
    recordBuiltinPluginFailure(name, 'register', err)
  }
}

/**
 * densable `A5r(e)` — guarded `isAvailable()` check with failure recording.
 */
export function isBuiltinPluginAvailable(name: string): boolean {
  const hostState = getBuiltinPluginsHostState()
  const definition = getBuiltinPluginDefinition(name)
  if (
    definition === undefined ||
    getEffectiveBuiltinPluginFailures(hostState).has(name)
  ) {
    return false
  }
  if (definition.isAvailable === undefined) return true
  try {
    return definition.isAvailable()
  } catch (err) {
    recordBuiltinPluginFailure(name, 'is_available', err)
    return false
  }
}

/**
 * Register a built-in plugin. Call this from initBuiltinPlugins() at startup.
 */
export function registerBuiltinPlugin(
  definition: BuiltinPluginDefinition,
): void {
  const hostState = getBuiltinPluginsHostState()
  hostState.deletedPlugins.delete(definition.name)
  hostState.plugins.set(definition.name, definition)
  if (!hasActiveSessionAls()) {
    bootDefaultPlugins.set(definition.name, definition)
  }
  try {
    const { leftoverUs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/plugins/functionHooksModules.js') as typeof import('../utils/plugins/functionHooksModules.js')
    leftoverUs(definition)
  } catch {
    // function-hooks host optional at register
  }
}

/**
 * Check if a plugin ID represents a built-in plugin (ends with @builtin).
 */
export function isBuiltinPluginId(pluginId: string): boolean {
  return pluginId.endsWith(`@${BUILTIN_MARKETPLACE_NAME}`)
}

/**
 * Get a specific built-in plugin definition by name.
 * Useful for the /plugin UI to show the skills/hooks/MCP list without
 * a marketplace lookup.
 */
export function getBuiltinPluginDefinition(
  name: string,
): BuiltinPluginDefinition | undefined {
  const hostState = getBuiltinPluginsHostState()
  const local = hostState.plugins.get(name)
  if (local !== undefined) return local
  if (hostState.cleared || hostState.deletedPlugins.has(name)) return undefined
  return bootDefaultPlugins.get(name)
}

/**
 * Get all registered built-in plugins as LoadedPlugin objects, split into
 * enabled/disabled based on user settings (with defaultEnabled as fallback).
 * Plugins whose isAvailable() returns false are omitted entirely.
 */
export function getBuiltinPlugins(): {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
} {
  const settings = getSettings_DEPRECATED()
  const enabled: LoadedPlugin[] = []
  const disabled: LoadedPlugin[] = []

  for (const [name, definition] of getEffectiveBuiltinPlugins(
    getBuiltinPluginsHostState(),
  )) {
    if (!isBuiltinPluginAvailable(name)) {
      continue
    }

    const pluginId = `${name}@${BUILTIN_MARKETPLACE_NAME}`
    const hasLegacyAliases = legacyBuiltinPluginIdsFor(pluginId).length > 0
    // gold PZ:
    // i=n.enabledFromPolicyOnly?Fz(ge("policySettings")?.enabledPlugins,s)
    //  :n.enabledFromTrustedSettingsOnly?avn(s)
    //  :!p?e?.enabledPlugins?.[s]:rGt(s)
    let userSetting: unknown
    if (definition.enabledFromPolicyOnly) {
      userSetting = lookupBuiltinEnabledPluginsValue(
        getSettingsForSource('policySettings')?.enabledPlugins,
        pluginId,
      )
    } else if (definition.enabledFromTrustedSettingsOnly) {
      userSetting = resolveTrustedBuiltinPluginSetting(pluginId)
    } else if (!hasLegacyAliases) {
      userSetting = settings?.enabledPlugins?.[pluginId]
    } else {
      userSetting = resolveBuiltinPluginEnabledSetting(pluginId)
    }
    // Enabled state: user preference > plugin default > true
    const isEnabled =
      userSetting !== undefined
        ? userSetting === true
        : (definition.defaultEnabled ?? true)

    const plugin: LoadedPlugin = {
      name,
      manifest: {
        name,
        description: definition.description,
        version: definition.version,
        ...(definition.defaultEnabled === undefined
          ? {}
          : { defaultEnabled: definition.defaultEnabled }),
        ...(definition.userConfig ? { userConfig: definition.userConfig } : {}),
      },
      path: BUILTIN_MARKETPLACE_NAME, // sentinel — no filesystem path
      source: pluginId,
      repository: pluginId,
      enabled: isEnabled,
      isBuiltin: true,
      hooksConfig: definition.hooks,
      mcpServers: definition.mcpServers,
      ...(definition.hooksModule === undefined
        ? {}
        : leftoverLhForBuiltin(name, definition.hooksModule)),
    }

    if (isEnabled) {
      enabled.push(plugin)
    } else {
      disabled.push(plugin)
    }
  }

  return { enabled, disabled }
}

/**
 * Get skills from enabled built-in plugins as Command objects.
 * Skills from disabled plugins are not returned.
 */
export function getBuiltinPluginSkillCommands(): Command[] {
  const { enabled } = getBuiltinPlugins()
  const plugins = getEffectiveBuiltinPlugins(getBuiltinPluginsHostState())
  const commands: Command[] = []

  for (const plugin of enabled) {
    const definition = plugins.get(plugin.name)
    if (!definition?.skills) continue
    for (const skill of definition.skills) {
      commands.push(skillDefinitionToCommand(skill))
    }
  }

  return commands
}

/**
 * Clear built-in plugins registry (for testing).
 */
export function clearBuiltinPlugins(): void {
  const hostState = getBuiltinPluginsHostState()
  hostState.plugins.clear()
  hostState.initialized = false
  hostState.failures.clear()
  hostState.deletedPlugins.clear()
  hostState.wiredSkills = new WeakMap()
  if (hasActiveSessionAls()) {
    hostState.cleared = true
  } else {
    hostState.cleared = false
    bootDefaultPlugins.clear()
    bootDefaultInitialized = false
    bootDefaultFailures.clear()
  }
}

// --

/**
 * densable PZ spreads Lh onto LoadedPlugin when hooksModule is set.
 * leftoverLh stays in functionHooksModules (optional at register).
 */
function leftoverLhForBuiltin(
  name: string,
  hooks: NonNullable<BuiltinPluginDefinition['hooksModule']>,
): { path: string; modulePath: string } {
  try {
    const { leftoverLh } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/plugins/functionHooksModules.js') as typeof import('../utils/plugins/functionHooksModules.js')
    return leftoverLh(name, hooks)
  } catch {
    return {
      path: BUILTIN_MARKETPLACE_NAME,
      modulePath: `builtin:${name}/hooks/register.ts`,
    }
  }
}

/**
 * densable Wh skill extras copied onto Command. Kept here (not command.ts)
 * so builtinPlugins.ts stays the only production file in this wrap.
 */
type BuiltinPluginSkillPolicyGate = { policy: string }

type BuiltinPluginSkillCommand = Command & {
  disableBridgeInvocation?: boolean
  terminalOriented?: boolean
  policyGate?: BuiltinPluginSkillPolicyGate
}

type BuiltinPluginBundledSkill = Omit<
  BundledSkillDefinition,
  | 'description'
  | 'menuDescription'
  | 'argumentHint'
  | 'whenToUse'
  | 'disableModelInvocation'
> & {
  description: string | (() => string)
  menuDescription?: string | (() => string)
  argumentHint?: string | (() => string)
  whenToUse?: string | (() => string)
  disableModelInvocation?: boolean | (() => boolean)
  disableBridgeInvocation?: boolean
  terminalOriented?: boolean
  argsMayContainSlashCommands?: boolean
  onUserTypedArgs?: Extract<Command, { type: 'prompt' }>['onUserTypedArgs']
  policyGate?:
    | BuiltinPluginSkillPolicyGate
    | (() => BuiltinPluginSkillPolicyGate | undefined)
}

/** densable Mwe / svn — install a getter when the source value is a function. */
function defineCommandFieldGetter(
  command: object,
  key: string,
  value: unknown,
): void {
  if (typeof value !== 'function') return
  Object.defineProperty(command, key, {
    get: value as () => unknown,
    enumerable: true,
    configurable: true,
  })
}

/** densable ivn — policyGate getter when the source value is a function. */
function defineCommandPolicyGateGetter(command: object, value: unknown): void {
  if (typeof value !== 'function') return
  Object.defineProperty(command, 'policyGate', {
    get: value as () => unknown,
    enumerable: true,
    configurable: true,
  })
}

/** densable Wh — bundled builtin-plugin skill → Command. */
function skillDefinitionToCommand(definition: BundledSkillDefinition): Command {
  const skill = definition as BuiltinPluginBundledSkill
  const { wiredSkills } = getBuiltinPluginsHostState()
  let wired = wiredSkills.get(definition)
  if (!wired) {
    const { wireSkillFilesExtraction } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../skills/bundledSkills.js') as typeof import('../skills/bundledSkills.js')
    wired = wireSkillFilesExtraction(definition)
    wiredSkills.set(definition, wired)
  }
  const { skillRoot, getPromptForCommand } = wired
  const command: BuiltinPluginSkillCommand = {
    type: 'prompt',
    name: skill.name,
    description:
      typeof skill.description === 'function' ? '' : skill.description,
    menuDescription:
      typeof skill.menuDescription === 'function'
        ? undefined
        : skill.menuDescription,
    aliases: skill.aliases,
    hasUserSpecifiedDescription: true,
    allowedTools: skill.allowedTools ?? [],
    getAllowedTools: skill.getAllowedTools,
    disallowedTools: [...(skill.disallowedTools ?? [])],
    argumentHint:
      typeof skill.argumentHint === 'function' ? undefined : skill.argumentHint,
    whenToUse:
      typeof skill.whenToUse === 'function' ? undefined : skill.whenToUse,
    subcommands: skill.subcommands,
    subcommandsBareOnly: skill.subcommandsBareOnly,
    model: skill.model,
    disableModelInvocation:
      typeof skill.disableModelInvocation === 'function'
        ? true
        : (skill.disableModelInvocation ?? false),
    disableBridgeInvocation: skill.disableBridgeInvocation,
    userInvocable: skill.userInvocable ?? true,
    terminalOriented: skill.terminalOriented,
    argsMayContainSlashCommands: skill.argsMayContainSlashCommands,
    contentLength: 0,
    // 'bundled' not 'builtin' — 'builtin' in Command.source means hardcoded
    // slash commands (/help, /clear). Using 'bundled' keeps these skills in
    // the Skill tool's listing, analytics name logging, and prompt-truncation
    // exemption. The user-toggleable aspect is tracked on LoadedPlugin.isBuiltin.
    source: 'bundled',
    loadedFrom: 'bundled',
    hooks: skill.hooks,
    context: skill.context,
    getContext: skill.getContext,
    agent: skill.agent,
    background: skill.background,
    skillRoot,
    isEnabled: skill.isEnabled ?? (() => true),
    policyGate:
      typeof skill.policyGate === 'function' ? undefined : skill.policyGate,
    requires: skill.requires,
    isHidden: !(skill.userInvocable ?? true),
    progressMessage: skill.progressMessage ?? 'running',
    getPromptForCommand,
    getEffort: skill.getEffort,
    getDefaultEffort: skill.getDefaultEffort,
    onUserTypedArgs: skill.onUserTypedArgs,
    getArgumentCompletions: skill.getArgumentCompletions,
  }
  defineCommandFieldGetter(command, 'description', skill.description)
  defineCommandFieldGetter(command, 'menuDescription', skill.menuDescription)
  defineCommandFieldGetter(command, 'argumentHint', skill.argumentHint)
  defineCommandFieldGetter(command, 'whenToUse', skill.whenToUse)
  defineCommandFieldGetter(
    command,
    'disableModelInvocation',
    skill.disableModelInvocation,
  )
  defineCommandPolicyGateGetter(command, skill.policyGate)
  return command
}
