import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { filterValidCommands, getBuiltinCommands } from '../../commands.js'
import {
  createCommandInputMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'

const ROOT = join(import.meta.dir, '../../..')

describe('Agent 6 Regression Fixes — Commands / Messages / Dialogs', () => {
  test('P0-1: filterValidCommands preserves all built-in slash commands (fallback to cmd.name when userFacingName is omitted)', () => {
    const builtins = getBuiltinCommands()
    expect(builtins.length).toBeGreaterThan(100)
    const filtered = filterValidCommands(builtins)
    expect(filtered.length).toBe(builtins.length)

    // Still drops genuinely malformed commands whose name is not a string
    const malformed = [
      { type: 'local', name: 123 as unknown as string, description: 'bad' },
      {
        type: 'local',
        name: 'bad-display',
        description: 'bad',
        userFacingName: () => 42 as unknown as string,
      },
    ] as unknown as Parameters<typeof filterValidCommands>[0]
    expect(filterValidCommands(malformed)).toEqual([])
  })

  test('P1-5: display-only SystemLocalCommandMessage is excluded from normalizeMessagesForAPI while normal local_command stays', () => {
    const normal = createCommandInputMessage(
      '<local-command-stdout>visible to model</local-command-stdout>',
    )
    const displayOnly = createCommandInputMessage(
      '<local-command-stdout>user only</local-command-stdout>',
      { isDisplayOnly: true },
    )
    expect(displayOnly.isDisplayOnly).toBe(true)
    const normalized = normalizeMessagesForAPI([normal, displayOnly])
    const serialized = JSON.stringify(normalized)
    expect(serialized).toContain('visible to model')
    expect(serialized).not.toContain('user only')
  })

  test('P1-5: list-agents isEnabled gates on UDS_INBOX and isHarborKiteEnabled, and processSlashCommand wraps formatForegroundForkResult in try/catch', () => {
    const listAgentsSrc = readFileSync(
      join(ROOT, 'src/commands/list-agents/index.ts'),
      'utf8',
    )
    expect(listAgentsSrc).toContain('isHarborKiteEnabled')
    expect(listAgentsSrc).toContain("feature('UDS_INBOX')")

    const slashSrc = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    const forkSection = slashSrc.slice(
      slashSrc.indexOf('const formatForegroundForkResult'),
      slashSrc.indexOf('Forked slash command /'),
    )
    expect(forkSection).toContain('try {')
    expect(forkSection).toContain('logError(')
  })

  test('P1-7 & P1-9: install-github-app steps wire Settings confirm:no; ConfirmSetupStep and AddedFolderTrustPrompt use ConfirmSelect; CdTrustPrompt keeps isCutOff out of refuseInput', () => {
    for (const rel of [
      'src/commands/install-github-app/ApiKeyStep.tsx',
      'src/commands/install-github-app/CheckExistingSecretStep.tsx',
      'src/commands/install-github-app/ChooseRepoStep.tsx',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src).toContain("useKeybinding('confirm:no'")
      expect(src).toContain("context: 'Settings'")
    }

    const confirmSetupSrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/ConfirmSetupStep.tsx'),
      'utf8',
    )
    expect(confirmSetupSrc).toContain('<ConfirmSelect')
    expect(confirmSetupSrc).toContain('cancelFirst')
    expect(confirmSetupSrc).toContain('focus="cancel"')
    expect(confirmSetupSrc).toContain('onUpFromFirstItem={() => {}}')

    const addDirSrc = readFileSync(
      join(ROOT, 'src/commands/add-dir/add-dir.tsx'),
      'utf8',
    )
    expect(addDirSrc).toContain('<ConfirmSelect')
    expect(addDirSrc).toContain('CONFIRM_SELECT_ARM_MS')
    expect(addDirSrc).toContain('onUpFromFirstItem={() => {}}')

    const cdTrustSrc = readFileSync(
      join(ROOT, 'src/commands/cd/CdTrustPrompt.tsx'),
      'utf8',
    )
    expect(cdTrustSrc).toContain('refuseInput={isInputRefused}')
    expect(cdTrustSrc).not.toContain(
      'refuseInput={() => isInputRefused() || isCutOff}',
    )
  })

  test('P1-11: launchAutofixPr returns stateful AutofixLauncher immediately for interactive sessions and wires onLateStopFailure', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/autofix-pr/launchAutofixPr.ts'),
      'utf8',
    )
    expect(src).toContain('export function AutofixLauncher')
    expect(src).toContain('onLateStopFailure: wireLateStopFailure(context)')
    expect(src).toContain('React.createElement(AutofixLauncher')
  })
})
