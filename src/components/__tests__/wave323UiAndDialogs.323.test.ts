import { afterEach, describe, expect, test } from 'bun:test'
import {
  formatSpendLimitAdjustRow,
  isCreditsRequiredRateLimit,
  resolveLoadedSpendLimit,
  SPEND_LIMIT_LOAD_FAILED_MESSAGE,
} from '../../commands/rate-limit-options/rate-limit-options.js'
import { formatEffortEnvOverrideNotice } from '../../commands/model/model.js'
import {
  formatFeedbackFailureMessage,
  isFeedbackTimeoutError,
  submitFeedback,
} from '../Feedback.js'
import { resolveWelcomeHeaderEffort } from '../LogoV2/CondensedLogo.js'
import { loadRewindDiffStatsWithBudget } from '../MessageSelector.js'
import {
  applyEffortEnvOverride,
  highlightNewestModelOption,
  NEWEST_MODEL_HIGHLIGHT_NAME,
} from '../ModelPicker.js'
import {
  BEHAVIOR_CARDS,
  buildUsageRecommendations,
  formatLimitedSignInUsageNotice,
} from '../Settings/Usage.js'
import { getRelativeMemoryPath } from '../memory/MemoryUpdateNotification.js'
import {
  getDisplayOnlyMcpTool,
  parseDisplayMcpToolName,
} from '../messages/displayOnlyMcpTool.js'
import { spellOutTerminalControlSequences } from '../messages/UserTeammateMessage.js'
import type { UserMessage } from '../../types/message.js'
import type { UUID } from 'crypto'

const savedEffortEnv = process.env.CLAUDE_CODE_EFFORT_LEVEL

afterEach(() => {
  if (savedEffortEnv === undefined) {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  } else {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = savedEffortEnv
  }
})

