/**
 * densable showAlwaysAllow wiring for powershellToolUseOptions.
 */
import { describe, expect, mock, test } from 'bun:test'

mock.module('src/utils/settings/settings.js', () => ({
  getSettingsForSource: () => null,
  getSettings_DEPRECATED: () => ({}),
  getSettingsFilePathForSource: () => '',
  updateSettingsForSource: () => {},
  getSettings: () => ({}),
}))

import { powershellToolUseOptions } from '../powershellToolUseOptions.js'

function makeTool(suppress = false) {
  return {
    name: 'PowerShell',
    suppressesAlwaysAllowRule: suppress ? () => true : undefined,
  } as any
}

describe('powershellToolUseOptions densable showAlwaysAllow', () => {
  test('hides always-allow when suppressAlwaysAllowRule on ask result', () => {
    const opts = powershellToolUseOptions({
      tool: makeTool(false),
      input: { command: 'Get-Process' },
      permissionResult: {
        behavior: 'ask',
        message: 'ask',
        suppressAlwaysAllowRule: true,
      },
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'PowerShell', ruleContent: 'Get-Process:*' }],
        },
      ],
      onRejectFeedbackChange: () => {},
      onAcceptFeedbackChange: () => {},
    })
    expect(opts.some(o => String(o.value).startsWith('yes-'))).toBe(false)
  })

  test('shows always-allow when not suppressed', () => {
    const opts = powershellToolUseOptions({
      tool: makeTool(false),
      input: { command: 'Get-Process' },
      permissionResult: { behavior: 'ask', message: 'ask' },
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'PowerShell', ruleContent: 'Get-Process:*' }],
        },
      ],
      onRejectFeedbackChange: () => {},
      onAcceptFeedbackChange: () => {},
    })
    expect(opts.some(o => o.value === 'yes-apply-suggestions')).toBe(true)
  })

  test('source anchors densable computeShowAlwaysAllowOptions', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../powershellToolUseOptions.tsx'),
      'utf8',
    )
    expect(src).toContain('computeShowAlwaysAllowOptions')
  })
})
