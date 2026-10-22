/**
 * densable 2.1.289 — shouldQuery:false early result does not count
 * existing messages as num_turns (held task notifications stay held).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ENGINE = join(import.meta.dir, '../../QueryEngine.ts')

describe('densable 2.1.289 shouldQuery:false num_turns', () => {
  test('early return yields num_turns 0 not messages.length - 1', () => {
    const src = readFileSync(ENGINE, 'utf8')
    const start = src.indexOf('if (!shouldQuery)')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 3500)
    expect(body).toContain('num_turns: 0')
    expect(body).not.toContain('num_turns: messages.length - 1')
  })
})
