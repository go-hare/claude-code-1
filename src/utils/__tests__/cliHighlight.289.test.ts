/**
 * densable 2.1.289 `Se` — cli-highlight shares ColorFile's hljs bound.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(import.meta.dir, '../cliHighlight.ts'), 'utf8')

describe('densable 2.1.289 cli-highlight Se bind', () => {
  test('binds the default highlight budget on the shared hljs', () => {
    expect(SRC).toContain('bindDefaultHighlightBudget(resolveHljsApi(hljs))')
    expect(SRC).toContain('HighlightBoundError')
  })
})
