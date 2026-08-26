/**
 * densable 2.1.239 SEA: EFi → Ji.push(Co); !Gm → yield*Ji then current.
 * ztm/Jsm withhold without buffering. No stream-end leftover flush.
 */
import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '../../../types/message.js'
import { applyStreamMediaReplay } from '../streamMediaReplay.js'

type ReplayItem = AssistantMessage | { type: 'stream_event'; uuid: string }

function assistant(id: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: id,
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [] },
  } as AssistantMessage
}

function streamEvent(id: string): { type: 'stream_event'; uuid: string } {
  return { type: 'stream_event', uuid: id }
}

describe('densable 2.1.239 Ji media replay', () => {
  test('EFi: media withhold pushes original Co; does not replay yet', () => {
    const buffer: ReplayItem[] = []
    const media = assistant('media')
    const out = applyStreamMediaReplay(buffer, media, {
      ptl: false,
      media: true,
      maxOutputTokens: false,
    })
    expect(out.withheld).toBe(true)
    expect(out.replay).toEqual([])
    expect(buffer).toEqual([media])
  })

  test('ztm: PTL withhold does not push Ji', () => {
    const buffer: ReplayItem[] = []
    const out = applyStreamMediaReplay(buffer, assistant('ptl'), {
      ptl: true,
      media: false,
      maxOutputTokens: false,
    })
    expect(out.withheld).toBe(true)
    expect(out.replay).toEqual([])
    expect(buffer).toEqual([])
  })

  test('Jsm: max_output_tokens withhold does not push Ji', () => {
    const buffer: ReplayItem[] = []
    const out = applyStreamMediaReplay(buffer, assistant('max'), {
      ptl: false,
      media: false,
      maxOutputTokens: true,
    })
    expect(out.withheld).toBe(true)
    expect(out.replay).toEqual([])
    expect(buffer).toEqual([])
  })

  test('EFi then ztm: leftover Ji stays (no flush on withheld)', () => {
    const buffer: ReplayItem[] = []
    const media = assistant('media')
    applyStreamMediaReplay(buffer, media, {
      ptl: false,
      media: true,
      maxOutputTokens: false,
    })
    const out = applyStreamMediaReplay(buffer, assistant('ptl'), {
      ptl: true,
      media: false,
      maxOutputTokens: false,
    })
    expect(out.withheld).toBe(true)
    expect(out.replay).toEqual([])
    expect(buffer).toEqual([media])
  })

  test('EFi then !Gm: yield*Ji then current; buffer cleared', () => {
    const buffer: ReplayItem[] = []
    const media = assistant('media')
    applyStreamMediaReplay(buffer, media, {
      ptl: false,
      media: true,
      maxOutputTokens: false,
    })
    const next = streamEvent('delta')
    const out = applyStreamMediaReplay(buffer, next, {
      ptl: false,
      media: false,
      maxOutputTokens: false,
    })
    expect(out.withheld).toBe(false)
    expect(out.replay).toEqual([media])
    expect(buffer).toEqual([])
  })

  test('media+ptl same Co: official both ifs still push Ji', () => {
    const buffer: ReplayItem[] = []
    const both = assistant('both')
    const out = applyStreamMediaReplay(buffer, both, {
      ptl: true,
      media: true,
      maxOutputTokens: false,
    })
    expect(out.withheld).toBe(true)
    expect(out.replay).toEqual([])
    expect(buffer).toEqual([both])
  })

  test('leftover Ji is not auto-flushed (no stream-end host)', () => {
    const buffer: ReplayItem[] = []
    const media = assistant('media')
    applyStreamMediaReplay(buffer, media, {
      ptl: false,
      media: true,
      maxOutputTokens: false,
    })
    expect(buffer).toEqual([media])
  })
})
