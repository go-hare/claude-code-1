import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 has no Sleep tool outside proactive', () => {
  test('SleepTool.isEnabled gates on proactive automation', () => {
    const src = readFileSync(join(import.meta.dir, '../SleepTool.ts'), 'utf8')
    expect(src).toMatch(
      /isEnabled\(\) \{\s*return isProactiveAutomationEnabled\(\)\s*\}/,
    )
  })
})
