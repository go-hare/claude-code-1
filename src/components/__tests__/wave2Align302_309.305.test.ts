import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getDisplayPath } from '../../utils/file.js'
import { getEffortNotificationText } from '../EffortIndicator.js'
import {
  buildUsageFix,
  buildUsageRecommendations,
  formatFixDescription,
} from '../Settings/Usage.js'
import {
  ColdResumeQuotaConfigSchema,
  evaluateColdResumeQuota,
} from '../ColdResumeQuotaDialog.js'
import type { UsageScanWindow } from '../../utils/usageSessionScan.js'

const ROOT = join(import.meta.dir, '../..')

describe('Wave 2 2.1.302–2.1.309 alignment', () => {
  const prevEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  })
  afterEach(() => {
    if (prevEffort === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    else process.env.CLAUDE_CODE_EFFORT_LEVEL = prevEffort
  })

  test('#895 Config.tsx includes Idle compaction row and change summary', () => {
    const src = readFileSync(
      join(ROOT, 'components/Settings/Config.tsx'),
      'utf8',
    )
    expect(src).toContain("id: 'idleCompaction'")
    expect(src).toContain("label: 'Idle compaction'")
    expect(src).toContain('tengu_idle_compaction_setting_changed')
    expect(src).toContain('idle compaction')
  })

  test('#964 evaluateColdResumeQuota warns when 5-hour usage share >= minPercent', () => {
    const cfg = ColdResumeQuotaConfigSchema.parse({
      minPercent: 5,
      fiveHourCredits: { default_claude_max_5x: 100 },
      creditsPerMillionTokens: { 'claude-opus-4-7': 100 },
    })
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString()
    const offer = evaluateColdResumeQuota({
      messages: [
        { type: 'user', timestamp: oldTs },
        {
          type: 'assistant',
          timestamp: oldTs,
          message: { model: 'claude-opus-4-7' },
        },
      ],
      model: 'claude-opus-4-7',
      trigger: 'resume',
      estimateTokens: () => 250_000,
      rateLimitTier: 'default_claude_max_5x',
      config: cfg,
      resumeReturnDismissed: false,
    })
    expect(offer).not.toBeNull()
    expect(offer!.percentOfFiveHourLimit).toBe(25)
    expect(offer!.contextTokens).toBe(250_000)
  })

  test('#974 FileEditToolUseRejectedMessage uses getDisplayPath (no ../../ for outside-cwd)', () => {
    const src = readFileSync(
      join(ROOT, 'components/FileEditToolUseRejectedMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('getDisplayPath(file_path)')
    expect(src).not.toContain('relative(getCwd(), file_path)')
    const outsideHome = join(homedir(), 'outside-project-dir', 'foo.ts')
    expect(getDisplayPath(outsideHome)).toBe('~/outside-project-dir/foo.ts')
  })

  test('#990 EffortIndicator returns undefined when CLAUDE_CODE_EFFORT_LEVEL is auto or unset', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'auto'
    expect(
      getEffortNotificationText(undefined, 'claude-opus-4-7', false),
    ).toBeUndefined()
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'unset'
    expect(
      getEffortNotificationText(undefined, 'claude-opus-4-7', false),
    ).toBeUndefined()
  })

  test('#1052 buildUsageRecommendations + buildUsageFix + formatFixDescription', () => {
    const window: UsageScanWindow = {
      totalCost: 10,
      requestCount: 10,
      sessionCount: 2,
      behaviors: [
        { key: 'cache_miss', cost: 4, count: 2 },
        { key: 'subagent_heavy', cost: 3, count: 1 },
      ],
      warningBehaviors: [],
      agents: [{ name: 'reviewer', pct: 30 }],
      skills: [],
      plugins: [],
      mcpServers: [],
      loops: [],
      peakParallel: 1,
    }
    const recs = buildUsageRecommendations(window)
    expect(recs.length).toBeGreaterThanOrEqual(2)
    expect(recs[0]!.key).toBe('cache_miss')
    expect(recs[0]!.detail).toBe('run /compact')
    expect(recs[1]!.key).toBe('agent')
    const fix = buildUsageFix(recs)
    expect(fix).toBeDefined()
    expect(fix!.keys).toEqual(['agent'])
    expect(fix!.messages[0]).toContain('Fix what /usage flagged.')
    expect(formatFixDescription(1, 2)).toBe('fix 1 of 2')
    expect(formatFixDescription(2, 2)).toBe('fix both')
  })

  test('#1053 CustomSelect/select.tsx supports disablePrintableKeybindings and declineValue', () => {
    const src = readFileSync(
      join(ROOT, 'components/CustomSelect/select.tsx'),
      'utf8',
    )
    expect(src).toContain('disablePrintableKeybindings')
    expect(src).toContain('declineValue')
  })

  test('#1087 RecentDenialsTab & PermissionRuleList show command and name exact command on approval', () => {
    const tabSrc = readFileSync(
      join(ROOT, 'components/permissions/rules/RecentDenialsTab.tsx'),
      'utf8',
    )
    const listSrc = readFileSync(
      join(ROOT, 'components/permissions/rules/PermissionRuleList.tsx'),
      'utf8',
    )
    expect(tabSrc).toContain('d.command ?? d.display')
    expect(listSrc).toContain('markAutoModeDenialApproved')
    expect(listSrc).toContain('as one whole string')
  })

  test('#1088 menuDescription & listingDescription in command.ts, commandSuggestions.ts, and help.tsx', () => {
    const typeSrc = readFileSync(join(ROOT, 'types/command.ts'), 'utf8')
    const sugSrc = readFileSync(
      join(ROOT, 'utils/suggestions/commandSuggestions.ts'),
      'utf8',
    )
    const helpSrc = readFileSync(join(ROOT, 'commands/help/help.tsx'), 'utf8')
    expect(typeSrc).toContain('listingDescription?: string')
    expect(sugSrc).toContain(
      "cmd.loadedFrom === 'bundled' && cmd.menuDescription",
    )
    expect(helpSrc).toContain('cmd.menuDescription')
  })

  test('#1130 SubmitController passes isDispatchingForModel to trySendQueuedNowKey', () => {
    const src = readFileSync(
      join(ROOT, 'screens/repl/SubmitController.ts'),
      'utf8',
    )
    expect(src).toContain('isDispatchingForModel: () =>')
    expect(src).toContain('this.#queryGuard.isDispatchingForModel')
    expect(src).not.toContain(
      'this.#queryGuard.isActive && !this.#queryGuard.isRunning',
    )
  })

  test('#1140 MessageSelector renders hasUncheckedFiles warnings', () => {
    const src = readFileSync(
      join(ROOT, 'components/MessageSelector.tsx'),
      'utf8',
    )
    expect(src).toContain(', other files not checked')
    expect(src).toContain('Code changes unknown')
  })

  test('#1141 Grove.tsx uses "Help improve our AI models" and lockedByClaudeScience', () => {
    const src = readFileSync(join(ROOT, 'components/grove/Grove.tsx'), 'utf8')
    expect(src).toContain('Help improve our AI models')
    expect(src).toContain('lockedByClaudeScience')
    expect(src).toContain('Not available for this account.')
  })

  test('#1169 BashPermissionRequest does not delegate sed -i to SedEditPermissionRequest', () => {
    const src = readFileSync(
      join(
        ROOT,
        'components/permissions/BashPermissionRequest/BashPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(src).not.toContain('SedEditPermissionRequest')
    expect(src).not.toContain('parseSedEditCommand')
  })
})
