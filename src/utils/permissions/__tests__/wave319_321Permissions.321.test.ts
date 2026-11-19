import { afterEach, describe, expect, test } from 'bun:test'
import {
  ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
  checkAccountEmailUserAgent,
  isAccountEmailUserAgentRefused,
  namesUserAgentWithAddress,
} from '../accountEmailUserAgentCheck.js'
import {
  formatAutoModeNoServerCheckNotice,
  formatServerUnavailableInputTooLongDetail,
  isConsecutiveUnavailableErrorKind,
  SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
} from '../autoModeUnavailable.js'
import {
  denyRestrictedFileToolOutsideCwd,
  findCaseOnlyWorkingDirMatch,
} from '../filesystem.js'
import {
  applyDenyInsteadOfPrompting,
  avoidsPromptsByNature,
  hasMatchedAskRule,
} from '../permissions.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { getOriginalCwd } from '../../../bootstrap/state.js'

describe('Wave 319-321 Group 1: Core Permissions (#1703, #1730, #1796, #1807, #1958)', () => {
  test('#1703 applyDenyInsteadOfPrompting & avoidsPromptsByNature preserve natural headless vs setting', () => {
    const base = getEmptyToolPermissionContext()
    const applied = applyDenyInsteadOfPrompting(base)
    expect(Boolean(applied.shouldAvoidPermissionPrompts)).toBe(false)

    const withSettingOnly = {
      ...base,
      shouldAvoidPermissionPrompts: true,
      denyInsteadOfPrompting: true,
      avoidsPromptsByNature: false,
    } as ToolPermissionContext
    expect(avoidsPromptsByNature(withSettingOnly)).toBe(false)

    const naturalHeadless = {
      ...base,
      shouldAvoidPermissionPrompts: true,
      denyInsteadOfPrompting: true,
      avoidsPromptsByNature: true,
    } as ToolPermissionContext
    expect(avoidsPromptsByNature(naturalHeadless)).toBe(true)

    const legacyHeadless = {
      ...base,
      shouldAvoidPermissionPrompts: true,
    } as ToolPermissionContext
    expect(avoidsPromptsByNature(legacyHeadless)).toBe(true)
  })

  test('#1730 server_call_unavailable_input_too_long detail, consecutive tracking, and context_too_large notice', () => {
    expect(
      formatServerUnavailableInputTooLongDetail(
        SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
      ),
    ).toBe(' (the conversation is too long for the check)')
    expect(formatServerUnavailableInputTooLongDetail('other')).toBeUndefined()
    expect(
      isConsecutiveUnavailableErrorKind(
        SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
        true,
      ),
    ).toBe(true)

    const askNotice = formatAutoModeNoServerCheckNotice({
      why: 'context_too_large',
      asks: true,
    })
    expect(askNotice).toContain('too large to send to it')
    expect(askNotice).toContain('ask for your approval')
    expect(askNotice).toContain('under about 1 MB')

    const denyNotice = formatAutoModeNoServerCheckNotice({
      why: 'context_too_large',
      asks: false,
      heldByDenyRules: true,
    })
    expect(denyNotice).toContain('auto mode deny rules')
    expect(denyNotice).toContain('you are not asked')
  })

  test('#1796 findCaseOnlyWorkingDirMatch detects case-only diff on macOS/Windows and skips Linux', () => {
    const dirs = new Set(['/Users/apple/myrepo'])
    expect(
      findCaseOnlyWorkingDirMatch('/Users/Apple/myrepo/src/a.ts', dirs, {
        platform: 'macos',
      }),
    ).toBe('/Users/apple/myrepo/src/a.ts')
    expect(
      findCaseOnlyWorkingDirMatch('/Users/Apple/myrepo/src/a.ts', dirs, {
        platform: 'linux',
      }),
    ).toBeUndefined()
    expect(
      findCaseOnlyWorkingDirMatch('/Users/Apple/myrepo/src/a.ts', dirs, {
        platform: 'macos',
        landingOutside: true,
      }),
    ).toBeUndefined()

    const winDirs = new Set(['C:\\Users\\alice\\Repo'])
    expect(
      findCaseOnlyWorkingDirMatch('c:\\users\\alice\\repo\\file.ts', winDirs, {
        platform: 'windows',
      }),
    ).toBe('C:\\Users\\alice\\Repo\\file.ts')

    // Integration with denyRestrictedFileToolOutsideCwd on macOS when cwd case differs
    const origCwd = getOriginalCwd()
    const flipped =
      origCwd.length > 2
        ? origCwd.replace(/[a-z]/, c => c.toUpperCase()) + '/foo.txt'
        : null
    if (
      flipped &&
      flipped !== `${origCwd}/foo.txt` &&
      process.platform === 'darwin'
    ) {
      const ctx: ToolPermissionContext = {
        ...getEmptyToolPermissionContext(),
        restricted: true,
      }
      const deny = denyRestrictedFileToolOutsideCwd(flipped, ctx, [flipped])
      expect(deny?.behavior).toBe('deny')
      expect(deny?.message).toContain('letter case counts:')
      expect(deny?.message).toContain('is inside)')
    }
  })

  test('#1807 hasMatchedAskRule catches direct ask rule, nested subcommand ask rule, and matchedAskRule (Monitor ws)', () => {
    const rule = {
      source: 'userSettings' as const,
      ruleBehavior: 'ask' as const,
      ruleValue: { toolName: 'Bash', ruleContent: '*' },
    }
    expect(
      hasMatchedAskRule({
        behavior: 'ask',
        message: 'Monitor will open a WebSocket to wss://example.com',
        matchedAskRule: rule,
      }),
    ).toBe(true)
    expect(
      hasMatchedAskRule({
        behavior: 'ask',
        message: 'Ask',
        decisionReason: { type: 'rule', rule },
      }),
    ).toBe(true)
    expect(
      hasMatchedAskRule({
        behavior: 'ask',
        message: 'Plain ask',
        decisionReason: { type: 'other', reason: 'no rule' },
      }),
    ).toBe(false)
    expect(
      hasMatchedAskRule({
        behavior: 'allow',
        updatedInput: {},
      }),
    ).toBe(false)
  })

  test('#1958 tengu_wise_newt refuses shell command holding account email beside User-Agent without asking', async () => {
    const email = 'alice.dev@example.com'
    expect(
      namesUserAgentWithAddress(
        `curl -A "MyBot/1.0 (${email})" https://api.example.com`,
        email,
      ),
    ).toBe(true)
    expect(
      namesUserAgentWithAddress(
        `curl -H "User-Agent: app ${email}" https://api.example.com`,
        email,
      ),
    ).toBe(true)
    // Email alone without User-Agent is allowed
    expect(namesUserAgentWithAddress(`echo "contact: ${email}"`, email)).toBe(
      false,
    )
    // User-Agent alone without account email is allowed
    expect(
      namesUserAgentWithAddress(
        `curl -A "MyBot/1.0 (ops@other.org)" https://api.example.com`,
        email,
      ),
    ).toBe(false)
    // WebFetch URL containing email is refused
    expect(
      isAccountEmailUserAgentRefused(
        'WebFetch',
        { url: `https://example.com/api?contact=${encodeURIComponent(email)}` },
        email,
      ),
    ).toBe(true)

    const decision = await checkAccountEmailUserAgent(
      'Bash',
      { command: `curl -A "bot ${email}" https://sec.gov/data` },
      { email },
    )
    expect(decision?.behavior).toBe('deny')
    expect(decision?.message).toBe(ACCOUNT_EMAIL_USER_AGENT_REFUSAL)
  })
})
