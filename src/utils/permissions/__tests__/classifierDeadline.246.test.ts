/**
 * densable 2.1.246 #17 — official `qin` / `GLs` deadline scale.
 *
 * `qin(e){t=max(0,ceil((e-50000)/50000));return min(W6,vst+t*1e4)}`
 * `N=qin(max(R,P))` → s1 `{deadlineMs:c,attemptTimeoutMs:c,ceilingMs}`
 * s2 `{deadlineMs:W6,attemptTimeoutMs:max(Bin,c)}`
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CLASSIFIER_SIDE_QUERY_TIMEOUT_MS,
  CLASSIFIER_XML_S1_WALL_CLOCK_MS,
  CLASSIFIER_XML_S2_WALL_CLOCK_MS,
  scaleClassifierDeadlineMs,
} from '../classifierWallClock.js'

const classifierSrc = readFileSync(
  join(import.meta.dir, '../yoloClassifier.ts'),
  'utf8',
)
const wallClockSrc = readFileSync(
  join(import.meta.dir, '../classifierWallClock.ts'),
  'utf8',
)

describe('densable 2.1.246 #17 qin deadline scale', () => {
  test('qin: base 60s, +10s per 50k tokens over 50k, cap 120s', () => {
    expect(scaleClassifierDeadlineMs(0)).toBe(60_000)
    expect(scaleClassifierDeadlineMs(50_000)).toBe(60_000)
    expect(scaleClassifierDeadlineMs(50_001)).toBe(70_000)
    expect(scaleClassifierDeadlineMs(100_000)).toBe(70_000)
    expect(scaleClassifierDeadlineMs(100_001)).toBe(80_000)
    expect(scaleClassifierDeadlineMs(350_000)).toBe(120_000)
    expect(scaleClassifierDeadlineMs(1_000_000)).toBe(120_000)
    expect(CLASSIFIER_XML_S1_WALL_CLOCK_MS).toBe(60_000)
    expect(CLASSIFIER_XML_S2_WALL_CLOCK_MS).toBe(120_000)
    expect(CLASSIFIER_SIDE_QUERY_TIMEOUT_MS).toBe(60_000)
  })

  test('xml_s1 uses qin(max(R,P)) + ceilingMs; xml_s2 uses W6 + max(Bin,c)', () => {
    expect(classifierSrc).toContain('scaleClassifierDeadlineMs')
    expect(classifierSrc).toContain(
      'Math.max(\n      dumpContextInfo.classifierTokensEst,\n      dumpContextInfo.mainLoopTokens,',
    )
    expect(classifierSrc).toContain('deadlineMs: scaledDeadlineMs')
    expect(classifierSrc).toContain('attemptTimeoutMs: scaledDeadlineMs')
    expect(classifierSrc).toContain('ceilingMs: stage1CeilingMs')
    expect(classifierSrc).toContain(
      'deadlineMs: CLASSIFIER_XML_S2_WALL_CLOCK_MS',
    )
    expect(classifierSrc).toContain(
      'attemptTimeoutMs: Math.max(\n          CLASSIFIER_SIDE_QUERY_TIMEOUT_MS,\n          scaledDeadlineMs,',
    )
    expect(wallClockSrc).toContain('ceilingMs === undefined')
    expect(wallClockSrc).toContain('createCombinedAbortSignal')
  })

  test('X3 always GLs; n0s/r0s never disable XML', () => {
    expect(classifierSrc).toContain('classifyYoloActionXml')
    expect(classifierSrc).toContain("if (mode !== 'thinking')")
    expect(classifierSrc).toContain(
      "v === 'fast' || v === 'thinking' ? v : 'both'",
    )
    expect(classifierSrc).not.toContain('isTwoStageClassifierEnabled')
    expect(classifierSrc).not.toContain('classifyYoloActionToolUse')
    expect(classifierSrc).toContain(
      'deadlineMs: CLASSIFIER_XML_S2_WALL_CLOCK_MS',
    )
  })
})
