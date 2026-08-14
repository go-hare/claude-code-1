/**
 * densable 2.1.232 #37 — /code-review high/xhigh/max also background (fork).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseCodeReviewArgs } from '../codeReview.js'

const codeReviewPath = join(import.meta.dir, '../codeReview.ts')
const forkedPath = join(import.meta.dir, '../../utils/forkedSkillBackground.ts')
const codeReviewSrc = readFileSync(codeReviewPath, 'utf8')
const forkedSrc = readFileSync(forkedPath, 'utf8')

describe('densable 2.1.232 #37 code-review bg for high/xhigh/max', () => {
  test('command is fork + background true with no level branch', () => {
    expect(codeReviewSrc).toContain("context: 'fork'")
    expect(codeReviewSrc).toContain('background: true')
    // Must not gate background/context on effort level
    expect(codeReviewSrc).not.toMatch(
      /background:\s*(level|effort|high|xhigh|max)/,
    )
    expect(codeReviewSrc).not.toMatch(
      /context:\s*(level\s*===\s*['"]low['"]|level\s*!==)/,
    )
  })

  test('Cvo/Zyi default background true for fork skills', () => {
    expect(forkedSrc).toContain('shouldBackgroundForkedSkill')
    expect(forkedSrc).toContain('command.background !== false')
  })

  test('high/xhigh/max parse as effort levels (not special bg flags)', () => {
    for (const level of ['high', 'xhigh', 'max'] as const) {
      const r = parseCodeReviewArgs(level)
      expect(r.level).toBe(level)
      expect(r.explicit).toBe(level)
    }
  })
})
