/**
 * densable 2.1.218 #4 — Gnm Esc origin return decision.
 */
import { describe, expect, test } from 'bun:test'
import { decideOriginEscAction, formatLeftArrowResumeHint } from '../helpers.js'

describe('densable 2.1.218 #4 decideOriginEscAction (Gnm)', () => {
  test('no originJobId → exit', () => {
    expect(
      decideOriginEscAction({
        originJobId: undefined,
        originRowPresent: true,
      }),
    ).toEqual({ kind: 'exit' })
  })

  test('origin spawn not settled → wait-starting', () => {
    expect(
      decideOriginEscAction({
        originJobId: 'abc',
        originRowPresent: false,
        originSpawn: { settled: false, ok: false },
      }),
    ).toEqual({ kind: 'wait-starting' })
  })

  test('origin spawn failed → exit-with-hint', () => {
    expect(
      decideOriginEscAction({
        originJobId: 'abc',
        originRowPresent: false,
        originSpawn: { settled: true, ok: false },
      }),
    ).toEqual({ kind: 'exit-with-hint' })
  })

  test('origin row present → attach-origin', () => {
    expect(
      decideOriginEscAction({
        originJobId: 'abc',
        originRowPresent: true,
      }),
    ).toEqual({ kind: 'attach-origin' })
  })

  test('origin missing row → exit-with-hint', () => {
    expect(
      decideOriginEscAction({
        originJobId: 'abc',
        originRowPresent: false,
      }),
    ).toEqual({ kind: 'exit-with-hint' })
  })

  test('resume hint text', () => {
    expect(formatLeftArrowResumeHint('deadbeef')).toContain(
      'claude --resume deadbeef',
    )
  })
})
