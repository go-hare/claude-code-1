import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #27 plansDirectory non-Windows backslash check', () => {
  const plansSrc = readFileSync(join(import.meta.dir, '../plans.ts'), 'utf8')

  test('checks getPlatform() !== "windows" && resolved.includes("\\\\")', () => {
    expect(plansSrc).toContain("getPlatform() !== 'windows'")
    expect(plansSrc).toContain("resolved.includes('\\\\')")
  })

  test('uses exact gold error message when plansDirectory is invalid or contains backslash off Windows', () => {
    expect(plansSrc).toContain(
      'plansDirectory must be within project root, with no backslash in its path off Windows:',
    )
  })
})
