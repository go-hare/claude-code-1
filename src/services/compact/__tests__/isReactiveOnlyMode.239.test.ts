/**
 * tengu_cobalt_raccoon must drive /compact via isReactiveOnlyMode.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('isReactiveOnlyMode raccoon wire', () => {
  test('reactiveCompact reads the same GB as autoCompact/TokenWarning', () => {
    const src = readFileSync(
      join(import.meta.dir, '../reactiveCompact.ts'),
      'utf8',
    )
    expect(src).toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)",
    )
    expect(src).not.toMatch(/isReactiveOnlyMode:\s*\(\)\s*=>\s*false/)
  })

  test('/compact routes through isReactiveOnlyMode', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../commands/compact/compact.ts'),
      'utf8',
    )
    expect(src).toContain('isReactiveOnlyMode()')
    expect(src).toContain('compactViaReactive')
  })
})