describe('Wave 323 UI, Dialogs, Usage, ModelPicker & Messages', () => {
  test('#1969 credits_required rate limit detection', () => {
    expect(
      isCreditsRequiredRateLimit({
        status: 'rejected',
        errorCode: 'credits_required',
      }),
    ).toBe(true)
    expect(
      isCreditsRequiredRateLimit({
        status: 'rejected',
        errorCode: 'credits_required',
        rateLimitType: 'overage',
      }),
    ).toBe(true)
    expect(
      isCreditsRequiredRateLimit({
        status: 'rejected',
        errorCode: 'credits_required',
        rateLimitType: 'five_hour',
      }),
    ).toBe(false)
  })

  test('#2108 spend limit menu treats missing current limit as unavailable instead of offering a lower limit', () => {
    expect(resolveLoadedSpendLimit(null)).toEqual({ loadFailed: true })
    expect(
      resolveLoadedSpendLimit({ monthly_limit: null, used_credits: null }),
    ).toEqual({ loadFailed: true })
    expect(
      resolveLoadedSpendLimit({ monthly_limit: 5000, used_credits: 7500 }),
    ).toEqual({ loadFailed: false, limitCents: 7500 })

    const row = formatSpendLimitAdjustRow({
      loadFailed: true,
      draftLimitCents: undefined,
      currentLimitCents: undefined,
      currency: 'USD',
    })
    expect(row.label).toBe('Adjust monthly spend limit: unavailable')
    expect(row.hint).toBe('')
    expect(SPEND_LIMIT_LOAD_FAILED_MESSAGE).toContain("Couldn't load")
  })

  test('#2033 display-only MCP tool fallback parses server and tool names', () => {
    expect(parseDisplayMcpToolName('mcp__github__list_issues')).toEqual({
      serverName: 'github',
      toolName: 'list_issues',
    })
    expect(parseDisplayMcpToolName('Bash')).toBeUndefined()
    const tool = getDisplayOnlyMcpTool('mcp__github__list_issues')
    expect(tool?.isMcp).toBe(true)
    expect(tool?.userFacingName?.({})).toBe('github - list_issues (MCP)')
  })

  test('#2061 getRelativeMemoryPath enforces directory boundaries and preserves slashes on Windows', () => {
    expect(
      getRelativeMemoryPath('/Users/alice-work/CLAUDE.md', {
        homeDir: '/Users/alice',
        cwd: '/Users/alice/app',
        pathSep: '/',
      }),
    ).toBe('/Users/alice-work/CLAUDE.md')
    expect(
      getRelativeMemoryPath('/Users/alice/app-v2/CLAUDE.md', {
        homeDir: '/Users/alice',
        cwd: '/Users/alice/app',
        pathSep: '/',
      }),
    ).toBe('~/app-v2/CLAUDE.md')
    expect(
      getRelativeMemoryPath('C:\\Users\\alice\\repo\\CLAUDE.md', {
        homeDir: 'C:\\Users\\alice',
        cwd: 'C:\\Users\\alice\\repo',
        pathSep: '\\',
      }),
    ).toBe('./CLAUDE.md')
    expect(
      getRelativeMemoryPath('C:\\Users\\alice\\other\\CLAUDE.md', {
        homeDir: 'C:\\Users\\alice',
        cwd: 'C:\\Users\\alice\\repo',
        pathSep: '\\',
      }),
    ).toBe('~/other/CLAUDE.md')
  })

  test('#2085 loadRewindDiffStatsWithBudget returns older labels promptly when working-tree read hangs', async () => {
    const id1 = '11111111-1111-4111-8111-111111111111' as UUID
    const id2 = '22222222-2222-4222-8222-222222222222' as UUID
    const currentId = '33333333-3333-4333-8333-333333333333' as UUID
    const makeMsg = (uuid: UUID): UserMessage =>
      ({
        type: 'user',
        uuid,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'hi' },
      }) as unknown as UserMessage
    const controller = new AbortController()
    const partials: Array<Record<number, unknown>> = []
    const res = await loadRewindDiffStatsWithBudget({
      messageOptions: [makeMsg(id1), makeMsg(id2), makeMsg(currentId)],
      messages: [],
      fileHistory: {
        snapshots: [
          { messageId: id1, trackedFileBackups: {}, timestamp: new Date() },
          { messageId: id2, trackedFileBackups: {}, timestamp: new Date() },
        ],
        trackedFiles: new Set<string>(),
        snapshotSequence: 2,
      },
      currentUUID: currentId,
      preClearUUID: 'pre',
      extraEntryUUID: 'extra',
      signal: controller.signal,
      budgetMs: 25,
      canRestore: () => true,
      onPartialUpdate: p => partials.push(p),
      // Simulate permanently hung NFS/network folder read on working tree
      computeWorkingTreeDiff: () => new Promise(() => {}),
      computeBetweenMessagesDiff: fromId => ({
        filesChanged: [fromId === id1 ? 'old.ts' : 'latest.ts'],
        insertions: 1,
        deletions: 0,
      }),
    })
    expect(res[0]?.filesChanged).toEqual(['old.ts'])
    expect(partials.length).toBeGreaterThan(0)
  })

  test('#2087 timed-out feedback send is reported as timed out, never too large', async () => {
    expect(isFeedbackTimeoutError({ code: 'ECONNABORTED' })).toBe(true)
    expect(isFeedbackTimeoutError({ code: 'ETIMEDOUT' })).toBe(true)
    const timeoutErr = new Error('timed out')
    timeoutErr.name = 'TimeoutError'
    expect(isFeedbackTimeoutError(timeoutErr)).toBe(true)

    const msg = formatFeedbackFailureMessage({
      success: false,
      failureReason: 'timeout',
      payloadTooLarge: true,
    })
    expect(msg).toContain('request timed out')
    expect(msg).not.toContain('too large')

    const submitted = await submitFeedback(
      {
        latestAssistantMessageId: null,
        message_count: 1,
        datetime: new Date().toISOString(),
        description: 'bug',
        platform: 'macos',
        gitRepo: false,
        version: '2.1.323',
        transcript: [],
      },
      undefined,
      async () => ({ success: false, failureReason: 'timeout' }),
    )
    expect(submitted.failureReason).toBe('timeout')
  })

  test('#2092 fullscreen header does not show session effort for viewed subagent on different model', () => {
    const resolved = resolveWelcomeHeaderEffort({
      viewingAgentTaskId: 'agent-1',
      tasks: {
        'agent-1': {
          type: 'local_agent',
          selectedAgent: { model: 'haiku' },
        },
      },
      sessionModel: 'claude-opus-4-7',
      sessionEffort: 'max',
    })
    expect(resolved).toBeUndefined()

    const sameModel = resolveWelcomeHeaderEffort({
      viewingAgentTaskId: 'agent-2',
      tasks: {
        'agent-2': {
          type: 'local_agent',
          selectedAgent: { model: 'claude-opus-4-7' },
        },
      },
      sessionModel: 'claude-opus-4-7',
      sessionEffort: 'high',
    })
    expect(sameModel).toBe('high')
  })

  test('#2093 & #2095 CLAUDE_CODE_EFFORT_LEVEL override and newest model highlight', () => {
    expect(applyEffortEnvOverride('high', 'low')).toBe('low')
    expect(applyEffortEnvOverride('high', null)).toBeUndefined()
    expect(applyEffortEnvOverride('high', undefined)).toBe('high')

    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low'
    const notice = formatEffortEnvOverrideNotice('high', 'claude-opus-4-7')
    expect(notice).toBe('effort stays low (set by CLAUDE_CODE_EFFORT_LEVEL)')

    const highlighted = highlightNewestModelOption(
      {
        label: NEWEST_MODEL_HIGHLIGHT_NAME,
        description: `${NEWEST_MODEL_HIGHLIGHT_NAME} · Most capable`,
      },
      'dark',
    )
    expect(highlighted.labelColor).toBe('claude')
  })

  test('#2098 spellOutTerminalControlSequences neutralizes ESC/CSI/OSC/bidi sequences', () => {
    const out = spellOutTerminalControlSequences(
      'hello \x1b[31mred\x1b[0m \u202eok',
    )
    expect(out.spelledTotal).toBeGreaterThan(0)
    expect(out.text).not.toContain('\x1b')
    expect(out.text).toContain('\\u{1B}[31m')
    expect(out.text).toContain('\\u{202E}')
  })

  test('#2109 & #2110 /usage limited sign-in notice, cron active-hours wording, and subagent recommendation', () => {
    const withBars = formatLimitedSignInUsageNotice(true)
    expect(withBars.headline).toContain(
      "Other limits and usage credits aren't shown for this sign-in.",
    )
    expect(withBars.linkLine).toContain('/settings/usage')

    const noBars = formatLimitedSignInUsageNotice(false)
    expect(noBars.headline).toBe('No usage limits to show for this sign-in.')

    expect(BEHAVIOR_CARDS.cron.headline(40)).toContain('8+ separate hours')
    expect(BEHAVIOR_CARDS.cron.headline(40)).not.toContain(
      'active for 8+ hours',
    )

    const recs = buildUsageRecommendations({
      totalCost: 100,
      requestCount: 10,
      sessionCount: 2,
      behaviors: [{ key: 'subagent_heavy', cost: 60, count: 2 }],
      warningBehaviors: [{ key: 'workflow', cost: 30, count: 1 }],
      agents: [
        { name: 'workflow', pct: 30 },
        { name: 'Explore', pct: 25 },
      ],
      skills: [],
      plugins: [],
      mcpServers: [],
      loops: [],
    })
    const agentRec = recs.find(r => r.key === 'agent')
    expect(agentRec?.title).toContain('Explore')
    expect(agentRec?.pct).toBe(25)
    expect(recs.some(r => r.key === 'subagent_heavy')).toBe(false)
  })
})
