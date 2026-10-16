/**
 * densable 2.1.289 `ije` / `wSn` / `cJn`.
 * When managed settings lock permission rules, untrusted skill
 * `allowed-tools` are emptied (not granted). Never export minify ije|wSn|cJn|Vu.
 */
import { getPrintOutputFormat } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { PromptCommand } from '../../types/command.js'
import { isBgSession } from '../concurrentSessions.js'
import { logForDebugging } from '../debug.js'
import {
  BUILTIN_MARKETPLACE_NAME,
  isBuiltinPluginId,
} from '../../plugins/builtinPlugins.js'
import {
  isOfficialMarketplaceName,
  marketplaceSuffixFromSource,
  parsePluginIdentifier,
  SYNCED_MARKETPLACE_NAME,
} from '../plugins/pluginIdentifier.js'
import { isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js'
import { shouldAllowManagedPermissionRulesOnly } from './permissionsLoader.js'

/** densable `Kc` — `--plugin-dir` / SDK inline plugin origin. */
export const PLUGIN_ORIGIN_INLINE = 'inline'
/** densable `Su` — skills-directory plugin with no marketplace. */
export const PLUGIN_ORIGIN_SKILLS_DIR = 'skills-dir'

export type SkillAllowedToolsPluginInfo = {
  /** densable Vu `e?.id` — ije passes pluginInfo.repository here. */
  id?: string
  repository?: string
  officiallyAttested?: boolean
  marketplaceSource?: unknown
  npmResolution?: unknown
  home?: unknown
}

const withheldThisHost = new Set<string>()

function pluginOriginFromId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  return (
    marketplaceSuffixFromSource(id) ?? parsePluginIdentifier(id).marketplace
  )
}

/**
 * densable `Vu` — plugin origin trust under managed-rules-only.
 * skills-dir / missing id → false; builtin → true; synced → officiallyAttested.
 */
export function isPluginAllowedToolsTrusted(
  pluginInfo: SkillAllowedToolsPluginInfo | undefined,
): boolean {
  const id = pluginInfo?.id ?? pluginInfo?.repository
  if (id === undefined) return false
  if (isBuiltinPluginId(id)) return true
  const origin = pluginOriginFromId(id)
  if (origin === undefined || origin === PLUGIN_ORIGIN_SKILLS_DIR) {
    return false
  }
  if (origin === BUILTIN_MARKETPLACE_NAME) return true
  if (origin === PLUGIN_ORIGIN_INLINE) return true
  if (origin === SYNCED_MARKETPLACE_NAME) {
    return pluginInfo?.officiallyAttested === true
  }
  if (pluginInfo?.marketplaceSource === undefined) return false
  return isOfficialMarketplaceName(origin)
}

/**
 * densable `wSn(source, pluginInfo)`.
 * `!Zh()` → true. plugin → Vu. else V2 (admin-trusted source set).
 */
export function isSkillAllowedToolsTrusted(
  source: PromptCommand['source'] | undefined,
  pluginInfo?: SkillAllowedToolsPluginInfo,
): boolean {
  if (!shouldAllowManagedPermissionRulesOnly()) return true
  if (source === 'plugin') return isPluginAllowedToolsTrusted(pluginInfo)
  return isSourceAdminTrusted(source)
}

function originLabelForTelemetry(
  source: PromptCommand['source'] | undefined,
  pluginInfo?: SkillAllowedToolsPluginInfo,
): string {
  const pluginId = pluginInfo?.id ?? pluginInfo?.repository
  if (pluginId !== undefined) {
    return pluginOriginFromId(pluginId) === PLUGIN_ORIGIN_SKILLS_DIR
      ? 'plugin_skills_dir'
      : 'plugin_other'
  }
  return source ?? 'unknown'
}

/**
 * densable `cJn` — unique English + tengu_frontmatter_grant_withheld.
 * Once per `/${name} (${source})` per process (gold `_s.of(host)`).
 */
export function withholdUntrustedSkillAllowedTools(
  skillName: string,
  source: PromptCommand['source'] | undefined,
  pluginInfo: SkillAllowedToolsPluginInfo | undefined,
  tools: string[],
): void {
  const origin = pluginInfo?.id ?? pluginInfo?.repository ?? source ?? 'unknown'
  const label = `/${skillName} (${origin})`
  logForDebugging(
    `Ignoring allowed-tools ${tools.join(', ')} from ${label}: permission rules are restricted to managed settings (allowManagedPermissionRulesOnly).`,
    { level: 'warn' },
  )
  if (!withheldThisHost.has(label)) {
    withheldThisHost.add(label)
    logEvent('tengu_frontmatter_grant_withheld', {
      origin: originLabelForTelemetry(
        source,
        pluginInfo,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      tool_count: tools.length,
    })
  }
  // Gold Qee()==="text" && !It() — print text format, not a bg session.
  if (getPrintOutputFormat() === 'text' && !isBgSession()) {
    console.error(
      `allowed-tools from ${label} ignored: your organization restricts permission rules to managed settings (allowManagedPermissionRulesOnly). Ask an admin to add the rules it needs to managed settings.`,
    )
  }
}

/**
 * densable `ije`. Empty stays empty. Else wSn ? tools : [].
 */
export async function resolveTrustedSkillAllowedTools(command: {
  name: string
  source: PromptCommand['source']
  pluginInfo?: SkillAllowedToolsPluginInfo & { repository?: string }
  allowedTools?: string[]
  getAllowedTools?(): Promise<string[] | undefined>
}): Promise<string[]> {
  const tools =
    (await command.getAllowedTools?.()) ?? command.allowedTools ?? []
  if (tools.length === 0) return tools
  // Gold ije: wSn(source, source==="plugin" ? {id: repository, ...} : void 0)
  // Silent [] — cJn lives only on the load-time an/fo getter.
  return isSkillAllowedToolsTrusted(
    command.source,
    command.source === 'plugin'
      ? {
          id: command.pluginInfo?.repository ?? command.pluginInfo?.id,
          officiallyAttested: command.pluginInfo?.officiallyAttested,
          marketplaceSource: command.pluginInfo?.marketplaceSource,
          npmResolution: command.pluginInfo?.npmResolution,
          home: command.pluginInfo?.home,
        }
      : undefined,
  )
    ? tools
    : []
}

/** Wrap gold `getAllowedTools` lazy empty (load-time `an` / `fo`). */
export function wrapSkillAllowedToolsGetter(
  command: {
    name: string
    source: PromptCommand['source']
    pluginInfo?: SkillAllowedToolsPluginInfo
    allowedTools?: string[]
  },
  raw: string[],
): () => Promise<string[]> {
  let logged = false
  return async () => {
    if (
      raw.length === 0 ||
      isSkillAllowedToolsTrusted(command.source, command.pluginInfo)
    ) {
      return raw
    }
    if (!logged) {
      logged = true
      withholdUntrustedSkillAllowedTools(
        command.name,
        command.source,
        command.pluginInfo,
        raw,
      )
    }
    return []
  }
}

/** Test-only: gold `_s` host set. */
export function resetSkillAllowedToolsWithheldForTests(): void {
  withheldThisHost.clear()
}
