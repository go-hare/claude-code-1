import { describe, expect, test } from 'bun:test'
import { bareModeDisableHint, safeModeDisableHint } from '../safeMode.js'

describe('safeModeDisableHint & bareModeDisableHint (#649)', () => {
  test('returns env unset hints when flags are absent or after --', () => {
    expect(safeModeDisableHint(['node', 'claude'], {})).toBe(
      'unset CLAUDE_CODE_SAFE_MODE',
    )
    expect(bareModeDisableHint(['node', 'claude'], {})).toBe(
      'unset CLAUDE_CODE_SIMPLE',
    )
    expect(
      safeModeDisableHint(['node', 'claude', '--', '--safe-mode'], {}),
    ).toBe('unset CLAUDE_CODE_SAFE_MODE')
    expect(bareModeDisableHint(['node', 'claude', '--', '--bare'], {})).toBe(
      'unset CLAUDE_CODE_SIMPLE',
    )
  })

  test('returns restart without <flag> for interactive sessions', () => {
    expect(safeModeDisableHint(['node', 'claude', '--safe-mode'], {})).toBe(
      'restart without --safe-mode',
    )
    expect(bareModeDisableHint(['node', 'claude', '--bare'], {})).toBe(
      'restart without --bare',
    )
  })

  test('returns /stop + claude --resume for background sessions', () => {
    const bgEnv = { CLAUDE_CODE_SESSION_KIND: 'bg' }
    expect(safeModeDisableHint(['node', 'claude', '--safe-mode'], bgEnv)).toBe(
      'run /stop, then claude --resume from your shell',
    )
    expect(bareModeDisableHint(['node', 'claude', '--bare'], bgEnv)).toBe(
      'run /stop, then claude --resume from your shell',
    )
  })
})
