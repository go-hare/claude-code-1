/**
 * densable 2.1.283 skill-doctor scan: `fqt` / `$je` / `Pbe`.
 *
 * Week-token transcript walk (`DZr`) is gated by HIPAA
 * `allow_skill_doctor_transcript_scan`. When the policy refuses, week tokens
 * are omitted (gold `qbt` reason) rather than inventing a transcript walker.
 */

import { uniq } from '../../utils/array.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { re } from '../../utils/plugins/escapeSafeText.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import { getSkillUsageSnapshot } from '../../utils/suggestions/skillUsageTracking.js'
import {
  getPolicyDenyKind,
  isPolicyAllowed,
} from '../../services/policyLimits/index.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import {
  getCommandName,
  type Command,
  type LocalJSXCommandContext,
} from '../../types/command.js'

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

const HIPAA_SKILL_DOCTOR_REASON =
  'Not shown for HIPAA-regulated organizations: measured by scanning the session transcripts saved on this machine.'

export function skillDoctorTranscriptScanAllowed(): {
  allowed: boolean
  reason?: string
} {
  if (isPolicyAllowed('allow_skill_doctor_transcript_scan')) {
    return { allowed: true }
  }
  if (
    getPolicyDenyKind('allow_skill_doctor_transcript_scan') === 'org_denied'
  ) {
    return { allowed: false, reason: HIPAA_SKILL_DOCTOR_REASON }
  }
  return {
    allowed: false,
    reason: 'Skill token counts are unavailable right now.',
  }
}

function listingLine(cmd: Command, nameOnly: boolean): string {
  const name = getCommandName(cmd)
  if (nameOnly) return `- ${name}`
  const blurb = (cmd.whenToUse ?? cmd.description ?? '').replace(/\s+/g, ' ')
  return `- ${name}: ${blurb.slice(0, 160)}`
}

function listingTokenMap(
  commands: Command[],
  nameOnly: Set<string>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const cmd of commands) {
    const line = listingLine(cmd, nameOnly.has(cmd.name))
    map.set(cmd.name, roughTokenCountEstimation(line))
  }
  return map
}

function mcpServerName(name: string): string | undefined {
  const i = name.indexOf(':')
  return i > 0 ? name.slice(0, i) : undefined
}

function hasPersistentSurfaces(plugin: {
  outputStylesPath?: string
  outputStylesPaths?: string[]
}): boolean {
  return Boolean(
    plugin.outputStylesPath || (plugin.outputStylesPaths?.length ?? 0) > 0,
  )
}

/** densable `a0e` — user-install plugins unused ≥14d and ≥10 startups. */
export async function listDisusedPlugins(): Promise<DisusedPlugin[]> {
  try {
    const { enabled } = await loadAllPlugins()
    if (enabled.length === 0) return []
    const config = getGlobalConfig()
    const startups = config.numStartups
    const now = Date.now()
    const out: DisusedPlugin[] = []
    for (const plugin of enabled) {
      const { marketplace } = parsePluginIdentifier(plugin.repository)
      if (!marketplace || marketplace === OFFICIAL_MARKETPLACE_NAME) continue
      if (plugin.isBuiltin) continue
      if (hasPersistentSurfaces(plugin)) continue
      const usage = config.pluginUsage?.[plugin.repository]
      if (!usage) continue
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
  const nameOnly = new Set<string>()
  const rows: SkillDoctorRow[] = []
  const listing = listingTokenMap(prompts, nameOnly)
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
      weekTokens: null,
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
