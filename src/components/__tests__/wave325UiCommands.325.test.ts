import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { findVoiceEnabledOverrideMessage } from '../../commands/voice/voice.js'
import { formatEmptyVoiceTranscriptError } from '../../hooks/useVoice.js'
import { deriveBand, deriveStatsBand } from '../../screens/fleetView/helpers.js'
import { fleetLoBand } from '../../screens/fleetView/fhFields.js'
import {
  checkCrossProjectResume,
  findContainingWorktreePath,
  isSameResumeProjectPath,
  normalizeResumeProjectPath,
} from '../../utils/crossProjectResume.js'
import { collapseFocusTranscript } from '../../utils/focusTranscript.js'
import {
  sanitizeWelcomeAgentName,
  sanitizeWelcomeCwd,
} from '../../utils/logoV2Utils.js'
import { calculateTotalDaysSpan } from '../../utils/stats.js'
import { formatDesktopSignInError } from '../DesktopHandoff.js'
import {
  classifyTranscriptOwnership,
  isTranscriptOwnedByCurrentAccountOrOrg,
} from '../Feedback.js'
import { DLP_BLOCKED_GUIDANCE_LINE } from '../messages/AssistantTextMessage.js'
import {
  extractUserOnlyCommandError,
  isSafeUserOnlyCommandName,
} from '../messages/UserToolResultMessage/UserToolErrorMessage.js'

