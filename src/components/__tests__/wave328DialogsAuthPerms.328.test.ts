import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  installZedShiftEnterKeymap,
  isVSCodeRemoteSSH,
} from '../../commands/terminalSetup/terminalSetup.js'
import { formatApiKeyProfileConflictWarning } from '../../utils/anthropicProfile.js'
import { planModelSupportsAutoMode } from '../../utils/betas.js'
import {
  formatConsoleNonConsoleAccountError,
  formatConsoleSavedSignInError,
  resolveLoginSubstepEscapeTarget,
} from '../ConsoleOAuthFlow.js'
import {
  advanceScreenReaderEarlyInput,
  shouldStopAtLastRow,
} from '../CustomSelect/select.js'
import {
  isEscapeThenKeyDecline,
  isWithinSigcontGraceWindow,
  noteProcessResumed,
  resetProcessResumedForTests,
  SIGCONT_RESUME_GRACE_MS,
} from '../CustomSelect/use-select-input.js'
import { wrapElicitationMessageMultiline } from '../mcp/ElicitationDialog.js'
import {
  COMPUTER_USE_FLAG_LABEL,
  COMPUTER_USE_SENTINEL_WARNING,
  COMPUTER_USE_TIER_LABEL,
  deduplicateComputerUseApps,
} from '../permissions/ComputerUseApproval/ComputerUseApproval.js'
import {
  isWithinPermissionKeyGuard,
  PERMISSION_MOUNT_SETTLE_MS,
  resetPromptSubmitTimeForTests,
} from '../permissions/submitGuard.js'

afterEach(() => {
  resetProcessResumedForTests()
  resetPromptSubmitTimeForTests()
})

