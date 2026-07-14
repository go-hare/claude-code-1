/**
 * Official 2.1.x `fHa`: load spinner tips declared by marketplace plugins
 * that have a `relevance` block, gated by managed
 * `pluginSuggestionMarketplaces` (+ source declared in managed settings).
 *
 * Built-in first-party tips (frontend-design, vercel) live in tipRegistry and
 * are NOT gated by this allowlist.
 */
import { color } from '@anthropic/ink'
import picomatch from 'picomatch'
import { getProjectRoot } from 'src/bootstrap/state.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getCwd } from 'src/utils/cwd.js'
import { cacheKeys } from 'src/utils/fileStateCache.js'
import { isPluginInstalled } from 'src/utils/plugins/installedPluginsManager.js'
import {
  getPluginSuggestionMarketplaces,
  isMarketplaceSourceDeclaredInManagedSettings,
} from 'src/utils/plugins/marketplaceHelpers.js'
import {
  getMarketplace,
  loadKnownMarketplacesConfigSafe,
} from 'src/utils/plugins/marketplaceManager.js'
import { OFFICIAL_MARKETPLACE_NAME } from 'src/utils/plugins/officialMarketplace.js'
import type { PluginMarketplaceEntry } from 'src/utils/plugins/schemas.js'
import type { Tip, TipContext } from './types.js'

/** Built-in tip ids that already cover official-marketplace plugins. */
const BUILTIN_OFFICIAL_PLUGIN_TIP_IDS = new Set([
  'frontend-design-plugin',
  'vercel-plugin',
])

type CompiledManifestDep = {
  file: RegExp
  pattern: RegExp
}

type CompiledSignals = {
  cli?: string[]
  hosts?: string[]
  filesRead?: string[]
  cwd?: string[]
  manifestDep?: CompiledManifestDep[]
}

function compileSignals(
  pluginName: string,
  relevance: PluginMarketplaceEntry['relevance'],
): CompiledSignals | null {
  const signals = relevance?.signals
  if (!signals) return null
  const hasCli = !!signals.cli?.length
  const hasFiles = !!signals.filesRead?.length
  const hasHosts = !!signals.hosts?.length
  const hasCwd = !!signals.cwd?.length
  const hasManifest = !!signals.manifestDeps?.length
  // Official R0o requires at least one usable signal.
  if (!hasCli && !hasFiles && !hasHosts && !hasCwd && !hasManifest) {
    return null
  }

  let manifestDep: CompiledManifestDep[] | undefined
  if (hasManifest) {
    try {
      manifestDep = signals.manifestDeps!.map(dep => ({
        file: new RegExp(dep.file, 'i'),
        pattern: new RegExp(dep.pattern),
      }))
    } catch (err) {
      logForDebugging(
        `Skipping marketplace tip for "${pluginName}": invalid RegExp in relevance.signals: ${err}`,
        { level: 'warn' },
      )
      // Invalid regexes: still allow other signals if present.
      if (!hasCli && !hasFiles && !hasHosts && !hasCwd) return null
    }
  }

  return {
    cli: signals.cli,
    hosts: signals.hosts?.map(h => h.toLowerCase()),
    filesRead: signals.filesRead,
    cwd: signals.cwd,
    manifestDep,
  }
}

function titleCaseKebab(name: string): string {
  return name
    .split('-')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('-')
}

function filesMatchPatterns(
  files: string[],
  patterns: string[] | undefined,
): boolean {
  if (!patterns?.length || files.length === 0) return false
  const normalizedFiles = files.map(fp => fp.replaceAll('\\', '/'))
  try {
    return normalizedFiles.some(fp =>
      picomatch.isMatch(fp, patterns, { nocase: true, dot: true }),
    )
  } catch {
    // Fall back to crude suffix/includes matching if a pattern is invalid.
    for (const pattern of patterns) {
      const normalized = pattern.replaceAll('\\', '/').toLowerCase()
      if (normalized.startsWith('**/')) {
        const suffix = normalized.slice(3)
        if (suffix.startsWith('*.')) {
          const ext = suffix.slice(1)
          if (normalizedFiles.some(fp => fp.toLowerCase().endsWith(ext))) {
            return true
          }
        } else if (
          normalizedFiles.some(fp => fp.toLowerCase().endsWith(suffix))
        ) {
          return true
        }
      } else if (normalized.startsWith('*.')) {
        const ext = normalized.slice(1)
        if (normalizedFiles.some(fp => fp.toLowerCase().endsWith(ext))) {
          return true
        }
      } else if (
        normalizedFiles.some(fp => fp.toLowerCase().includes(normalized))
      ) {
        return true
      }
    }
    return false
  }
}

