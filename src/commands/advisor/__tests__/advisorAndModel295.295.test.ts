import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('v2.1.295 #394, #419, #376, #351, #496 source locks', () => {
  test('advisor.tsx checks isAdvisorModelAvailable in options and defaultValue', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../advisor/advisor.tsx'),
      'utf8',
    )
    expect(src).toContain('export function isAdvisorModelAvailable(')
    expect(src).toContain(
      "if (!advisorModel || !isAdvisorModelAvailable(advisorModel)) return 'off';",
    )
  })

  test('model.tsx marks effort === max as session only even when persistAsDefault is true', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../model/model.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "const effortSaved = persistAsDefault && effort !== 'max';",
    )
    expect(src).toContain('effort for this session only')
  })
})