describe('Wave 327-328 Dialogs / Auth / Permissions / Terminal Setup', () => {
  test('#445: PermissionPrompt handleCancel is NOT gated by isWithinPermissionKeyGuard', async () => {
    const src = await readFile(
      join(import.meta.dir, '../permissions/PermissionPrompt.tsx'),
      'utf8',
    )
    const cancelBlock = src.slice(
      src.indexOf('const handleCancel = useCallback'),
    )
    const nextBlock = cancelBlock.slice(
      0,
      cancelBlock.indexOf('const declineOptionValue'),
    )
    expect(nextBlock).not.toContain('isWithinPermissionKeyGuard')
    // Answer selection remains guarded
    const selectBlock = src.slice(
      src.indexOf('const handleSelect = useCallback'),
      src.indexOf('const handleCycleMode'),
    )
    expect(selectBlock).toContain(
      'isWithinPermissionKeyGuard(mountedAtRef.current)',
    )
  })

  test('#464: ElicitationDialog word-wraps long single-line MCP questions across multiple rows', () => {
    const longQuestion =
      'Please provide the full deployment environment configuration including region, cluster name, and rollout window for this release.'
    const wrapped = wrapElicitationMessageMultiline(longQuestion, 46, 4)
    const lines = wrapped.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(wrapped).toContain('deployment')
    expect(wrapped).toContain('configuration')
  })

  test('#464: BaseTextInput matches official I2n without fabricated overflowBadge extra row', async () => {
    const btiSrc = await readFile(
      join(import.meta.dir, '../BaseTextInput.tsx'),
      'utf8',
    )
    expect(btiSrc).not.toContain('computeTextOverflowIndicator')
    expect(btiSrc).not.toContain('overflowBadge')
  })

  test('#467: screen-reader early digit + Enter clears refusal latch so next number is not dropped', () => {
    // 1. User types digit during early refusal window -> latched as 'digit', ignored
    const s1 = advanceScreenReaderEarlyInput({
      earlyRefused: null,
      refusing: true,
      key: 'digit',
      optionCount: 3,
    })
    expect(s1.earlyRefused).toBe('digit')
    expect(s1.action).toBe('ignore')

    // 2. User presses Enter right after while still in refusal window -> clears latch & warns
    const s2 = advanceScreenReaderEarlyInput({
      earlyRefused: s1.earlyRefused,
      refusing: true,
      key: 'return',
      optionCount: 3,
    })
    expect(s2.earlyRefused).toBeNull()
    expect(s2.action).toBe('clear-and-warn')
    expect(s2.warning).toBe(
      'Nothing was chosen. Enter a number between 1 and 3.',
    )

    // 3. After window settles, next digit is accepted (NOT dropped!)
    const s3 = advanceScreenReaderEarlyInput({
      earlyRefused: s2.earlyRefused,
      refusing: false,
      key: 'digit',
      optionCount: 3,
    })
    expect(s3.earlyRefused).toBeNull()
    expect(s3.action).toBe('accept')
  })

  test('#471: question and plan approval dialogs use ConfigurableShortcutHint for chat:externalEditor', async () => {
    for (const rel of [
      '../permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx',
      '../permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
      '../permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ]) {
      const src = await readFile(join(import.meta.dir, rel), 'utf8')
      expect(src).toContain('action="chat:externalEditor"')
      expect(src).not.toContain('shortcut="ctrl+g"')
    }
  })

  test('#472: sign-in errors do not point to Claude subscription when forceLoginMethod === console', () => {
    const err1Console = formatConsoleNonConsoleAccountError('console')
    expect(err1Console).toContain('forceLoginMethod')
    expect(err1Console).toContain('https://platform.claude.com')
    expect(err1Console).not.toContain('Claude account with subscription')

    const err1Default = formatConsoleNonConsoleAccountError(undefined)
    expect(err1Default).toContain('Claude account with subscription')

    const err2Console = formatConsoleSavedSignInError('console')
    expect(err2Console).toContain('sign in with a Console account')
    expect(err2Console).not.toContain('Claude account with subscription')

    const err2Default = formatConsoleSavedSignInError(undefined)
    expect(err2Default).toContain('Claude account with subscription')
  })

  test('#483: API key + Anthropic profile conflict warning explains active credential and switch steps', () => {
    const envConflict = formatApiKeyProfileConflictWarning({
      apiKeySource: 'ANTHROPIC_API_KEY',
    })
    expect(envConflict.headline).toBe(
      'Using ANTHROPIC_API_KEY instead of your Anthropic profile',
    )
    expect(envConflict.switchHint).toContain('unset ANTHROPIC_API_KEY')

    const managedOidc = formatApiKeyProfileConflictWarning({
      apiKeySource: '/login managed key',
      profileAuthKind: 'oidc_federation',
    })
    expect(managedOidc.headline).toBe(
      'Using the API key saved by /login instead of your Anthropic profile',
    )
    expect(managedOidc.switchHint).toContain('/logout to remove the key')

    const managedConsole = formatApiKeyProfileConflictWarning({
      apiKeySource: '/login managed key',
      profileAuthKind: 'user_oauth',
      createdByClaudeCode: true,
      consoleProfileLoginAllowed: true,
      hasEnvApiKey: false,
    })
    expect(managedConsole.switchHint).toContain(
      '/login and sign in to Console without an API key (removes the saved key)',
    )
  })

  test('#500: permission prompt Select stops at last row (No) and wires stopsAtLastRow', async () => {
    const opts = [
      { label: 'Yes', value: 'yes' },
      { label: 'Yes, always', value: 'yes-always' },
      { label: 'No', value: 'no' },
    ]
    expect(shouldStopAtLastRow(false, opts, 'no')).toBe(true)
    expect(shouldStopAtLastRow(true, opts, 'no')).toBe(false)
    expect(shouldStopAtLastRow(false, opts, 'yes')).toBe(false)
    expect(shouldStopAtLastRow(true, opts, 'no', true)).toBe(true)

    const bashSrc = await readFile(
      join(
        import.meta.dir,
        '../permissions/BashPermissionRequest/BashPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(bashSrc).toContain('declineValue="no"')
    expect(bashSrc).toContain('stopsAtLastRow')

    const navSrc = await readFile(
      join(import.meta.dir, '../CustomSelect/use-select-navigation.ts'),
      'utf8',
    )
    expect(navSrc).toContain('if (!item.next && action.stopsAtLastRow)')
  })

  test('#520: SIGCONT resume grace window ignores answers for 150ms after fg', () => {
    const t0 = 10_000
    expect(isWithinSigcontGraceWindow(t0)).toBe(false)

    noteProcessResumed(t0)
    expect(isWithinSigcontGraceWindow(t0)).toBe(true)
    expect(isWithinSigcontGraceWindow(t0 + SIGCONT_RESUME_GRACE_MS - 1)).toBe(
      true,
    )
    expect(isWithinSigcontGraceWindow(t0 + SIGCONT_RESUME_GRACE_MS)).toBe(false)

    // Also integrated into isWithinPermissionKeyGuard even after mount settle expires
    expect(
      isWithinPermissionKeyGuard(
        t0 - PERMISSION_MOUNT_SETTLE_MS - 100,
        t0 + 50,
      ),
    ).toBe(true)
    expect(
      isWithinPermissionKeyGuard(
        t0 - PERMISSION_MOUNT_SETTLE_MS - 100,
        t0 + SIGCONT_RESUME_GRACE_MS + 10,
      ),
    ).toBe(false)
  })

  test('#528: detects remote VS Code, Cursor, Windsurf, and Devin Desktop sessions', () => {
    expect(
      isVSCodeRemoteSSH({
        VSCODE_GIT_ASKPASS_MAIN: '/home/u/.vscode-server/bin/askpass.sh',
      }),
    ).toBe(true)
    expect(
      isVSCodeRemoteSSH({ PATH: '/home/u/.cursor-server/bin:/usr/bin' }),
    ).toBe(true)
    expect(
      isVSCodeRemoteSSH({
        VSCODE_GIT_ASKPASS_MAIN: '/home/u/.devin-server/bin/askpass.sh',
      }),
    ).toBe(true)
    expect(
      isVSCodeRemoteSSH({ PATH: '/home/u/.devin-server/cli:/usr/bin' }),
    ).toBe(true)
    expect(isVSCodeRemoteSSH({ PATH: '/usr/local/bin:/usr/bin' })).toBe(false)
  })

  test('#558: Esc+key and unused Alt/Option key decline at permission/question prompts', () => {
    expect(
      isEscapeThenKeyDecline(
        'x',
        { meta: true },
        { hasDeclinePrompt: true, isInInput: false },
      ),
    ).toBe(true)
    expect(
      isEscapeThenKeyDecline(
        '\x1bx',
        {},
        { hasDeclinePrompt: true, isInInput: false },
      ),
    ).toBe(true)
    // CSI sequences (like arrow keys) must not trigger decline
    expect(
      isEscapeThenKeyDecline(
        '\x1b[A',
        {},
        { hasDeclinePrompt: true, isInInput: false },
      ),
    ).toBe(false)
    // Does not trigger while editing an input option or on non-decline selects
    expect(
      isEscapeThenKeyDecline(
        'x',
        { meta: true },
        { hasDeclinePrompt: true, isInInput: true },
      ),
    ).toBe(false)
    expect(
      isEscapeThenKeyDecline(
        'x',
        { meta: true },
        { hasDeclinePrompt: false, isInInput: false },
      ),
    ).toBe(false)
  })

  test('#612: installZedShiftEnterKeymap leaves symlinked keymap.json unchanged with manual instructions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zed-keymap-symlink-'))
    try {
      const targetPath = join(dir, 'dotfiles-keymap.json')
      const linkPath = join(dir, 'keymap.json')
      const original =
        JSON.stringify([{ context: 'Workspace', bindings: {} }], null, 2) + '\n'
      await writeFile(targetPath, original, 'utf8')
      await symlink(targetPath, linkPath)

      const res = await installZedShiftEnterKeymap('dark', dir, linkPath)
      expect(res.installed).toBe(false)
      expect(res.message).toContain('symbolic link')
      expect(res.message).toContain('Then run /terminal-setup again.')
      expect(await readFile(targetPath, 'utf8')).toBe(original)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#619: Esc on Bedrock access keys and Vertex steps returns to platform_setup instead of closing /login', () => {
    expect(resolveLoginSubstepEscapeTarget('bedrock_access_keys')).toBe(
      'platform_setup',
    )
    expect(resolveLoginSubstepEscapeTarget('vertex_setup')).toBe(
      'platform_setup',
    )
    expect(resolveLoginSubstepEscapeTarget('platform_setup')).toBe('idle')
    expect(resolveLoginSubstepEscapeTarget('idle')).toBeNull()
  })

  test('#657: ComputerUseApproval shows per-app access levels, plainer warnings, and deduplicates apps', () => {
    expect(COMPUTER_USE_TIER_LABEL).toEqual({
      read: 'view only',
      click: 'click only',
      full: 'full access',
    })
    expect(COMPUTER_USE_SENTINEL_WARNING.shell).toBe(
      'Can run commands on your computer',
    )
    expect(COMPUTER_USE_SENTINEL_WARNING.filesystem).toBe(
      'Can open, change, or delete any file, and run apps and scripts',
    )
    expect(COMPUTER_USE_FLAG_LABEL.clipboardRead).toBe('Read your clipboard')
    expect(COMPUTER_USE_FLAG_LABEL.systemKeyCombos).toContain('⌘Q')

    const deduped = deduplicateComputerUseApps([
      {
        requestedName: 'Terminal',
        resolved: {
          bundleId: 'com.apple.Terminal',
          displayName: 'Terminal',
          path: '/System/Applications/Utilities/Terminal.app',
        },
        isSentinel: true,
        alreadyGranted: true,
        proposedTier: 'click',
      },
      {
        requestedName: 'Terminal',
        resolved: {
          bundleId: 'com.apple.Terminal',
          displayName: 'Terminal',
          path: '/System/Applications/Utilities/Terminal.app',
        },
        isSentinel: true,
        alreadyGranted: false,
        proposedTier: 'click',
      },
    ])
    expect(deduped).toHaveLength(1)
    expect(deduped[0]!.alreadyGranted).toBe(false)
  })

  test('#662/#657/#464/#466/#619 regressions: 1P auto-mode guard, ComputerUse omitted tier full-access warning, BaseTextInput sibling overflow badge, /chrome browser list Esc, Bedrock credentials editable cursor & persist', async () => {
    expect(planModelSupportsAutoMode('claude-opus-4-6', 'bedrock')).toBe(true)
    expect(planModelSupportsAutoMode('claude-sonnet-4-6', 'vertex')).toBe(true)
    expect(planModelSupportsAutoMode('claude-haiku-4-5', 'bedrock')).toBe(false)

    // #662: firstParty must NOT bypass isAutoModeAvailable / canOfferAutoMode
    const exitPlanSrc = await readFile(
      join(
        import.meta.dir,
        '../permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(exitPlanSrc).toContain("apiProvider !== 'firstParty'")
    expect(exitPlanSrc).toContain('planModelSupportsAutoMode')

    const bashSrc = await readFile(
      join(
        import.meta.dir,
        '../permissions/BashPermissionRequest/BashPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(bashSrc).toContain("apiProvider !== 'firstParty'")
    expect(bashSrc).toContain('planModelSupportsAutoMode')

    // #657: omitted proposedTier defaults to 'full' so full-access warnings still show
    const cuSrc = await readFile(
      join(
        import.meta.dir,
        '../permissions/ComputerUseApproval/ComputerUseApproval.tsx',
      ),
      'utf8',
    )
    expect(cuSrc).toContain("tier: a.proposedTier ?? 'full'")

    // #464 / 2.1.328 I2n: BaseTextInput renders Input children directly without
    // a fabricated overflowBadge extra row wrapper
    const btiSrc = await readFile(
      join(import.meta.dir, '../BaseTextInput.tsx'),
      'utf8',
    )
    expect(btiSrc).not.toContain('overflowBadge')
    expect(btiSrc).toContain(
      '<Text wrap="truncate-end" dimColor={props.dimColor}>',
    )

    // #466: /chrome adds select-browser option and passes isCancelActive={!inBrowserList}
    const chromeSrc = await readFile(
      join(import.meta.dir, '../../commands/chrome/chrome.tsx'),
      'utf8',
    )
    expect(chromeSrc).toContain("value: 'select-browser'")
    expect(chromeSrc).toContain('isCancelActive={!inBrowserList}')

    // #619: Bedrock access keys step maintains editable cursorOffsets and persists AWS credentials
    const oauthSrc = await readFile(
      join(import.meta.dir, '../ConsoleOAuthFlow.tsx'),
      'utf8',
    )
    expect(oauthSrc).toContain('function BedrockAccessKeysStep')
    expect(oauthSrc).toContain('AWS_ACCESS_KEY_ID')
    expect(oauthSrc).toContain('CLAUDE_CODE_USE_BEDROCK')
  })
})
