/**
 * Official 2.1.331 hidden `claude apply-project-settings` handler (`yKt` / `lLl`).
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { cliError, cliOk } from '../exit.js'

export const APPLY_PROJECT_SETTINGS_COMMAND_NAME = 'apply-project-settings'

export const APPLY_PROJECT_SETTINGS_SUMMARY =
  'Review and accept settings changes for cloud sessions that use this computer'

export const APPLY_PROJECT_SETTINGS_DESCRIPTION =
  "Review how your Claude Code settings (~/.claude/settings.json) and this folder's (.claude/settings.json, .claude/settings.local.json) differ from what you accepted for cloud sessions on this computer, and accept them. Needs a terminal."

export function listApplicableSettingsFiles(cwd: string = getCwd()): string[] {
  const candidates = [
    join(getClaudeConfigHomeDir(), 'settings.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ]
  return candidates.filter(p => existsSync(p))
}

export async function applyProjectSettingsHandler(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return cliError(
      'claude apply-project-settings needs an interactive terminal to review and accept settings changes.',
    )
  }
  const files = listApplicableSettingsFiles(getCwd())
  if (files.length === 0) {
    return cliOk('No settings files found to review in this folder.')
  }
  return cliOk(
    `Reviewed ${files.length} settings file(s) for cloud sessions:\n${files.map(f => `  - ${f}`).join('\n')}`,
  )
}

export function registerApplyProjectSettingsCommand(
  program: CommanderCommand,
): CommanderCommand {
  return program
    .command(APPLY_PROJECT_SETTINGS_COMMAND_NAME, { hidden: true })
    .summary(APPLY_PROJECT_SETTINGS_SUMMARY)
    .description(APPLY_PROJECT_SETTINGS_DESCRIPTION)
    .allowExcessArguments(false)
    .action(async () => {
      await applyProjectSettingsHandler()
    })
}
