/**
 * densable 2.1.283 skill-doctor scan: `fqt` / `$je` / `Pbe`.
 *
 * Week-token transcript walk (`DZr`) is gated by HIPAA `qbt`
 * (`allow_skill_doctor_transcript_scan`). When allowed, `fqt` awaits
 * `DZr(storageV5)` and keys `weekTokens` via `UP(cmd)` / alias.
 */

import { uniq } from '../../utils/array.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { re } from '../../utils/plugins/escapeSafeText.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from '../../utils/plugins/pluginIdentifier.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import { getPluginSeedDirs } from '../../utils/plugins/pluginDirectories.js'
import { getManagedPluginNames } from '../../utils/plugins/managedPlugins.js'
import { getStrictKnownMarketplaces } from '../../utils/plugins/marketplaceHelpers.js'
import { hasPendingPluginUsage } from '../../utils/plugins/pluginUsagePending.js'
import { getEnabledVia } from '../../utils/telemetry/pluginTelemetry.js'
import { getSkillUsageSnapshot } from '../../utils/suggestions/skillUsageTracking.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { getContextWindowForModel } from '../../utils/context.js'
import {
  formatCommandsWithinBudget,
  MAX_LISTING_DESC_CHARS,
} from '@claude-code/builtin-tools/tools/SkillTool/prompt.js'
import { resolveSkillOverrideMode } from '../../utils/residualFinalEnvGates.js'
import {
  type Command,
  type LocalJSXCommandContext,
} from '../../types/command.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { scanSkillWeekTokens, skillWeekTokenKey } from './weekTokens.js'

export class SkillDoctorStageError extends Error {
  featureErrorCode: string
  constructor(code: string, cause: unknown) {
    super('skill-doctor stage failed', { cause })
    this.name = 'SkillDoctorStageError'
    this.featureErrorCode = code
  }
}

export type SkillDoctorOwner = 'plugin' | 'mcp' | 'synced' | 'settings'

export type SkillDoctorRow = {
  name: string
  source: string
  owner: SkillDoctorOwner
  pluginKey?: string
  usageCount: number
  daysSinceUse: number | null
  listingTokens: number | null
  weekTokens: number | null
}

export type SkillDoctorScan = {
  rows: SkillDoctorRow[]
  unusedOwned: SkillDoctorRow[]
  unusedFromPlugins: SkillDoctorRow[]
  unusedFromMcp: SkillDoctorRow[]
  unusedSynced: SkillDoctorRow[]
  unusedMcpServers: string[]
  disusedPlugins: DisusedPlugin[]
  weekTokensNote: string | null
}

export type DisusedPlugin = {
  pluginId: string
  name: string
  daysSinceLastUse: number
}

const DISUSE_DAYS = 14
const DISUSE_STARTUPS = 10

/**
 * densable `B`/`qbt` @194898866.
 * Product-cut: policy limits always allow transcript scan.
 */
export function skillDoctorTranscriptScanAllowed(): {
  allowed: boolean
  reason?: string
} {
  return { allowed: true }
}

/** densable `wrt` slice used when SkillTool budget did not emit a line. */
function listingLine(cmd: Command, nameOnly: boolean): string {
  if (nameOnly) return `- ${cmd.name}`
  const blurb = (cmd.whenToUse ?? cmd.description ?? '').replace(/\s+/g, ' ')
  return `- ${cmd.name}: ${blurb.slice(0, MAX_LISTING_DESC_CHARS)}`
}

function listingLineForCommand(cmd: Command, formattedLines: string[]): string {
  const nameOnly = resolveSkillOverrideMode(cmd) === 'name-only'
  if (nameOnly) return `- ${cmd.name}`
  const prefix = `- ${cmd.name}`
  const fromBudget = formattedLines.find(
    line => line === prefix || line.startsWith(`${prefix}:`),
  )
  return fromBudget ?? listingLine(cmd, false)
}

