/**
 * densable showAlwaysAllow wiring for bashToolUseOptions.
 */
import { describe, expect, mock, test } from 'bun:test'

mock.module('src/utils/settings/settings.js', () => ({
  getSettingsForSource: () => null,
  getSettings_DEPRECATED: () => ({}),
  getSettingsFilePathForSource: () => '',
  updateSettingsForSource: () => {},
  getSettings: () => ({}),
}))

import { bashToolUseOptions } from '../bashToolUseOptions.js'

function makeTool(suppress = false) {
  return {
    name: 'Bash',
    suppressesAlwaysAllowRule: suppress ? () => true : undefined,
  } as any
}

describe('bashToolUseOptions densable showAlwaysAllow', () => {
  test('hides always-allow when tool.suppressesAlwaysAllowRule', () => {
    const opts = bashToolUseOptions({
      tool: makeTool(true),
      input: { command: 'ls' },
      permissionResult: { behavior: 'ask', message: 'ask' },
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
        },
      ],
      onRejectFeedbackChange: () => {},
      onAcceptFeedbackChange: () => {},
    })
    expect(opts.some(o => String(o.value).startsWith('yes-'))).toBe(false)
  })

  test('shows always-allow when not suppressed and suggestions present', () => {
    const opts = bashToolUseOptions({
      tool: makeTool(false),
      input: { command: 'ls' },
      permissionResult: { behavior: 'ask', message: 'ask' },
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
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
      join(import.meta.dir, '../bashToolUseOptions.tsx'),
      'utf8',
    )
    expect(src).toContain('computeShowAlwaysAllowOptions')
    const parent = readFileSync(
      join(import.meta.dir, '../BashPermissionRequest.tsx'),
      'utf8',
    )
    expect(parent).toContain('tool: toolUseConfirm.tool')
  })
})
