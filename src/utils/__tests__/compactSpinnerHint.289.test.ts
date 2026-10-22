/**
 * densable tBo — compact spinner hint only for experiment/clientdata windows.
 */
import { describe, expect, test } from 'bun:test'
import {
  compactSpinnerHintText,
  resolveAutoCompactWindow,
} from '../autoCompactWindow.js'

describe('compactSpinnerHintText', () => {
  test('model-default and auto windows do not replace Next', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const resolved = resolveAutoCompactWindow('claude-sonnet-5[1m]', undefined)
    expect(
      resolved.source === 'experiment' || resolved.source === 'clientdata',
    ).toBe(false)
    expect(compactSpinnerHintText('claude-sonnet-5[1m]')).toBeNull()
  })
})
