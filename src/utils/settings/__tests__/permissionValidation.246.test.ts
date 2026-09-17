import { describe, expect, test } from 'bun:test'
import { validatePermissionRule } from '../permissionValidation.js'
import { filterInvalidPermissionRules } from '../validation.js'

describe('validatePermissionRule densable 2.1.246 (#1)', () => {
  test('allow Bash(git * main) stays valid and warns', () => {
    const r = validatePermissionRule('Bash(git * main)', 'allow')
    expect(r.valid).toBe(true)
    expect(r.warning).toContain('has a wildcard before the rest of the command')
    expect(r.warning).toContain('For git, options such as -c and --exec-path')
    expect(r.warning).toContain('Bash(git status *)')
  })

  test('allow Bash(npm * install) warns without git extras', () => {
    const r = validatePermissionRule('Bash(npm * install)', 'allow')
    expect(r.valid).toBe(true)
    expect(r.warning).toContain('has a wildcard before the rest of the command')
    expect(r.warning).not.toContain('For git,')
    expect(r.warning).not.toContain('Bash(git status *)')
  })

  test('deny / ask / wildcard-after-subcommand do not warn', () => {
    expect(validatePermissionRule('Bash(git * main)', 'deny').warning).toBe(
      undefined,
    )
    expect(validatePermissionRule('Bash(git * main)', 'ask').warning).toBe(
      undefined,
    )
    expect(validatePermissionRule('Bash(git status *)', 'allow').warning).toBe(
      undefined,
    )
    expect(validatePermissionRule('Bash(git *)', 'allow').warning).toBe(
      undefined,
    )
    expect(validatePermissionRule('Bash(npm run:*)', 'allow').warning).toBe(
      undefined,
    )
  })

  test('filter keeps the rule and does not emit a dialog-blocking error', () => {
    const data = {
      permissions: { allow: ['Bash(git * main)', 'Bash(npm install)'] },
    }
    const warnings = filterInvalidPermissionRules(data, 'test.json')
    expect((data.permissions as { allow: string[] }).allow).toEqual([
      'Bash(git * main)',
      'Bash(npm install)',
    ])
    // Official filter only return!0 on valid. valid:true + warning must
    // not land on the settings-errors channel (InvalidSettingsDialog).
    const dialogBlocking = warnings.filter(e => !e.mcpErrorMetadata)
    expect(dialogBlocking).toHaveLength(0)
  })
})