/** densable `RMn` — per-cmd.name tokens; name-only / budget-truncated stay `- name`. */
export function listingTokenMap(
  commands: Command[],
  model: string,
): Map<string, number> {
  const formatted = formatCommandsWithinBudget(
    commands,
    getContextWindowForModel(model),
  )
  const lines = formatted === '' ? [] : formatted.split('\n')
  const map = new Map<string, number>()
  for (const cmd of commands) {
    map.set(
      cmd.name,
      roughTokenCountEstimation(listingLineForCommand(cmd, lines)),
    )
  }
  return map
}

function mcpServerName(name: string): string | undefined {
  const i = name.indexOf(':')
  return i > 0 ? name.slice(0, i) : undefined
}

/** densable `p` — themes / output-styles / monitors / workflows skip disuse. */
function hasPersistentSurfaces(plugin: LoadedPlugin): boolean {
  return Boolean(
    plugin.themesPath ||
      plugin.themesPaths?.length ||
      plugin.outputStylesPath ||
      plugin.outputStylesPaths?.length ||
      plugin.monitors?.length ||
      plugin.workflowsPath ||
      plugin.workflowsPaths?.length,
  )
}

/** densable `a0e` — user-install plugins unused ≥14d and ≥10 startups. */
export async function listDisusedPlugins(): Promise<DisusedPlugin[]> {
  try {
    // densable JO(): managed strictKnownMarketplaces present → no disuse tips
    if (getStrictKnownMarketplaces() !== null) return []
    const { enabled } = await loadAllPlugins()
    if (enabled.length === 0) return []
    const managed = getManagedPluginNames()
    const seedDirs = getPluginSeedDirs()
    const config = getGlobalConfig()
    const startups = config.numStartups
    const now = Date.now()
    const out: DisusedPlugin[] = []
    for (const plugin of enabled) {
      const { marketplace } = parsePluginIdentifier(plugin.repository)
      if (!marketplace || isOfficialMarketplaceName(marketplace)) continue
      // densable Ihr !== "user-install"
      if (getEnabledVia(plugin, managed, seedDirs) !== 'user-install') continue
      if (hasPersistentSurfaces(plugin)) continue
      const usage = config.pluginUsage?.[plugin.repository]
      if (!usage) continue
      // densable Rhr — pending in-memory usage is still "in use"
      if (hasPendingPluginUsage(plugin.repository)) continue
      const days = Math.floor((now - usage.lastUsedAt) / 86_400_000)
      const sessionsSince = startups - (usage.lastUsedNumStartups ?? startups)
      if (days >= DISUSE_DAYS && sessionsSince >= DISUSE_STARTUPS) {
        out.push({
          pluginId: plugin.repository,
          name: plugin.name,
          daysSinceLastUse: days,
        })
      }
    }
    return out.sort((a, b) => b.daysSinceLastUse - a.daysSinceLastUse)
  } catch (error) {
    logForDebugging(
      `plugin-disuse tip: failed to compute disused plugins: ${error}`,
      { level: 'error' },
    )
    return []
  }
}

