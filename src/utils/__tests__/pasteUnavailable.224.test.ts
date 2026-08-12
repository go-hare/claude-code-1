import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  expandPastedTextRefs,
  formatUnavailablePastedRefsMessage,
  historyPasteIdentityKey,
  isValidPasteId,
  mintPasteId,
  parseReferences,
  processPastedRefs,
  renumberHistoryEntryPastes,
  renumberPasteRefInDisplay,
  resetPasteIdAllocatorForTests,
  seedPasteIdCounter,
  stripUnavailablePastedRefs,
} from '../../history.js'
import type { PastedContent } from '../config.js'

function text(
  id: number,
  content: string,
  extra?: Partial<PastedContent>,
): PastedContent {
  return { id, type: 'text', content, ...extra }
}

function image(id: number): PastedContent {
  return {
    id,
    type: 'image',
    content: 'base64',
    mediaType: 'image/png',
  }
}

beforeEach(() => {
  resetPasteIdAllocatorForTests()
})

afterEach(() => {
  resetPasteIdAllocatorForTests()
})

describe('parseReferences densable BA (Audio)', () => {
  test('parses Audio placeholders', () => {
    const refs = parseReferences('[Audio #5]')
    expect(refs).toHaveLength(1)
    expect(refs[0]!.id).toBe(5)
    expect(refs[0]!.match).toBe('[Audio #5]')
  })

  test('parses mixed Pasted/Image/Audio/Truncated', () => {
    const refs = parseReferences(
      '[Pasted text #1] [Image #2] [Audio #3] [...Truncated text #4 +2 lines]',
    )
    expect(refs.map(r => r.id)).toEqual([1, 2, 3, 4])
  })
})

describe('expandPastedTextRefs densable d6e (skip unavailable)', () => {
  test('expands available text only', () => {
    const input = 'see [Pasted text #1] and [Pasted text #2]'
    const pasted = {
      1: text(1, 'AAA'),
      2: text(2, 'BBB', { unavailable: true }),
    }
    expect(expandPastedTextRefs(input, pasted)).toBe(
      'see AAA and [Pasted text #2]',
    )
  })

  test('leaves image refs alone', () => {
    expect(
      expandPastedTextRefs('[Image #1]', {
        1: image(1),
      }),
    ).toBe('[Image #1]')
  })
})

describe('processPastedRefs densable mLd / gLd', () => {
  test('strips unavailable non-image and expands available text', () => {
    const input = 'a [Pasted text #1] b [Pasted text #2] c [Image #3]'
    const pasted = {
      1: text(1, 'ONE'),
      2: text(2, '', { unavailable: true }),
      3: image(3),
    }
    const { stripped, expanded, removed } = processPastedRefs(input, pasted)
    expect(stripped).toBe('a [Pasted text #1] b  c [Image #3]')
    expect(expanded).toBe('a ONE b  c [Image #3]')
    expect(removed).toEqual([{ id: 2, label: 'Pasted text' }])
  })

  test('strips unavailable truncated with Truncated text label', () => {
    const input = 'x [...Truncated text #9 +3 lines] y'
    const pasted = {
      9: text(9, '', { unavailable: true }),
    }
    const { stripped, removed } = processPastedRefs(input, pasted)
    expect(stripped).toBe('x  y')
    expect(removed).toEqual([{ id: 9, label: 'Truncated text' }])
  })

  test('does not strip unavailable image placeholders', () => {
    // densable: only non-[Image refs with unavailable are stripped
    const input = 'img [Image #1] text [Pasted text #2]'
    const pasted = {
      1: { ...image(1), unavailable: true, content: '' },
      2: text(2, 'ok'),
    }
    const { stripped, expanded, removed } = processPastedRefs(input, pasted)
    expect(stripped).toBe('img [Image #1] text [Pasted text #2]')
    expect(expanded).toBe('img [Image #1] text ok')
    expect(removed).toEqual([])
  })

  test('gLd singular and plural messages', () => {
    expect(
      formatUnavailablePastedRefsMessage([{ id: 1, label: 'Pasted text' }]),
    ).toBe(
      'Pasted text #1 is no longer available and was removed from the prompt',
    )
    expect(
      formatUnavailablePastedRefsMessage([
        { id: 1, label: 'Pasted text' },
        { id: 2, label: 'Truncated text' },
      ]),
    ).toBe(
      'Pasted text #1, Truncated text #2 are no longer available and were removed from the prompt',
    )
  })

  test('vPy stripUnavailablePastedRefs returns stripped only', () => {
    const r = stripUnavailablePastedRefs('[Pasted text #1] keep', {
      1: text(1, '', { unavailable: true }),
    })
    expect(r.input).toBe(' keep')
    expect(r.removed).toHaveLength(1)
  })
})

describe('historyPasteIdentityKey densable Jqs', () => {
  test('masks ids and uses dead/hash/inline identity', () => {
    const display = 'hello [Pasted text #1] [Pasted text #2]'
    const key = historyPasteIdentityKey(display, {
      1: { unavailable: true },
      2: { content: 'body' },
    })
    expect(key.startsWith('hello [Pasted text #_] [Pasted text #_]\0')).toBe(
      true,
    )
    expect(key).toContain('dead')
    expect(key).toContain('inline:body')
  })

  test('uses contentHash when present', () => {
    const key = historyPasteIdentityKey('[Pasted text #3]', {
      3: { contentHash: 'abc' },
    })
    expect(key).toContain('hash:abc')
  })

  test('literal when missing entry', () => {
    const key = historyPasteIdentityKey('[Pasted text #4]', {})
    expect(key).toContain('literal:4')
  })
})

describe('renumberHistoryEntryPastes densable f6e (#27)', () => {
  test('renumbers history paste ids to fresh mints', () => {
    seedPasteIdCounter(10)
    const result = renumberHistoryEntryPastes({
      display: 'see [Pasted text #1 +2 lines] and [Image #2]',
      pastedContents: {
        1: text(1, 'line1\nline2\nline3'),
        2: image(2),
      },
    })
    // New ids start at 10
    expect(Object.keys(result.pastedContents).map(Number).sort()).toEqual([
      10, 11,
    ])
    expect(result.display).toContain('#10')
    expect(result.display).toContain('#11')
    expect(result.display).not.toContain('#1 ')
    expect(result.pastedContents[10]?.content).toBe('line1\nline2\nline3')
    expect(result.pastedContents[11]?.type).toBe('image')
  })

  test('skips already-minted ids (session paste)', () => {
    const liveId = mintPasteId()
    expect(liveId).toBe(1)
    const result = renumberHistoryEntryPastes({
      display: `[Pasted text #${liveId}]`,
      pastedContents: { [liveId]: text(liveId, 'live') },
    })
    // minted id kept
    expect(result.pastedContents[liveId]?.content).toBe('live')
    expect(result.display).toBe(`[Pasted text #${liveId}]`)
  })

  test('renumberPasteRefInDisplay only rewrites matching type', () => {
    const d = renumberPasteRefInDisplay(
      '[Pasted text #1] [Image #1]',
      1,
      9,
      'text',
    )
    expect(d).toBe('[Pasted text #9] [Image #1]')
  })

  test('isValidPasteId bounds', () => {
    expect(isValidPasteId(1)).toBe(true)
    expect(isValidPasteId(0)).toBe(false)
    expect(isValidPasteId(4294967296)).toBe(false)
    expect(isValidPasteId(1.5)).toBe(false)
  })
})