function cwdMatches(patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false
  const cwd = getCwd().replaceAll('\\', '/')
  const projectRoot = getProjectRoot()?.replaceAll('\\', '/')
  const candidates = [cwd]
  if (projectRoot && cwd.startsWith(`${projectRoot}/`)) {
    candidates.push(cwd.slice(projectRoot.length + 1))
  }
  for (const pattern of patterns) {
    const base = pattern.replace(/\/+$/, '').replace(/\/\*\*$/, '')
    if (!base) continue
    try {
      if (
        candidates.some(path =>
          picomatch.isMatch(path, [base, `${base}/**`], {
            nocase: true,
            dot: true,
          }),
        )
      ) {
        return true
      }
    } catch {
      // ignore invalid pattern
    }
  }
  return false
}

async function isRelevantForSignals(
  pluginName: string,
  marketplaceName: string,
  signals: CompiledSignals,
  context: TipContext | undefined,
): Promise<boolean> {
  const config = await loadKnownMarketplacesConfigSafe()
  if (!(marketplaceName in config)) return false
  if (isPluginInstalled(`${pluginName}@${marketplaceName}`)) return false

  const { bashTools, bashHosts, readFileState } = context ?? {}
  if (signals.cli?.length && bashTools?.size) {
    if (signals.cli.some(cmd => bashTools.has(cmd))) return true
  }
  if (signals.hosts?.length && bashHosts?.size) {
    if (signals.hosts.some(host => bashHosts.has(host))) return true
  }
  if (cwdMatches(signals.cwd)) return true

  const readFiles = readFileState ? cacheKeys(readFileState) : []
  if (filesMatchPatterns(readFiles, signals.filesRead)) return true

  if (signals.manifestDep?.length && readFileState && readFiles.length > 0) {
    for (const { file, pattern } of signals.manifestDep) {
      for (const fp of readFiles) {
        if (!file.test(fp)) continue
        try {
          const entry = readFileState.get(fp)
          // Prefer full cached content (not partial/offset views).
          const content =
            entry &&
            entry.limit === undefined &&
            (entry.offset ?? 1) <= 1 &&
            !entry.isPartialView
              ? entry.content
              : undefined
          if (content && pattern.test(content)) return true
        } catch {
          // ignore per-file failures
        }
      }
    }
  }
  return false
}

let cachedTips: Tip[] | undefined

/**
 * Official fHa — memoized for the process lifetime (marketplace config is
 * relatively stable within a session).
 */
export async function loadMarketplaceDeclaredPluginTips(): Promise<Tip[]> {
  if (cachedTips !== undefined) return cachedTips

  const allowlist = getPluginSuggestionMarketplaces()
  if (allowlist.length === 0) {
    cachedTips = []
    return cachedTips
  }

  const known = await loadKnownMarketplacesConfigSafe()
  const tips: Tip[] = []

  for (const marketplaceName of allowlist) {
    const knownEntry = known[marketplaceName]
    if (!knownEntry) continue

    if (
      marketplaceName !== OFFICIAL_MARKETPLACE_NAME &&
      !isMarketplaceSourceDeclaredInManagedSettings(
        marketplaceName,
        knownEntry.source,
      )
    ) {
      logForDebugging(
        `Skipping plugin suggestion tips for marketplace "${marketplaceName}": its registered source is not declared in managed settings (extraKnownMarketplaces or strictKnownMarketplaces)`,
      )
      continue
    }

    let marketplace
    try {
      marketplace = await getMarketplace(marketplaceName)
    } catch {
      continue
    }

    for (const plugin of marketplace.plugins) {
      const signals = compileSignals(plugin.name, plugin.relevance)
      if (!signals) continue

      // Official skips marketplace-declared tips that already have a built-in
      // first-party tip on the official marketplace.
      if (
        marketplaceName === OFFICIAL_MARKETPLACE_NAME &&
        BUILTIN_OFFICIAL_PLUGIN_TIP_IDS.has(`${plugin.name}-plugin`)
      ) {
        continue
      }

      const topic = plugin.relevance?.topic ?? titleCaseKebab(plugin.name)
      const tipId =
        marketplaceName === OFFICIAL_MARKETPLACE_NAME
          ? `marketplace-plugin:${plugin.name}`
          : `marketplace-plugin:${plugin.name}@${marketplaceName}`

      tips.push({
        id: tipId,
        cooldownSessions: 3,
        content: async ctx => {
          const blue = color('suggestion', ctx?.theme ?? 'dark')
          return `Working with ${topic}? Install the ${plugin.name} plugin:\n${blue(`/plugin install ${plugin.name}@${marketplaceName}`)}`
        },
        isRelevant: async ctx =>
          isRelevantForSignals(plugin.name, marketplaceName, signals, ctx),
      })
    }
  }

  cachedTips = tips
  return cachedTips
}

/** Test helper — clear the fHa memo. */
export function clearMarketplaceDeclaredPluginTipsCache(): void {
  cachedTips = undefined
}
