/**
 * densable eya — isPolicyEnforced is restrictions[policy].allowed === true.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')

describe('densable eya isPolicyEnforced', () => {
  test('fail-closed allowed===true (not isPolicyAllowed fail-open)', () => {
    expect(src).toContain('export function isPolicyEnforced')
    expect(src).toContain('restrictions?.[policy]?.allowed === true')
  })
})
