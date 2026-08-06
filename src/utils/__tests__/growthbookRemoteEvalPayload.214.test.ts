import { describe, expect, test } from 'bun:test'
import {
  coalesceNullFeatureValue,
  processRemoteEvalFeatures,
} from '../growthbookRemoteEvalPayload.js'

describe('coalesceNullFeatureValue (densable nji)', () => {
  test('null falls back to default', () => {
    expect(coalesceNullFeatureValue(null, false)).toBe(false)
    expect(coalesceNullFeatureValue(null, { a: 1 })).toEqual({ a: 1 })
  })

  test('non-null preserved (including false/0/"")', () => {
    expect(coalesceNullFeatureValue(false, true)).toBe(false)
    expect(coalesceNullFeatureValue(0, 99)).toBe(0)
    expect(coalesceNullFeatureValue('', 'x')).toBe('')
    expect(coalesceNullFeatureValue(true, false)).toBe(true)
  })

  test('undefined is not coalesced (reader path uses has/undefined separately)', () => {
    expect(coalesceNullFeatureValue(undefined, 'def') as unknown).toBe(
      undefined,
    )
  })
})

describe('processRemoteEvalFeatures (densable RUc)', () => {
  test('empty / missing → no wipe', () => {
    expect(processRemoteEvalFeatures(undefined)).toEqual({
      ok: false,
      reason: 'empty_payload',
    })
    expect(processRemoteEvalFeatures({})).toEqual({
      ok: false,
      reason: 'empty_payload',
    })
  })

  test('null feature def skipped without crash', () => {
    const r = processRemoteEvalFeatures({
      good: { value: true },
      bad: null,
      also: 'string',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.values.get('good')).toBe(true)
    expect(r.values.has('bad')).toBe(false)
    expect(r.skippedNonObject).toEqual(['bad:null', 'also:string'])
  })

  test('value-less entries dropped; all value-less → no wipe', () => {
    const allBad = processRemoteEvalFeatures({
      a: { source: 'defaultValue' },
      b: {},
    })
    expect(allBad).toEqual({ ok: false, reason: 'no_values' })

    const mixed = processRemoteEvalFeatures({
      a: { source: 'defaultValue' },
      b: { value: 1 },
    })
    expect(mixed.ok).toBe(true)
    if (!mixed.ok) return
    expect(mixed.values.get('b')).toBe(1)
    expect(mixed.values.has('a')).toBe(false)
    expect(mixed.skippedValueLess).toEqual(['a'])
  })

  test('explicit null value is kept (nji handles at read)', () => {
    const r = processRemoteEvalFeatures({
      n: { value: null },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.values.has('n')).toBe(true)
    expect(r.values.get('n')).toBe(null)
  })

  test('value → defaultValue transform', () => {
    const r = processRemoteEvalFeatures({
      f: { value: 42, source: 'experiment' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.features.f.defaultValue).toBe(42)
    expect(r.values.get('f')).toBe(42)
  })

  test('malformed experiment skipped; well-formed kept', () => {
    const r = processRemoteEvalFeatures({
      ok: {
        value: true,
        source: 'experiment',
        experiment: { key: 'exp1' },
        experimentResult: { variationId: 2 },
      },
      bad: {
        value: false,
        source: 'experiment',
        experimentResult: {},
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.experiments.get('ok')).toEqual({
      experimentId: 'exp1',
      variationId: 2,
    })
    expect(r.experiments.has('bad')).toBe(false)
    expect(r.skippedMalformedExperiment.length).toBe(1)
  })

  test('all null feature defs → no wipe', () => {
    expect(
      processRemoteEvalFeatures({
        a: null,
        b: null,
      }),
    ).toEqual({ ok: false, reason: 'no_values' })
  })
})
