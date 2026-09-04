import { describe, expect, test } from 'bun:test'

import {
  formatEffortThinkingOffCliError,
  formatEffortThinkingOffError,
  isTopEffortWithThinkingOff,
} from '../effortThinkingGuard.js'

describe('effortThinkingGuard 243', () => {
  test('only xhigh/max + thinking-off trip the guard', () => {
    expect(isTopEffortWithThinkingOff('xhigh', true)).toBe(true)
    expect(isTopEffortWithThinkingOff('max', true)).toBe(true)
    expect(isTopEffortWithThinkingOff('high', true)).toBe(false)
    expect(isTopEffortWithThinkingOff('xhigh', false)).toBe(false)
  })

  test('interactive copy names the level and /effort high', () => {
    const msg = formatEffortThinkingOffError('xhigh')
    expect(msg).toContain(
      "Effort 'xhigh' isn't available with thinking turned off",
    )
    expect(msg).toContain('run /effort high to continue')
    expect(msg).toContain('or turn thinking back on (')
  })

  test('CLI copy points at --effort high', () => {
    const msg = formatEffortThinkingOffCliError('max')
    expect(msg).toContain(
      "Effort 'max' isn't available with thinking turned off",
    )
    expect(msg).toContain('use --effort high (or the effortLevel setting)')
  })
})
