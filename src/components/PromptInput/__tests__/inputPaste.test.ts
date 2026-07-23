import { describe, expect, test } from 'bun:test'
import type { PastedContent } from 'src/utils/config.js'
import {
  maybeTruncateInput,
  mergePastedContentsDualWrite,
} from '../inputPaste.js'

function image(id: number): PastedContent {
  return {
    id,
    type: 'image',
    content: 'base64img',
    mediaType: 'image/png',
    filename: `Image ${id}`,
  }
}

function text(id: number, content = 'hello world'): PastedContent {
  return {
    id,
    type: 'text',
    content,
  }
}

describe('mergePastedContentsDualWrite', () => {
  test('adopts empty prop when dual-write is not referenced by input (submit/clear)', () => {
    const live = { 1: image(1) }
    expect(mergePastedContentsDualWrite({}, live, '')).toEqual({})
    expect(mergePastedContentsDualWrite({}, live, 'just text')).toEqual({})
  })

  test('keeps dual-write when prop lags and input still has the pill (cacheImagePath race)', () => {
    const live = { 1: image(1) }
    const result = mergePastedContentsDualWrite({}, live, 'see [Image #1]')
    expect(result).toEqual({ 1: live[1] })
  })

  test('trims dual-write to only pills still present in input', () => {
    const live = { 1: image(1), 2: image(2), 3: text(3) }
    const result = mergePastedContentsDualWrite({}, live, '[Image #1] keep me')
    expect(Object.keys(result).map(Number).sort()).toEqual([1])
    expect(result[1]).toEqual(live[1])
  })

  test('backfills dual-write entries missing from partially committed prop', () => {
    const prop = { 1: image(1) }
    const live = { 1: image(1), 2: image(2) }
    const result = mergePastedContentsDualWrite(
      prop,
      live,
      '[Image #1] [Image #2]',
    )
    expect(result[1]).toEqual(prop[1])
    expect(result[2]).toEqual(live[2])
  })

  test('prefers prop value when both prop and dual-write have the same id', () => {
    const propEntry = image(1)
    propEntry.content = 'from-prop'
    const liveEntry = image(1)
    liveEntry.content = 'from-live'
    const result = mergePastedContentsDualWrite(
      { 1: propEntry },
      { 1: liveEntry },
      '[Image #1]',
    )
    expect(result[1]?.content).toBe('from-prop')
  })

  test('backfills long-text paste dual-write for paste+Enter same tick', () => {
    const live = { 7: text(7, 'long pasted body') }
    const result = mergePastedContentsDualWrite(
      {},
      live,
      'note [Pasted text #7 +3 lines]',
    )
    expect(result[7]).toEqual(live[7])
  })

  // densable OSe never writes ht; if fork OSe wiped ref to {} while input prop
  // lagged (empty) but liveInput already had the pill, merge would then drop
  // the dual-write on the next empty-prop render. Keep when pill is present.
  test('keeps image dual-write across empty-prop lag with image pill in input', () => {
    const live = { 1: image(1) }
    // First merge after paste: input already has pill (liveInputRef)
    expect(mergePastedContentsDualWrite({}, live, '[Image #1] hello')).toEqual({
      1: live[1],
    })
    // After accidental empty wipe of live, empty input loses it (true clear)
    expect(mergePastedContentsDualWrite({}, {}, '')).toEqual({})
  })

  test('does not invent entries for refs with no dual-write or prop data', () => {
    const result = mergePastedContentsDualWrite({}, {}, '[Image #9]')
    expect(result).toEqual({})
  })
})

describe('maybeTruncateInput', () => {
  test('returns input unchanged when short', () => {
    const pasted = {}
    const result = maybeTruncateInput('short', pasted)
    expect(result.newInput).toBe('short')
    expect(result.newPastedContents).toBe(pasted)
  })
})
