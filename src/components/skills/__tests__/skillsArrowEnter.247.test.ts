/**
 * densable 2.1.247 #6 — local /skills picker is FuzzyPicker ($t).
 * Official 247 Enter is r[ke().focus]; SkillsMenu must keep using FuzzyPicker.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../SkillsMenu.tsx')

describe('densable 2.1.247 #6 /skills via FuzzyPicker', () => {
  test('SkillsMenu still delegates Enter to FuzzyPicker', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('<FuzzyPicker')
    expect(src).toContain('onSelect={skill =>')
  })
})