export async function scanSkillDoctor(
  context: LocalJSXCommandContext,
): Promise<SkillDoctorScan> {
  const disusedP = listDisusedPlugins()
  disusedP.catch(() => {})
  const weekGate = skillDoctorTranscriptScanAllowed()
  const weekP = weekGate.allowed
    ? scanSkillWeekTokens(context.storageV5).catch(error => {
        throw new SkillDoctorStageError('scan_failed', error)
      })
    : Promise.resolve(new Map<string, number>())
  weekP.catch(() => {})
  const commands = context.options.commands
  const mcpClients = context.options.mcpClients ?? []
  const prompts = commands.filter(c => c.type === 'prompt')
  const names = new Set(prompts.map(c => c.name))
  const aliasHits = new Set(
    commands
      .filter(
        c => c.aliases?.some(a => !names.has(c.name)) && !names.has(c.name),
      )
      .flatMap(c => c.aliases ?? []),
  )
  const suffixCounts = new Map<string, number>()
  for (const cmd of prompts) {
    const t = cmd.name.lastIndexOf(':')
    if (t > 0 && cmd.loadedFrom !== 'syncedSkills') {
      const i = cmd.name.slice(t + 1)
      suffixCounts.set(i, (suffixCounts.get(i) ?? 0) + 1)
    }
  }
  const rows: SkillDoctorRow[] = []
  // densable `xMn` → `included` then `RMn(included)` listing tokens
  const { mergeSkillToolCommands } = await import('../../commands.js')
  const mcpCommands = commands.filter(
    cmd => cmd.source === 'mcp' && cmd.loadedFrom === 'mcp',
  )
  const { included: skillSet } = await mergeSkillToolCommands(
    mcpCommands,
  ).catch((error: unknown) => {
    throw new SkillDoctorStageError('skill_set_failed', error)
  })
  const listing = listingTokenMap(skillSet, context.options.mainLoopModel)
  const weekMap = await weekP
  for (const cmd of prompts) {
    if (
      cmd.source === 'bundled' ||
      cmd.source === 'builtin' ||
      cmd.source === 'policySettings'
    ) {
      continue
    }
    if (cmd.source === 'mcp' && cmd.loadedFrom !== 'mcp') continue
    const t = cmd.name.lastIndexOf(':')
    const suffix = t > 0 ? cmd.name.slice(t + 1) : undefined
    const alias =
      suffix !== undefined &&
      cmd.loadedFrom !== 'syncedSkills' &&
      aliasHits.has(suffix) &&
      suffixCounts.get(suffix) === 1
        ? suffix
        : undefined
    const snap = getSkillUsageSnapshot(cmd.name, alias)
    rows.push({
      name: cmd.pluginInfo ? re(cmd.name) : cmd.name,
      source: cmd.pluginInfo
        ? re(cmd.pluginInfo.pluginManifest.name)
        : cmd.loadedFrom === 'syncedSkills'
          ? 'synced'
          : String(cmd.source),
      owner:
        cmd.source === 'plugin'
          ? 'plugin'
          : cmd.source === 'mcp'
            ? 'mcp'
            : cmd.loadedFrom === 'syncedSkills'
              ? 'synced'
              : 'settings',
      pluginKey: cmd.pluginInfo?.pluginManifest.name,
      usageCount: snap?.usageCount ?? 0,
      daysSinceUse: snap?.daysSinceUse ?? null,
      listingTokens: listing.get(cmd.name) ?? null,
      weekTokens:
        weekMap.get(skillWeekTokenKey(cmd)) ??
        (alias ? weekMap.get(alias) : undefined) ??
        null,
    })
  }
  rows.sort(
    (a, b) =>
      (b.daysSinceUse ?? Number.POSITIVE_INFINITY) -
      (a.daysSinceUse ?? Number.POSITIVE_INFINITY),
  )
  const unused = rows.filter(
    r => r.usageCount === 0 && r.listingTokens !== null,
  )
  const unusedOwned = unused.filter(r => r.owner === 'settings')
  const unusedSynced = unused.filter(r => r.owner === 'synced')
  const usedPluginKeys = new Set(
    rows
      .filter(r => r.usageCount > 0 && r.pluginKey !== undefined)
      .map(r => r.pluginKey),
  )
  const unusedFromPlugins = unused.filter(
    r =>
      r.owner === 'plugin' &&
      (r.pluginKey === undefined || !usedPluginKeys.has(r.pluginKey)),
  )
  const usedMcp = new Set(
    rows
      .filter(r => r.owner === 'mcp' && r.usageCount > 0)
      .map(r => mcpServerName(r.name))
      .filter((n): n is string => n !== undefined),
  )
  const unusedFromMcp = unused.filter(r => {
    if (r.owner !== 'mcp') return false
    const server = mcpServerName(r.name)
    return server === undefined || !usedMcp.has(server)
  })
  const unusedMcpServers = uniq(
    unusedFromMcp
      .map(r => mcpServerName(r.name))
      .filter((n): n is string => n !== undefined),
  ).map(id => re(mcpClients.find(c => c.name === id)?.name ?? id))
  return {
    rows,
    unusedOwned,
    unusedFromPlugins,
    unusedFromMcp,
    unusedSynced,
    unusedMcpServers,
    disusedPlugins: await disusedP,
    weekTokensNote: weekGate.allowed ? null : (weekGate.reason ?? null),
  }
}
