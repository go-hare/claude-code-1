import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ClipboardAttacherCaps } from '@anthropic/ink'
import {
  formatAntConsoleOrganization,
  getAntAuthFallbackNotice,
  getAntAuthLoginStartupLine,
} from '../../commands/login/getAuthStatus.js'
import {
  formatGatewayUnlimitedSpend,
  parseGatewaySpendReading,
} from '../Settings/Usage.js'
import {
  AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL,
  linkifyClassifierBillingUrl,
  serverCheckDeclined,
  setServerCheckDeclined,
} from '../../services/api/autoModeServerFallbackNotice.js'
import type { CommandResultDisplay } from '../../types/command.js'
import type { AggregatedHookResult as CoreAggregatedHookResult } from '../../types/hooks.js'
import type { LogOption } from '../../types/logs.js'
import type { AggregatedHookResult as UtilAggregatedHookResult } from '../../utils/hooks/hookTypes.js'
import {
  AUTO_MODE_SERVER_DOCS_URL,
  buildAutoModeServerProperties,
  linkifyStatusText,
} from '../../utils/status.js'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('Wave 319-322 Batch B cross-group wiring', () => {
  afterEach(() => {
    setServerCheckDeclined(false)
  })

  test('0: useFastModeNotification exhaustively handles all CooldownReason variants including refused', () => {
    const src = readFileSync(
      join(ROOT, 'src/hooks/notifs/useFastModeNotification.tsx'),
      'utf8',
    )
    expect(src).toContain("case 'refused':")
    expect(src).toContain("case 'server_error':")
    expect(src).toContain("case 'timeout':")
    expect(src).toContain(
      'Fast mode paused: your cloud provider refused a fast request',
    )
  })

  test('1 (#1723): CommandResultDisplay includes displayOnly and context.tsx drops redundant cast', () => {
    const display: CommandResultDisplay = 'displayOnly'
    expect(display).toBe('displayOnly')
    const ctxSrc = readFileSync(
      join(ROOT, 'src/commands/context/context.tsx'),
      'utf8',
    )
    expect(ctxSrc).toContain("display: 'displayOnly'")
    expect(ctxSrc).not.toContain("'displayOnly' as CommandResultDisplay")
  })

  test('2 (#1868): AggregatedHookResult declares hostsOwnAsk and serversOwnAsk in both type modules', () => {
    const coreRes: CoreAggregatedHookResult = {
      hostsOwnAsk: true,
      serversOwnAsk: false,
    }
    const utilRes: UtilAggregatedHookResult = {
      hostsOwnAsk: false,
      serversOwnAsk: true,
    }
    expect(coreRes.hostsOwnAsk).toBe(true)
    expect(utilRes.serversOwnAsk).toBe(true)
  })

  test('3 (#1945): built-in PostToolUse callback hook marks internal: true', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/sessionFileAccessHooks.ts'),
      'utf8',
    )
    expect(src).toContain('internal: true')
  })

  test('4 (#1750): ClipboardAttacherCaps declares isGhosttyXtv and terminal.ts reads it', () => {
    const caps: ClipboardAttacherCaps = { isGhosttyXtv: true, hyperlinks: true }
    expect(caps.isGhosttyXtv).toBe(true)
    const oscSrc = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/core/termio/osc.ts'),
      'utf8',
    )
    expect(oscSrc).toContain('isGhosttyXtv?: boolean')
    const termSrc = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/core/terminal.ts'),
      'utf8',
    )
    expect(termSrc).toContain('isGhosttyXtv')
  })

  test('5 (#1752): LogOption declares forkedFromSessionId and copyFileHistoryForResume prefers it', () => {
    const opt: Partial<LogOption> = { forkedFromSessionId: 'parent-session-id' }
    expect(opt.forkedFromSessionId).toBe('parent-session-id')
    const fhSrc = readFileSync(join(ROOT, 'src/utils/fileHistory.ts'), 'utf8')
    expect(fhSrc).toContain('log.forkedFromSessionId ?? lastMessage?.sessionId')
  })

  test('6 (#1741): LocalShellTask awaits shellCommand.outputEnded with bounded guard before flush & notify', () => {
    const src = readFileSync(
      join(ROOT, 'src/tasks/LocalShellTask/LocalShellTask.tsx'),
      'utf8',
    )
    const outputEndedIdx = src.indexOf('shellCommand.outputEnded')
    const flushIdx = src.indexOf('await shellCommand.taskOutput.flush()')
    expect(outputEndedIdx).toBeGreaterThan(-1)
    expect(flushIdx).toBeGreaterThan(outputEndedIdx)
    expect(src).toContain('Promise.race')
  })

  test('7 (#1725): fileSuggestions awaits shouldSkipStartupFileIndexing before full indexing', () => {
    const src = readFileSync(join(ROOT, 'src/hooks/fileSuggestions.ts'), 'utf8')
    const skipIdx = src.indexOf('await shouldSkipStartupFileIndexing(cwd)')
    const projIdx = src.indexOf('getProjectFiles(signal, respectGitignore)')
    expect(skipIdx).toBeGreaterThan(-1)
    expect(projIdx).toBeGreaterThan(skipIdx)
  })

  test('8 (#1767 & #1860): useReplBridge wires syncBridgeRateLimitInfo and getInitializeCommands', () => {
    const src = readFileSync(join(ROOT, 'src/hooks/useReplBridge.tsx'), 'utf8')
    expect(src).toContain('syncBridgeRateLimitInfo')
    expect(src).toContain('statusListeners.add(')
    expect(src).toContain('getInitializeCommands: () => commandsRef.current')
  })

  test('9 (#1712 & #1713): ant_profile fallback wires detectActiveConsoleFallbackCredential and getExpiredClaudeAiAntProfileWarning across auth/LogoV2/WelcomeV2/REPL', () => {
    const startupLine = getAntAuthLoginStartupLine({
      forceActive: true,
      organizationName: 'Acme Corp',
    })
    expect(startupLine).toContain('Acme Corp (Claude Console)')
    expect(formatAntConsoleOrganization('Acme Corp')).toBe(
      'Acme Corp (Claude Console)',
    )

    const endedNotice = getAntAuthFallbackNotice({
      forceActive: true,
      loginEnded: true,
      organizationName: 'Acme Corp',
    })
    expect(endedNotice?.reason).toBe('login_ended')
    expect(endedNotice?.text).toContain('Your claude.ai login ended')
    expect(endedNotice?.text).toContain('Acme Corp (Claude Console)')

    const authStatusSrc = readFileSync(
      join(ROOT, 'src/commands/login/getAuthStatus.ts'),
      'utf8',
    )
    expect(authStatusSrc).toContain('detectActiveConsoleFallbackCredential')
    expect(authStatusSrc).toContain('getExpiredClaudeAiAntProfileWarning')

    const logoSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    expect(logoSrc).toContain('getAntAuthFallbackNotice')
    const welcomeSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/WelcomeV2.tsx'),
      'utf8',
    )
    expect(welcomeSrc).toContain('getAntAuthFallbackNotice')
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('getAntAuthFallbackNotice')
    expect(replSrc).toContain('auth-profile-billing-notice')
  })

  test('10 (#1727): runtime serverCheckDeclined wires into buildAutoModeServerProperties and Status.tsx with OSC-8 links', () => {
    expect(serverCheckDeclined()).toBe(false)
    setServerCheckDeclined(true)
    expect(serverCheckDeclined()).toBe(true)

    const props = buildAutoModeServerProperties('auto')
    expect(props[0]?.label).toBe('Auto mode server')
    expect(props[0]?.value).toContain('Not reaching this session:')
    expect(props[0]?.value).toContain(AUTO_MODE_SERVER_DOCS_URL)
    expect(props[0]?.linkify).toBe(true)

    const linked = linkifyStatusText(
      `Docs: ${AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL}`,
    )
    expect(Array.isArray(linked)).toBe(true)
    expect(
      linkifyClassifierBillingUrl(AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL),
    ).toContain(AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL)

    const statusSrc = readFileSync(
      join(ROOT, 'src/components/Settings/Status.tsx'),
      'utf8',
    )
    expect(statusSrc).toContain('serverCheckDeclined()')
  })

  test('11 (#1706): Usage.tsx parses unlimited + capped gateway spend and passes spend into SpendLimitSection', () => {
    const unlimited = parseGatewaySpendReading({
      extra_usage: {
        monthly_limit: null,
        used_credits: 4200,
        currency: 'usd',
        daily: { used_credits: 125 },
        weekly: { used_credits: 1050 },
      },
    })
    expect(unlimited).toEqual({
      limit: null,
      currency: 'USD',
      used: { daily: 125, weekly: 1050, monthly: 4200 },
    })
    if (unlimited && unlimited.limit === null) {
      expect(formatGatewayUnlimitedSpend(unlimited)).toBe(
        '$1.25 today · $10.50 this week · $42.00 this month',
      )
    }

    const capped = parseGatewaySpendReading({
      extra_usage: {
        monthly_limit: 10000,
        used_credits: 2500,
        utilization: 25,
        currency: 'USD',
      },
      limits: [
        {
          is_active: true,
          group: 'monthly',
          resets_at: '2026-12-01T00:00:00.000Z',
        },
      ],
    })
    expect(capped).toEqual({
      limit: 10000,
      used: 2500,
      utilization: 25,
      resetsAt: '2026-12-01T00:00:00.000Z',
      currency: 'USD',
      period: 'monthly',
    })

    const usageSrc = readFileSync(
      join(ROOT, 'src/components/Settings/Usage.tsx'),
      'utf8',
    )
    expect(usageSrc).toContain(
      '<SpendLimitSection maxWidth={maxWidth} spend={spend} />',
    )
    expect(usageSrc).toContain('fetchGatewaySpendReading')
  })
})