describe('Wave 325 Group 4 — UI, Tips, Dialogs & Slash Commands', () => {
  test('#2259 & #2280: notebook rerun spinner tip and install-slack-app cloud policy check in tipRegistry', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/tips/tipRegistry.ts'),
      'utf8',
    )
    expect(src).toContain("id: 'vscode-notebook-rerun-edited-cell'")
    expect(src).toContain('isSupportedVSCodeTerminal()')
    expect(src).toContain(".toLowerCase().endsWith('.ipynb')")
    expect(src).toContain("isRemotePolicyAllowed('allow_remote_sessions')")
    expect(src).toContain("advertisedCommand: 'install-slack-app'")
  })

  test('#2260: DLP blocked guidance line renders under dlp_request_denied top-level errors', () => {
    expect(DLP_BLOCKED_GUIDANCE_LINE).toContain('/rewind')
    expect(DLP_BLOCKED_GUIDANCE_LINE).toContain('/clear')
    const src = readFileSync(
      resolve(
        process.cwd(),
        'src/components/messages/AssistantTextMessage.tsx',
      ),
      'utf8',
    )
    expect(src).toContain("apiError === 'dlp_request_denied'")
    expect(src).toContain('DlpBlockedGuidanceLine')
  })

  test('#2270: focus view keeps assistant reply to user prompt visible when scheduled task fires after it', () => {
    const messages = [
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Summarize the build' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Build succeeded with 0 errors.' }],
        },
      },
      {
        type: 'system',
        subtype: 'scheduled_task_fire',
        uuid: 's1',
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Scheduled check OK.' }],
        },
      },
    ] as Parameters<typeof collapseFocusTranscript>[0]

    const result = collapseFocusTranscript(messages, undefined, undefined)
    const visibleUuids = result.map(item => item.uuid)
    expect(visibleUuids).toContain('u1')
    expect(visibleUuids).toContain('a1')
    expect(visibleUuids).toContain('a2')
  })

  test('#2271: REPL holds non-fullscreen background subagent messages until disk transcript loads', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain('!isFullscreenEnvEnabled()')
    expect(src).toContain('!viewedAgentTask.diskLoaded')
  })

  test('#2272: Select option row avoids flexShrink=0 overwrite and WelcomeV2 checks narrow terminals', () => {
    const selectSrc = readFileSync(
      resolve(process.cwd(), 'src/components/CustomSelect/select.tsx'),
      'utf8',
    )
    const welcomeSrc = readFileSync(
      resolve(process.cwd(), 'src/components/LogoV2/WelcomeV2.tsx'),
      'utf8',
    )
    expect(selectSrc).toContain('<Box flexShrink={0}>')
    expect(welcomeSrc).toContain('WELCOME_V2_MIN_COLUMNS')
  })

  test('#2273: LogoV2 gates permission-warning and MCP needs-auth seen markers on viewport visibility', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    expect(src).toContain('tryMarkPermissionWarningsSeenIfVisible')
    expect(src).toContain('tryMarkMcpNeedsAuthSeenIfVisible')
    expect(src).toContain('PermissionRuleWarningsSeenObserver')
    expect(src).toContain('McpNeedsAuthSeenObserver')
  })

  test('#2274: welcome header agent name and cwd strip ANSI, control chars, bidi, and newlines', () => {
    expect(
      sanitizeWelcomeAgentName('\x1b[31mbot\x1b[0m\nnext\tline\u202eevil'),
    ).toBe('bot next lineevil')
    expect(sanitizeWelcomeCwd('/tmp/\x1b]0;title\x07dir\r\nsub\x00dir')).toBe(
      '/tmp/dir subdir',
    )
  })

  test('#2275: user-only command errors extract safe command name for dim hint rendering', () => {
    expect(isSafeUserOnlyCommandName('clear')).toBe(true)
    expect(isSafeUserOnlyCommandName('my-plugin:run_1')).toBe(true)
    expect(isSafeUserOnlyCommandName('bad cmd!')).toBe(false)
    expect(
      extractUserOnlyCommandError(
        'Skill deploy cannot be used with Skill tool due to disable-model-invocation.',
      ),
    ).toBe('deploy')
    expect(
      extractUserOnlyCommandError(
        '/compact is a built-in CLI command, not a skill.',
      ),
    ).toBe('compact')
    expect(
      extractUserOnlyCommandError('ENOENT: file not found'),
    ).toBeUndefined()
  })

  test('#2276: /stats calculateTotalDaysSpan does not overcount by 1 day', () => {
    expect(calculateTotalDaysSpan('2026-04-01', '2026-04-01')).toBe(1)
    expect(calculateTotalDaysSpan('2026-04-01', '2026-04-02')).toBe(2)
    expect(calculateTotalDaysSpan('2026-04-01', '2026-04-10')).toBe(10)
    expect(calculateTotalDaysSpan('2026-04-10', '2026-04-01')).toBe(1)
  })

  test('#2277: /insights guards zero qualifying sessions and escapes HTML fields', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/commands/insights.ts'),
      'utf8',
    )
    expect(src).toContain('data.total_sessions === 0')
    expect(src).toContain('escapeHtml(String(area.session_count))')
    expect(src).toContain('escapeHtml(data.date_range.start)')
    expect(src).toContain('escapeHtml(data.date_range.end)')
  })

  test('#2278: /voice detects higher-precedence voiceEnabled override and names the source', () => {
    const msg = findVoiceEnabledOverrideMessage(
      false,
      () => ['userSettings', 'projectSettings'],
      source =>
        source === 'projectSettings'
          ? ({ voiceEnabled: false } as ReturnType<
              typeof import('../../utils/settings/settings.js').getSettingsForSource
            >)
          : null,
    )
    expect(msg).not.toBeNull()
    expect(msg).toContain('.claude/settings.json')
    expect(msg).toContain('off')

    const noOverride = findVoiceEnabledOverrideMessage(
      false,
      () => ['userSettings', 'projectSettings'],
      () => null,
    )
    expect(noOverride).toBeNull()
  })

  test('#2279: IdeOnboardingDialog adapts Quick Launch shortcut for macOS vs Windows/Linux', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/IdeOnboardingDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("const isMac = env.platform === 'darwin'")
    expect(src).toContain("isMac ? 'Cmd+Esc' : 'Ctrl+Esc'")
  })

  test('#2292: ExitBackgroundWorkDialog focuses stay on refusal so second Enter does not kill work', () => {
    const dialogSrc = readFileSync(
      resolve(process.cwd(), 'src/components/ExitBackgroundWorkDialog.tsx'),
      'utf8',
    )
    const exitFlowSrc = readFileSync(
      resolve(process.cwd(), 'src/components/ExitFlow.tsx'),
      'utf8',
    )
    expect(dialogSrc).toContain(
      "const defaultFocusValue: Choice | undefined = refusal === undefined ? undefined : 'stay'",
    )
    expect(exitFlowSrc).toContain('refusal={refusal}')
  })

  test('#2297: finished PR needing only user review/merge is classified as completed, not blocked', () => {
    const row = {
      status: 'waiting',
      lastMessage: 'PR #42 is ready for your review and merge',
      waitingFor: 'your review and merge',
      detail: 'PR #42 is ready for your review and merge',
      needs: 'your review and merge',
      tempo: 'blocked',
      state: 'running',
      liveStatus: 'waiting',
    }
    expect(deriveBand(row as unknown as Parameters<typeof deriveBand>[0])).toBe(
      'completed',
    )
    expect(
      deriveStatsBand(row as unknown as Parameters<typeof deriveStatsBand>[0]),
    ).toBe('completed')
    expect(
      fleetLoBand(row as unknown as Parameters<typeof fleetLoBand>[0]),
    ).toBe('completed')
  })

  test('#2320: /feedback ownership check admits only transcripts owned by current account or org', () => {
    const acctLine = JSON.stringify({
      type: 'session-owner',
      accountUuid: 'acct-1',
      organizationUuid: 'org-1',
    })
    const orgLine = JSON.stringify({
      type: 'attachment',
      attachment: { type: 'credential_org', organizationUuid: 'org-1' },
    })
    const otherAcctLine = JSON.stringify({
      type: 'session-owner',
      accountUuid: 'acct-2',
      organizationUuid: 'org-2',
    })
    expect(
      classifyTranscriptOwnership(
        [acctLine],
        { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        'org-1',
      ),
    ).toBe('account')
    expect(
      classifyTranscriptOwnership(
        [orgLine],
        { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        'org-1',
      ),
    ).toBe('organization')
    expect(
      classifyTranscriptOwnership(
        [otherAcctLine],
        { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        'org-1',
      ),
    ).toBe('other')
    expect(
      isTranscriptOwnedByCurrentAccountOrOrg(
        [otherAcctLine],
        { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        'org-1',
      ),
    ).toBe(false)
    expect(
      isTranscriptOwnedByCurrentAccountOrOrg(
        [acctLine],
        { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        'org-1',
      ),
    ).toBe(true)
  })

  test('#2336: TeleportStash checks index.lock and refuses non-zero diff-index', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/TeleportStash.tsx'),
      'utf8',
    )
    expect(src).toContain('checkGitIndexLockForStash')
    expect(src).toContain('index.lock')
    expect(src).toContain('TeleportStashRefusalError')
  })

  test('#2338: crossProjectResume normalizes Windows drive-letter case and slashes', async () => {
    expect(
      normalizeResumeProjectPath('C:\\Users\\Dev\\Repo\\', 'windows'),
    ).toBe('c:/Users/Dev/Repo')
    expect(
      isSameResumeProjectPath(
        'c:/Users/Dev/Repo',
        'C:\\Users\\Dev\\Repo\\',
        'windows',
      ),
    ).toBe(true)
    expect(
      findContainingWorktreePath(
        'c:/Users/Dev/Repo/sub/pkg',
        ['C:\\Users\\Dev\\Repo'],
        'windows',
      ),
    ).toBe('C:\\Users\\Dev\\Repo')

    const res = await checkCrossProjectResume(
      { projectPath: process.cwd() } as Parameters<
        typeof checkCrossProjectResume
      >[0],
      true,
      [],
    )
    expect(res).toBeNull()
  })

  test('#2347: claude --desktop sign-in error names blocking API key, provider, or setting', () => {
    const apiKeyMsg = formatDesktopSignInError({
      provider: 'firstParty',
      apiKeySource: 'ANTHROPIC_API_KEY',
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    })
    expect(apiKeyMsg).toContain('ANTHROPIC_API_KEY')

    const bedrockMsg = formatDesktopSignInError({
      provider: 'bedrock',
      env: { CLAUDE_CODE_USE_BEDROCK: '1' },
    })
    expect(bedrockMsg).toContain('Amazon Bedrock')
    expect(bedrockMsg).toContain('CLAUDE_CODE_USE_BEDROCK')

    const forceLoginMsg = formatDesktopSignInError({
      provider: 'firstParty',
      forceLoginMethod: 'console',
      env: {},
    })
    expect(forceLoginMsg).toContain('forceLoginMethod')
    expect(forceLoginMsg).toContain('console')
  })

  test('#2348: /voice empty audio error points to macOS and Windows microphone settings', () => {
    expect(
      formatEmptyVoiceTranscriptError(
        { hadAudioSignal: false, wsConnected: true },
        'macos',
      ).message,
    ).toContain('System Settings → Sound → Input')
    expect(
      formatEmptyVoiceTranscriptError(
        { hadAudioSignal: false, wsConnected: true },
        'windows',
      ).message,
    ).toContain('Settings → System → Sound → Input')
    expect(
      formatEmptyVoiceTranscriptError(
        { hadAudioSignal: true, wsConnected: true },
        'linux',
      ).message,
    ).toContain('No speech detected')
  })
})
