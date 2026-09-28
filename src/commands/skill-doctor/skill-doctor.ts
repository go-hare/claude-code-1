/**
 * densable `Nae` / `qsr` — non-interactive `/skill-doctor` text report.
 */

import chalk from 'chalk'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import { logError } from '../../utils/log.js'
import { errorMessage } from '../../utils/errors.js'
import { uniq } from '../../utils/array.js'
import { plural } from '../../utils/stringUtils.js'
import { re } from '../../utils/plugins/escapeSafeText.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  scanSkillDoctor,
  SkillDoctorStageError,
  type SkillDoctorRow,
} from './scan.js'

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

function formatTable(rows: SkillDoctorRow[]): string {
  if (rows.length === 0) return chalk.dim('  (no skills loaded)')
  const cells = rows.map(r => ({
    name: r.name,
    source: r.source,
    context: r.listingTokens === null ? '—' : String(r.listingTokens),
    week: r.weekTokens === null ? '—' : String(r.weekTokens),
    uses: String(r.usageCount),
    lastUsed:
      r.daysSinceUse === null
        ? 'never'
        : r.daysSinceUse === 0
          ? 'today'
          : `${r.daysSinceUse}d`,
  }))
  const widths = {
    name: Math.max(5, ...cells.map(c => c.name.length)),
    source: Math.max(6, ...cells.map(c => c.source.length)),
    context: Math.max(7, ...cells.map(c => c.context.length)),
    week: Math.max(9, ...cells.map(c => c.week.length)),
    uses: Math.max(4, ...cells.map(c => c.uses.length)),
  }
  const header = chalk.dim(
    `  ${pad('skill', widths.name)}  ${pad('source', widths.source)}  ${pad('context', widths.context)}  ${pad('7d tokens', widths.week)}  ${pad('uses', widths.uses + 1)}  last used`,
  )
  const body = cells
    .map((c, i) => {
      const line = `  ${pad(c.name, widths.name)}  ${chalk.dim(pad(c.source, widths.source))}  ${pad(c.context, widths.context)}  ${pad(c.week, widths.week)}  ${pad(`${c.uses}×`, widths.uses + 1)}  ${c.lastUsed}`
      return rows[i]!.usageCount === 0 ? chalk.yellow(line) : line
    })
    .join('\n')
  return `${header}\n${body}`
}

export async function renderSkillDoctorReport(
  context: Parameters<LocalCommandCall>[1],
): Promise<string> {
  const {
    rows,
    unusedOwned,
    unusedSynced,
    unusedFromPlugins,
    unusedFromMcp,
    unusedMcpServers,
    disusedPlugins,
    weekTokensNote,
  } = await scanSkillDoctor(context)
  const lines: string[] = []
  lines.push(chalk.bold('Skills loaded this session'), '', formatTable(rows))
  if (rows.length > 0) {
    lines.push(
      '',
      chalk.dim(
        "  context = this skill's one-line listing in the system prompt, included every turn",
      ),
      chalk.dim(
        '  (dash = not in the current listing, costs nothing; full SKILL.md loads only when it runs)',
      ),
      chalk.dim(
        weekTokensNote === null
          ? '  7d tokens = tokens attributed to the skill over the last 7 days of sessions on this machine'
          : `  7d tokens: ${weekTokensNote}`,
      ),
    )
  }
  lines.push('')
  if (unusedOwned.length > 0) {
    lines.push(
      chalk.yellow(
        `${unusedOwned.length} ${plural(unusedOwned.length, 'skill')} loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or remove from .claude/skills.`,
      ),
    )
  }
  if (unusedSynced.length > 0) {
    lines.push(
      chalk.yellow(
        `${unusedSynced.length} ${plural(unusedSynced.length, 'skill')} synced from claude.ai loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or turn ${unusedSynced.length === 1 ? 'it' : 'them'} off on claude.ai — a deleted synced copy is re-downloaded on the next sync.`,
      ),
    )
  }
  if (unusedFromPlugins.length > 0) {
    const sources = uniq(unusedFromPlugins.map(r => r.source))
    lines.push(
      chalk.yellow(
        `${unusedFromPlugins.length} plugin ${plural(unusedFromPlugins.length, 'skill')} loaded but never invoked, from ${sources.join(', ')}. Each one adds to the system prompt every turn. Plugin skills can't be turned off individually — disable ${sources.length === 1 ? 'the plugin' : 'those plugins'} in /plugin.`,
      ),
    )
  }
  if (unusedFromMcp.length > 0) {
    const from =
      unusedMcpServers.length > 0 ? `, from ${unusedMcpServers.join(', ')}` : ''
    const one = unusedMcpServers.length <= 1
    lines.push(
      chalk.yellow(
        `${unusedFromMcp.length} MCP ${plural(unusedFromMcp.length, 'skill')} loaded but never invoked${from}. Each one adds to the system prompt every turn. MCP skills live on the server, not on disk — turning ${one ? 'that server' : 'those servers'} off in /mcp also removes ${one ? 'its' : 'their'} tools.`,
      ),
    )
  }
  if (rows.length > 0 && rows.every(r => r.usageCount > 0)) {
    lines.push(chalk.green('All loaded skills have been used at least once.'))
  }
  if (disusedPlugins.length > 0) {
    lines.push('', chalk.bold('Plugins not used recently'), '')
    for (const p of disusedPlugins) {
      lines.push(
        `  ${chalk.yellow(re(p.name))}  ${chalk.dim(`last used ${p.daysSinceLastUse} days ago`)}`,
      )
    }
    lines.push('', chalk.dim('  Manage these in /plugin'))
  }
  if (rows.length === 0) {
    logEvent('cli_skill_doctor', {
      outcome:
        'no_user_skills' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else if (weekTokensNote !== null) {
    logEvent('cli_skill_doctor', {
      outcome:
        'scan_policy_denied' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('cli_skill_doctor', {})
  }
  return lines.join('\n')
}

export const call: LocalCommandCall = async (_args, context) => {
  if (getIsRemoteMode()) {
    return {
      type: 'text',
      value: 'Skill usage reports are not available on this connection.',
    }
  }
  try {
    const value = await renderSkillDoctorReport(context)
    if (getIsRemoteMode()) {
      return {
        type: 'text',
        value: 'Skill usage reports are not available on this connection.',
      }
    }
    return { type: 'text', value }
  } catch (error) {
    const cause = error instanceof SkillDoctorStageError ? error.cause : error
    logError(cause)
    logEvent('cli_skill_doctor', {
      outcome: (error instanceof SkillDoctorStageError
        ? error.featureErrorCode
        : 'render_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (getIsRemoteMode()) {
      return { type: 'text', value: "Couldn't compute skill usage." }
    }
    return {
      type: 'text',
      value: `Couldn't compute skill usage. Run with --debug for details. (${errorMessage(cause)})`,
    }
  }
}
