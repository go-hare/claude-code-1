import { afterEach, describe, expect, test } from 'bun:test'
import {
  isPersonInitiatedUiScroll,
  revealInTranscript,
  scrollTranscriptByRequestId,
  setTranscriptRevealHost,
} from '../transcriptReveal.js'

afterEach(() => {
  setTranscriptRevealHost(undefined)
})

describe('densable 2.1.289 transcript reveal (vat/Xi)', () => {
  test('no host → unscrollable / transcript not scrollable', async () => {
    expect(await revealInTranscript('abc')).toBe('unscrollable')
    expect(
      await scrollTranscriptByRequestId('abc', 'nearest', {
        origin: [{}],
        isPersonInput: true,
      }),
    ).toEqual({ deny: 'transcript not scrollable here' })
  })

  test('dZ person gate: single origin + isPersonInput', () => {
    expect(
      isPersonInitiatedUiScroll({
        origin: [{ kind: 'person' }],
        isPersonInput: true,
      }),
    ).toBe(true)
    expect(
      isPersonInitiatedUiScroll({
        origin: [{ kind: 'plugin' }],
        isPersonInput: false,
      }),
    ).toBe(false)
  })

  test('dZ person gate: single origin + rootEvent ui.press|input|select', () => {
    expect(
      isPersonInitiatedUiScroll({
        origin: [{ kind: 'plugin' }],
        rootEvent: 'ui.press',
      }),
    ).toBe(true)
    expect(
      isPersonInitiatedUiScroll({
        origin: [{ kind: 'plugin' }],
        rootEvent: 'ui.render',
      }),
    ).toBe(false)
  })

  test('reveal alphabet: revealed / unknown', async () => {
    setTranscriptRevealHost({
      reveal: id => (id === 'known' ? Promise.resolve(true) : null),
    })
    expect(await revealInTranscript('known')).toBe('revealed')
    expect(await revealInTranscript('missing')).toBe('unknown')
    expect(
      await scrollTranscriptByRequestId('known', 'nearest', {
        origin: [{}],
        isPersonInput: true,
      }),
    ).toEqual({})
    expect(
      await scrollTranscriptByRequestId('missing', 'nearest', {
        origin: [{}],
        isPersonInput: true,
      }),
    ).toEqual({ deny: 'nothing drawn under that requestId' })
  })

  test('not person-initiated deny', async () => {
    setTranscriptRevealHost({
      reveal: () => Promise.resolve(true),
    })
    expect(
      await scrollTranscriptByRequestId('x', 'nearest', {
        origin: [{ kind: 'plugin' }],
        rootEvent: 'ui.render',
      }),
    ).toEqual({ deny: 'not person-initiated' })
  })
})
