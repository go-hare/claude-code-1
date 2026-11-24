import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { readFileSync } from 'fs'
import { join } from 'path'
import { listExitBackgroundItems } from '../../utils/exitBackgroundItems.js'
import { deleteDesignConsent } from '../../services/designConsent.js'
import {
  deleteOnboardingGuideByCode,
  runShareOnboardingGuide,
} from '../team-onboarding/shareOnboardingGuide.js'
import teamOnboardingCmd from '../team-onboarding/index.js'
import bridgeCmd from '../bridge/index.js'

const ROOT = join(import.meta.dir, '../../..')

describe('Wave 316-318 Commands / Hooks / Skills / Tasks alignment', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_REPORT_FINDINGS
  })

  test('#1498 model.tsx warns with 200K context window notice for unrecognized models', () => {
    const src = readFileSync(join(ROOT, 'src/commands/model/model.tsx'), 'utf8')
    expect(src).toContain('buildUnrecognizedModelNotice')
    expect(src).toContain('formatModelCommandUnrecognizedWarning')
    expect(src).toContain('assumes a context window of')
  })

  test('#1540 cdCommand.tsx resets settings cache and notifies projectSettings on directory change', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/cd/cdCommand.tsx'),
      'utf8',
    )
    expect(src).toContain('updateHooksConfigSnapshot()')
    expect(src).toContain(
      "settingsChangeDetector.notifyChange('projectSettings'",
    )
  })

  test('#1507 codeReview.ts checks messageClientPlatform + remote/bridge + tengu_purring_micali', async () => {
    const { codeReviewUsesReportFindings } = await import('../codeReview.js')
    const baseCtx = {
      agentId: undefined,
      options: {
        isSkillPreload: false,
        tools: [{ name: 'ReportFindings' }],
        messageClientPlatform: 'desktop_app',
      },
    } as never
    const prevEnvKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    try {
      process.env.CLAUDE_CODE_ENVIRONMENT_KIND = 'bridge'
      expect(codeReviewUsesReportFindings(baseCtx)).toBe(true)

      const subagentCtx = {
        ...(baseCtx as object),
        agentId: 'sub-1',
      } as never
      expect(codeReviewUsesReportFindings(subagentCtx)).toBe(false)
    } finally {
      if (prevEnvKind === undefined) {
        delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
      } else {
        process.env.CLAUDE_CODE_ENVIRONMENT_KIND = prevEnvKind
      }
    }
  })

  test('#1509 reviewRemote.ts points to https://github.com/new instead of gh repo create', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/review/reviewRemote.ts'),
      'utf8',
    )
    expect(src).toContain('https://github.com/new')
    expect(src).not.toContain('gh repo create --source=. --push')
  })

  test('#1558 & #1559 team-onboarding command and ShareOnboardingGuide handle delete without short_code and server refusal', async () => {
    expect(teamOnboardingCmd.name).toBe('team-onboarding')

    const getSpy = spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: {
        guides: [
          {
            short_code: 'abc123',
            share_url: 'https://claude.ai/onboarding/abc123',
            updated_at: '2026-10-01',
          },
        ],
      },
    } as never)

    try {
      const noCodeRes = await runShareOnboardingGuide({ mode: 'delete' })
      expect(noCodeRes.status).toBe('unavailable')
      expect(noCodeRes.message).toContain('Nothing was deleted')
      expect(noCodeRes.message).toContain('abc123')
    } finally {
      getSpy.mockRestore()
    }

    const delSpy = spyOn(axios, 'delete').mockResolvedValueOnce({
      status: 403,
      data: {},
    } as never)
    try {
      await expect(
        deleteOnboardingGuideByCode('abc123', {}, 'https://api.anthropic.com'),
      ).rejects.toThrow('Onboarding guide unavailable: status 403')
    } finally {
      delSpy.mockRestore()
    }
  })

  test('#1576 bridge/index.ts stays enabled when disableRemoteControl is set while remaining hidden', () => {
    const src = readFileSync(join(ROOT, 'src/commands/bridge/index.ts'), 'utf8')
    expect(src).toContain('isRemoteControlDisabledByManagedSettings')
    expect(src).toContain('return !isBridgeEnabled()')
    expect(bridgeCmd.name).toBe('remote-control')
  })

  test('#1638 bridge/bridge.tsx checks replBridgeError and hides URL when disconnected/errored', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/bridge/bridge.tsx'),
      'utf8',
    )
    expect(src).toContain('replBridgeError')
    expect(src).toContain('const isConnected = connected && !reconnecting')
    expect(src).toContain("Remote Control isn't connected.")
    expect(src).toContain('QR code unavailable')
  })

  test('#1501 /clear and /resume flush session storage before switching/clearing', () => {
    const clearSrc = readFileSync(
      join(ROOT, 'src/commands/clear/conversation.ts'),
      'utf8',
    )
    const resumeSrc = readFileSync(
      join(ROOT, 'src/commands/resume/resume.tsx'),
      'utf8',
    )
    expect(clearSrc).toContain('await flushSessionStorage()')
    expect(resumeSrc).toContain('await flushSessionStorage()')
  })

  test('#1508 useDiffData.ts throttles subsequent refreshes with 150ms delay', () => {
    const src = readFileSync(join(ROOT, 'src/hooks/useDiffData.ts'), 'utf8')
    expect(src).toContain('DIFF_REFRESH_DELAY_MS = 150')
    expect(src).toContain('hasFetchedRef')
  })

  test('#1631 useRateLimitWarningNotification.tsx guards overage reset while background subagents run', () => {
    const src = readFileSync(
      join(ROOT, 'src/hooks/notifs/useRateLimitWarningNotification.tsx'),
      'utf8',
    )
    expect(src).toContain('hasRunningSubagent')
    expect(src).toContain('!hasRunningSubagent')
  })

  test('#1541 ResumeConversation.tsx auto-calls loadMoreLogs when PR-filtered logs are empty', () => {
    const src = readFileSync(
      join(ROOT, 'src/screens/ResumeConversation.tsx'),
      'utf8',
    )
    expect(src).toContain(
      'if (selectedRef.current || filterByPr === undefined || loading || filteredLogs.length > 0) return',
    )
    expect(src).toContain('loadMoreLogs(50)')
  })

  test('#1670 ide.ts only auto-installs VSCode extension when ideToInstallExtension is explicitly passed', () => {
    const src = readFileSync(join(ROOT, 'src/utils/ide.ts'), 'utf8')
    expect(src).toContain('if (ideToInstallExtension && isVSCodeIde(ideType))')
  })

  test('#1585 design-sync/SKILL.md includes preflight moveState check and early stop instruction', () => {
    const md = readFileSync(
      join(ROOT, 'src/skills/bundled/design-sync/SKILL.md'),
      'utf8',
    )
    expect(md).toContain('has this design system moved to Claude?')
    expect(md).toContain(
      'This sync stopped before building or uploading anything.',
    )
  })

  test('#1594 plugin-authoring/SKILL.md includes one-line mod sharing offer guidance', () => {
    const md = readFileSync(
      join(ROOT, 'src/skills/bundled/plugin-authoring/SKILL.md'),
      'utf8',
    )
    expect(md).toContain('SHARING IT.')
    expect(md).toContain('offer once, in one line, to share the mod')
  })

  test('#1677 managed-agents-onboarding*.md documents default auto permission policy', () => {
    const onboarding = readFileSync(
      join(
        ROOT,
        'src/skills/bundled/claude-api/shared/managed-agents-onboarding.md',
      ),
      'utf8',
    )
    const quickstart = readFileSync(
      join(
        ROOT,
        'src/skills/bundled/claude-api/shared/managed-agents-onboarding-from-quickstart.md',
      ),
      'utf8',
    )
    expect(onboarding).toContain('permission_policy: {type: auto}')
    expect(quickstart).toContain('permission_policy: {type: auto}')
  })

  test('#1667 youShouldKnow mod uses "try again" instead of "press 2"', () => {
    const src = readFileSync(
      join(
        ROOT,
        'vendor/claude-code-mods/mods/cc-plugin-you-should-know/hooks/register.ts',
      ),
      'utf8',
    )
    expect(src).toContain('then try again.')
    expect(src).not.toContain('press 2')
    expect(src).not.toContain('Press 2')
  })

  test('#1639 deleteDesignConsent no longer swallows 404 responses', async () => {
    const src = readFileSync(
      join(ROOT, 'src/services/designConsent.ts'),
      'utf8',
    )
    expect(src).toContain('validateStatus: s => s < 300')
    expect(src).toContain('err.response?.status === 404')
    expect(src).toContain('throw err')
  })

  test('#1593 exitBackgroundItems skips local_bash tasks with stopsOnExit=true', () => {
    const items = listExitBackgroundItems({
      mon1: {
        id: 'mon1',
        type: 'local_bash',
        status: 'running',
        isBackgrounded: true,
        stopsOnExit: true,
        description: 'plugin monitor',
      } as never,
      sh1: {
        id: 'sh1',
        type: 'local_bash',
        status: 'running',
        isBackgrounded: true,
        description: 'dev server',
      } as never,
    })
    expect(items.some(i => i.detail === 'plugin monitor')).toBe(false)
    expect(items.some(i => i.detail === 'dev server')).toBe(true)
  })

  test('#1591 LocalAgentTask.tsx backgrounds foreground shells of running background agent on queuePendingMessage', () => {
    const src = readFileSync(
      join(ROOT, 'src/tasks/LocalAgentTask/LocalAgentTask.tsx'),
      'utf8',
    )
    expect(src).toContain('isRunningBackgrounded')
    expect(src).toContain('backgroundTask(shellId, registry)')
  })
})
