import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shouldOfferBlockOutsideReads } from '../outsideReads.js'

const MAIN = join(import.meta.dir, '../../../main.tsx')

describe('--permission-prompts (2.1.283)', () => {
  test('main.tsx registers gold host|none help', () => {
    const src = readFileSync(MAIN, 'utf8')
    expect(src).toContain('--permission-prompts <target>')
    expect(src).toContain(
      'Who answers permission prompts with --print: "host" (the SDK host or --permission-prompt-tool) or "none" (nobody: anything that would prompt is denied automatically; the permission mode still decides everything else)',
    )
    expect(src).toContain(".choices(['host', 'none'] as const)")
    expect(src).toContain("options.permissionPrompts === 'none'")
    expect(src).toContain('shouldAvoidPermissionPrompts: permissionPromptsNone')
    expect(src).toContain('permission prompts are answered with a local deny')
  })

  test('none latches shouldAvoidPermissionPrompts so first outside-read dialog is skipped', () => {
    expect(
      shouldOfferBlockOutsideReads({
        toolName: 'Read',
        hasPath: true,
        behavior: 'ask',
        decisionReasonType: 'workingDir',
        context: {
          mode: 'auto',
          shouldAvoidPermissionPrompts: true,
          blockReadsOutsideWorkingDirectories: false,
        },
      }),
    ).toBe(false)
  })
})
