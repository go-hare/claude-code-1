import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 classifierOnly empty-action deny', () => {
  test('H3t stamps classifierRan:false on empty toAutoClassifierInput', () => {
    const src = readFileSync(join(__dirname, '../yoloClassifier.ts'), 'utf-8')
    expect(src).toContain(
      "reason: 'Tool declares no classifier-relevant input'",
    )
    expect(src).toContain('classifierRan: false')
  })

  test('Xe && classifierRan===false denies before Fr flag-allow', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    expect(src).toContain(
      'gave the auto mode classifier nothing to judge (its toAutoClassifierInput is empty)',
    )
    expect(src).toContain(
      'declares classifierOnly() but serialized to an empty classifier action; denying',
    )
    const deny = src.indexOf('gave the auto mode classifier nothing to judge')
    const flag = src.indexOf("classifierOnly?.onBlock === 'flag'")
    expect(deny).toBeGreaterThan(0)
    expect(flag).toBeGreaterThan(deny)
  })

  test('flag-allow is after recordDenial (gold AL then Xe)', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    const record = src.indexOf(
      'const newDenialState = recordDenial(denialState)',
    )
    const flagAllow = src.indexOf(
      'Flagged by the classifier, delivered with its warning:',
    )
    expect(record).toBeGreaterThan(0)
    expect(flagAllow).toBeGreaterThan(record)
  })

  test('classifierOnly fail-open unavailable stashes when yOt missed', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    expect(src).toContain("classifierOnly?.onBlock === 'flag'")
    expect(src).toContain('flagNoVerdict === undefined')
    expect(src).toContain("kind: 'unavailable'")
    expect(src).toContain('stashHandbackClassifierResult(toolUseID')
    expect(src).toContain(
      'falling back to normal permission handling (fail open)',
    )
  })
})
