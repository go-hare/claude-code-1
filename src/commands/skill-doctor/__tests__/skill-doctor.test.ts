import { describe, expect, mock, test } from 'bun:test'
import {
  formatDays,
  formatSkillTable,
  skillDoctorCall,
  type SkillRow,
} from '../skill-doctor.js'

mock.module('../../../utils/plugins/pluginUsage.js', () => ({
  listDisusedPluginsWDt: async () => [
    { pluginId: 'old@mkt', name: 'old-plugin', daysSinceLastUse: 30 },
  ],
}))

mock.module('../../../utils/suggestions/skillUsageTracking.js', () => ({
  getSkillUsageSnapshot: (name: string, alternate?: string) => {
    if (name === 'used-skill' || alternate === 'used-skill') {
      return { usageCount: 3, daysSinceUse: 2 }
    }
    return null
  },
}))

describe('skill-doctor densable formatting', () => {
  test('formatDays densable c1y', () => {
    expect(formatDays(null)).toContain('never')
    expect(formatDays(0)).toBe('today')
    expect(formatDays(1)).toContain('1')
    expect(formatDays(3)).toContain('3')
  })

  test('formatSkillTable empty and yellow never-used', () => {
    expect(formatSkillTable([])).toContain('no skills')
    const rows: SkillRow[] = [
      {
        name: 'foo',
        source: 'project',
        usageCount: 0,
        daysSinceUse: null,
      },
      {
        name: 'bar',
        source: 'user',
        usageCount: 2,
        daysSinceUse: 1,
      },
    ]
    const out = formatSkillTable(rows)
    expect(out).toContain('foo')
    expect(out).toContain('bar')
    expect(out).toContain('2')
  })
})

describe('skillDoctorCall densable d1y', () => {
  test('lists user skills, skips bundled/plugin, appends WDt plugins', async () => {
    const context = {
      options: {
        commands: [
          {
            type: 'prompt' as const,
            name: 'used-skill',
            source: 'userSettings' as const,
            progressMessage: '',
            contentLength: 1,
            getPromptForCommand: async () => [],
          },
          {
            type: 'prompt' as const,
            name: 'never-skill',
            source: 'projectSettings' as const,
            progressMessage: '',
            contentLength: 1,
            getPromptForCommand: async () => [],
          },
          {
            type: 'prompt' as const,
            name: 'bundled-skill',
            source: 'bundled' as const,
            progressMessage: '',
            contentLength: 1,
            getPromptForCommand: async () => [],
          },
          {
            type: 'prompt' as const,
            name: 'plugin-skill',
            source: 'plugin' as const,
            progressMessage: '',
            contentLength: 1,
            getPromptForCommand: async () => [],
          },
          {
            type: 'local' as const,
            name: 'version',
            description: 'x',
            supportsNonInteractive: true,
            load: async () => ({
              call: async () => ({ type: 'text' as const, value: '' }),
            }),
          },
        ],
      },
    }

    const result = await skillDoctorCall(
      '',
      // LocalCommandCall context is ToolUseContext-shaped at runtime; unit test
      // only needs options.commands for this path.
      context as never,
    )
    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Skills loaded this session')
    expect(result.value).toContain('used-skill')
    expect(result.value).toContain('never-skill')
    expect(result.value).not.toContain('bundled-skill')
    expect(result.value).not.toContain('plugin-skill')
    expect(result.value).toContain('1 skill loaded but never invoked')
    expect(result.value).toContain('Plugins not used recently')
    expect(result.value).toContain('old-plugin')
    expect(result.value).toContain('Manage these in /plugin')
  })
})
