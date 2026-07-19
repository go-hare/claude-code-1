/**
 * densable compact streaming residual: enablePromptCaching:!1 on querySource compact.
 * Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('compact streaming densable enablePromptCaching residual', () => {
  test('streaming compact path sets enablePromptCaching false', () => {
    const src = readFileSync(join(import.meta.dir, '../compact.ts'), 'utf8')
    // densable: querySource:"compact" + enablePromptCaching:!1 on streaming fallback
    expect(src).toContain("querySource: 'compact'")
    expect(src).toContain('enablePromptCaching: false')
    // densable effortValue:P_(n) already wired
    expect(src).toContain('resolveEffortValue(context)')
  })

  test('enablePromptCaching false sits on streaming call options', () => {
    const src = readFileSync(join(import.meta.dir, '../compact.ts'), 'utf8')
    // skip import; find call expression
    const callIdx = src.indexOf('const streamingGen = queryModelWithStreaming')
    expect(callIdx).toBeGreaterThan(-1)
    const slice = src.slice(callIdx, callIdx + 1800)
    expect(slice).toContain('enablePromptCaching: false')
    expect(slice).toContain("querySource: 'compact'")
    expect(slice).toContain('resolveEffortValue(context)')
  })
})
