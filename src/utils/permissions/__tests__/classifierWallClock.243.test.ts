/**
 * densable 2.1.243 #14 — classifier `tBt` wall-clock: `$ae=60000`
 * `per_attempt` on xml_s1, `Dae=120000` `per_call` on xml_s2, `hon=60000`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CLASSIFIER_SIDE_QUERY_TIMEOUT_MS,
  CLASSIFIER_XML_S1_WALL_CLOCK_MS,
  CLASSIFIER_XML_S2_WALL_CLOCK_MS,
} from '../classifierWallClock.js'

const wallClockSrc = readFileSync(
  join(import.meta.dir, '../classifierWallClock.ts'),
  'utf8',
)
const classifierSrc = readFileSync(
  join(import.meta.dir, '../yoloClassifier.ts'),
  'utf8',
)
const sideQuerySrc = readFileSync(
  join(import.meta.dir, '../../sideQuery.ts'),
  'utf8',
)

describe('densable 2.1.243 #14 classifier per_attempt wall-clock', () => {
  test('official $ae / Dae / hon constants', () => {
    expect(CLASSIFIER_XML_S1_WALL_CLOCK_MS).toBe(60_000)
    expect(CLASSIFIER_XML_S2_WALL_CLOCK_MS).toBe(120_000)
    expect(CLASSIFIER_SIDE_QUERY_TIMEOUT_MS).toBe(60_000)
    expect(wallClockSrc).toContain("policy === 'per_attempt'")
    expect(wallClockSrc).toContain('timeout: CLASSIFIER_SIDE_QUERY_TIMEOUT_MS')
    expect(wallClockSrc).toContain('onFetchAttempt:')
    expect(wallClockSrc).toContain('AbortSignal.any')
  })

  test('xml_s1 uses per_attempt $ae; xml_s2 uses per_call Dae', () => {
    expect(classifierSrc).toContain('CLASSIFIER_XML_S1_WALL_CLOCK_MS')
    expect(classifierSrc).toContain('CLASSIFIER_XML_S2_WALL_CLOCK_MS')
    expect(classifierSrc).toContain("'per_attempt'")
    expect(classifierSrc).toContain("'per_call'")
    expect(classifierSrc).toContain('sideQueryWithClassifierWallClock')
    const s1 = classifierSrc.indexOf('CLASSIFIER_XML_S1_WALL_CLOCK_MS')
    const s1Policy = classifierSrc.indexOf("'per_attempt'", s1)
    const s2 = classifierSrc.indexOf('CLASSIFIER_XML_S2_WALL_CLOCK_MS')
    const s2Policy = classifierSrc.indexOf("'per_call'", s2)
    expect(s1).toBeGreaterThan(0)
    expect(s1Policy).toBeGreaterThan(s1)
    expect(s2).toBeGreaterThan(s1)
    expect(s2Policy).toBeGreaterThan(s2)
  })

  test('A$ forwards timeout and onFetchAttempt through fetchOverride', () => {
    expect(sideQuerySrc).toContain('onFetchAttempt?: () => void')
    expect(sideQuerySrc).toContain('timeout?: number')
    expect(sideQuerySrc).toContain('onFetchAttempt()')
    expect(sideQuerySrc).toContain('fetchOverride:')
    expect(sideQuerySrc).toContain('...(timeout !== undefined && { timeout })')
  })
})
