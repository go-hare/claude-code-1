/**
 * densable skill-doctor (d1y / p1y / c1y / u1y): show loaded user skills that
 * are unused and plugins past disuse thresholds (WDt).
 */
import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import { toError } from '../../utils/errors.js'
import { listDisusedPluginsWDt } from '../../utils/plugins/pluginUsage.js'
import { plural } from '../../utils/stringUtils.js'
import { getSkillUsageSnapshot } from '../../utils/suggestions/skillUsageTracking.js'

type SkillRow = {
  name: string
  source: string
  usageCount: number
  daysSinceUse: number | null
}

function formatDays(days: number | null): string {
  // densable c1y
  if (days === null) return chalk.yellow('never')
  if (days === 0) return 'today'
  return `${days} ${plural(days, 'day')}`
}

function formatSkillTable(rows: SkillRow[]): string {
  // densable u1y
  if (rows.length === 0) return chalk.dim('  (no skills loaded)')
  const nameW = Math.max(5, ...rows.map(r => r.name.length))
  const srcW = Math.max(6, ...rows.map(r => r.source.length))
  return rows
    .map(r => {
      const line = `  ${r.name.padEnd(nameW)}  ${chalk.dim(r.source.padEnd(srcW))}  ${String(r.usageCount).padStart(4)}×  ${formatDays(r.daysSinceUse)}`
      return r.usageCount === 0 ? chalk.yellow(line) : line
    })
    .join('\n')
}

/** densable d1y body — separated so load() can wrap with try/catch. */
async function skillDoctorCall(
  _args: string,
  context: Parameters<LocalCommandCall>[1],
) {
  // densable: kick WDt in parallel with skill table build
  const disusedPromise = listDisusedPluginsWDt()
  const rows: SkillRow[] = []
  for (const cmd of context.options.commands) {
    if (cmd.type !== 'prompt') continue
    // densable: skip bundled/builtin/policySettings/plugin-sourced skills
    if (
      cmd.source === 'bundled' ||
      cmd.source === 'builtin' ||
      cmd.source === 'policySettings' ||
      cmd.source === 'plugin'
    ) {
      continue
    }
    const snap = getSkillUsageSnapshot(cmd.name, cmd.unqualifiedName)
    rows.push({
      name: cmd.name,
      source: cmd.pluginInfo?.pluginManifest.name ?? cmd.source,
      usageCount: snap?.usageCount ?? 0,
      daysSinceUse: snap?.daysSinceUse ?? null,
    })
  }
  rows.sort(
    (a, b) =>
      (b.daysSinceUse ?? Number.POSITIVE_INFINITY) -
      (a.daysSinceUse ?? Number.POSITIVE_INFINITY),
  )

  const neverUsed = rows.filter(r => r.usageCount === 0)
  const lines: string[] = []
  lines.push(chalk.bold('Skills loaded this session'))
  lines.push('')
  lines.push(formatSkillTable(rows))
  lines.push('')
  if (neverUsed.length > 0) {
    lines.push(
      chalk.yellow(
        `${neverUsed.length} ${plural(neverUsed.length, 'skill')} loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or remove from .claude/skills.`,
      ),
    )
  } else {
    lines.push(chalk.green('All loaded skills have been used at least once.'))
  }

  const disused = await disusedPromise
  if (disused.length > 0) {
    lines.push('')
    lines.push(chalk.bold('Plugins not used recently'))
    lines.push('')
    for (const p of disused) {
      lines.push(
        `  ${chalk.yellow(p.name)}  ${chalk.dim(`last used ${p.daysSinceLastUse} days ago`)}`,
      )
    }
    lines.push('')
    lines.push(chalk.dim('  Manage these in /plugin'))
  }

  return { type: 'text' as const, value: lines.join('\n') }
}

// densable p1y load wrapper: try/catch → user-facing failure text
export const call: LocalCommandCall = async (args, context) => {
  try {
    return await skillDoctorCall(args, context)
  } catch (err) {
    const message = toError(err).message
    return {
      type: 'text',
      value: `Couldn't compute skill usage. Run with --debug for details. (${message})`,
    }
  }
}

// exported for unit tests
export { formatDays, formatSkillTable, skillDoctorCall }
export type { SkillRow }
