import { describe, expect, test } from 'bun:test'
import {
  formatBashEditDiffForToolResult,
  isGitStateSwitchCommand,
  resolveBashEditDiffEnabled,
} from '../bashEditDiff.js'

describe('resolveBashEditDiffEnabled densable y5t', () => {
  test('env true wins', () => {
    expect(
      resolveBashEditDiffEnabled('default', '1', false, false, false),
    ).toBe(true)
  })

  test('env false wins', () => {
    expect(resolveBashEditDiffEnabled('auto', '0', true, true, true)).toBe(
      false,
    )
  })

  test('trusted false or merged false disables', () => {
    expect(
      resolveBashEditDiffEnabled('auto', undefined, false, undefined, true),
    ).toBe(false)
    expect(
      resolveBashEditDiffEnabled(
        'bypassPermissions',
        undefined,
        undefined,
        false,
        true,
      ),
    ).toBe(false)
  })

  test('trusted true enables outside auto', () => {
    expect(
      resolveBashEditDiffEnabled('default', undefined, true, undefined, false),
    ).toBe(true)
  })

  test('default is auto/bypass AND thrifty_sonic', () => {
    expect(
      resolveBashEditDiffEnabled(
        'auto',
        undefined,
        undefined,
        undefined,
        false,
      ),
    ).toBe(false)
    expect(
      resolveBashEditDiffEnabled('auto', undefined, undefined, undefined, true),
    ).toBe(true)
    expect(
      resolveBashEditDiffEnabled(
        'bypassPermissions',
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).toBe(true)
    expect(
      resolveBashEditDiffEnabled(
        'default',
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).toBe(false)
  })
})

describe('isGitStateSwitchCommand densable _5t', () => {
  test('matches checkout/switch/stash family', () => {
    expect(isGitStateSwitchCommand('git checkout main')).toBe(true)
    expect(isGitStateSwitchCommand('sudo git stash')).toBe(true)
    expect(isGitStateSwitchCommand('echo hi')).toBe(false)
    expect(isGitStateSwitchCommand('git status')).toBe(false)
  })
})

describe('formatBashEditDiffForToolResult', () => {
  test('emits hunks for the model', () => {
    const text = formatBashEditDiffForToolResult({
      files: [
        {
          filePath: '/tmp/a.ts',
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
      ],
      moreFiles: 2,
    })
    expect(text).toContain('<bash_edit_diff>')
    expect(text).toContain('File: /tmp/a.ts')
    expect(text).toContain('+new')
    expect(text).toContain('2 more file')
  })

  test('skips empty/skipped', () => {
    expect(
      formatBashEditDiffForToolResult({
        files: [],
        moreFiles: 0,
        skipped: true,
      }),
    ).toBe('')
  })
})
