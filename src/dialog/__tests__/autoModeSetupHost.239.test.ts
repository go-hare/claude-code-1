/**
 * densable ymn / hmn Host — auto_mode_setup_review / flagged_allow.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { filterDefaultsSentinel } from '../dialogs/AutoModeSetupDialogs.js'
import { AUTO_MODE_DEFAULTS_SENTINEL } from '../../services/autoModeSetup/write.js'

describe('autoModeSetup Host helpers (ymn/hmn)', () => {
  test('gmn filters $defaults sentinel', () => {
    expect(
      filterDefaultsSentinel([
        AUTO_MODE_DEFAULTS_SENTINEL,
        'Bash(gh:*)',
        AUTO_MODE_DEFAULTS_SENTINEL,
      ]),
    ).toEqual(['Bash(gh:*)'])
  })

  test('hmn picking is SelectMulti; first screen is gold all/pick/leave', () => {
    const src = readFileSync(
      join(import.meta.dir, '../dialogs/AutoModeSetupDialogs.tsx'),
      'utf8',
    )
    expect(src).toContain('SelectMulti')
    expect(src).toContain('Review rules that skip checks')
    expect(src).toContain('Remove them all')
    expect(src).toContain('Pick which to remove')
    expect(src).toContain('Leave them')
    expect(src).toContain('Remove selected')
    expect(src).not.toContain('toggle-first')
  })

  test('ymn review copy matches gold M9e / options (not the stub)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../dialogs/AutoModeSetupDialogs.tsx'),
      'utf8',
    )
    expect(src).toContain('Review proposed auto-mode setup')
    expect(src).toContain('Looks good — save it')
    expect(src).toContain('Discard and exit')
    expect(src).toContain('Allow carve-outs')
    expect(src).toContain(
      'none suggested — defaults look like they cover your usage',
    )
    expect(src).toContain('Extra soft blocks')
    expect(src).toContain('Extra hard blocks')
    expect(src).toContain('none suggested')
    expect(src).not.toContain('Auto-mode setup proposal is ready for review')
    expect(src).not.toContain('Accept proposal')
  })
})
