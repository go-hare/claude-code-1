// densable 2.1.239 #14 — IZg / xZg optionWindow + clampFieldRows + pKc.
import { describe, expect, test } from 'bun:test'
import { stringWidth } from '@anthropic/ink'

import {
  ELICITATION_H_CHROME,
  ELICITATION_MIN_WIDTH,
  computeElicitationAvailableRows,
  computeElicitationFieldWindow,
  computeElicitationMessageLineBudget,
  computeElicitationOptionWindow,
  elicitationMaxVisibleFields,
  elicitationOptionWindowRows,
  elicitationSubtitlePad,
  formatElicitationTitle,
  wrapElicitationMessage,
} from '../elicitationLayout.js'

describe('computeElicitationAvailableRows', () => {
  test('non-clamp uses the raw row count', () => {
    expect(computeElicitationAvailableRows(false, false, 40, true)).toBe(40)
    expect(computeElicitationAvailableRows(false, true, 24, false)).toBe(24)
  })

  test('fullscreen inside a modal keeps modal rows', () => {
    expect(computeElicitationAvailableRows(true, true, 22, true)).toBe(22)
  })

  test('fullscreen outside a modal subtracts UAt+2+session chrome', () => {
    expect(computeElicitationAvailableRows(true, false, 40, false)).toBe(36)
    expect(computeElicitationAvailableRows(true, false, 40, true)).toBe(35)
  })
})

describe('computeElicitationOptionWindow', () => {
  test('returns null when not clamping or the list fits', () => {
    expect(computeElicitationOptionWindow(false, 20, 5, 0)).toBeNull()
    expect(computeElicitationOptionWindow(true, 4, 8, 0)).toBeNull()
  })

  test('centers the focused option and keeps both hints when they fit', () => {
    expect(computeElicitationOptionWindow(true, 12, 5, 6)).toEqual({
      start: 5,
      end: 8,
      showAbove: true,
      showBelow: true,
    })
  })

  test('drops the above hint before the below hint when the budget overflows', () => {
    expect(computeElicitationOptionWindow(true, 12, 2, 6)).toEqual({
      start: 6,
      end: 7,
      showAbove: false,
      showBelow: true,
    })
    expect(computeElicitationOptionWindow(true, 12, 1, 6)).toEqual({
      start: 6,
      end: 7,
      showAbove: false,
      showBelow: false,
    })
  })

  test('pins to the tail when focus is at the end', () => {
    expect(computeElicitationOptionWindow(true, 10, 4, 9)).toEqual({
      start: 8,
      end: 10,
      showAbove: true,
      showBelow: false,
    })
  })
})

describe('computeElicitationFieldWindow', () => {
  test('returns the full range when the list fits', () => {
    expect(computeElicitationFieldWindow(4, 6, 0)).toEqual({ start: 0, end: 4 })
  })

  test('pins to the end when buttons are focused', () => {
    expect(computeElicitationFieldWindow(10, 4, undefined)).toEqual({
      start: 6,
      end: 10,
    })
  })

  test('centers the focused field', () => {
    expect(computeElicitationFieldWindow(10, 4, 5)).toEqual({
      start: 3,
      end: 7,
    })
  })
})

describe('wrapElicitationMessage', () => {
  test('joins short lines unchanged when they fit', () => {
    expect(wrapElicitationMessage('one\ntwo', 80, 4)).toBe('one\ntwo')
  })

  test('single-line budget uses a leading-space more-lines suffix', () => {
    const text = 'alpha\nbeta\ngamma'
    const out = wrapElicitationMessage(text, 80, 1)
    expect(out.endsWith(' \u2026 (+2 more lines)')).toBe(true)
    expect(out.startsWith('alpha')).toBe(true)
  })

  test('multi-line remainder is a newline + ellipsis, no leading space', () => {
    const text = ['a', 'b', 'c', 'd', 'e'].join('\n')
    expect(wrapElicitationMessage(text, 80, 3)).toBe(
      'a\nb\n\u2026 (+3 more lines)',
    )
  })
})

describe('elicitationMaxVisibleFields', () => {
  test('non-clamp matches the U-14 / 3 field window', () => {
    expect(elicitationMaxVisibleFields(false, 20, 0, 26)).toBe(4)
  })

  test('clamp accounts for the expanded option rows', () => {
    expect(elicitationMaxVisibleFields(true, 12, 3, 40)).toBe(3)
  })
})

describe('elicitationOptionWindowRows', () => {
  test('counts hints when the window is clipped', () => {
    expect(
      elicitationOptionWindowRows(true, 10, {
        start: 2,
        end: 5,
        showAbove: true,
        showBelow: true,
      }),
    ).toBe(5)
  })

  test('is zero when not clamping', () => {
    expect(elicitationOptionWindowRows(false, 20, null)).toBe(0)
  })
})

describe('computeElicitationMessageLineBudget / subtitle pad', () => {
  test('non-clamp message budget is dKc+1 and always pads a newline', () => {
    expect(computeElicitationMessageLineBudget(false, 40, 3, 1)).toBe(4)
    expect(elicitationSubtitlePad(false, 10)).toBe(1)
  })

  test('clamp drops the subtitle newline under 18 available rows', () => {
    expect(elicitationSubtitlePad(true, 17)).toBe(0)
    expect(elicitationSubtitlePad(true, 18)).toBe(1)
  })
})

describe('formatElicitationTitle', () => {
  test('non-clamp keeps the full curly-quoted title', () => {
    expect(formatElicitationTitle('weather', 80, false)).toBe(
      'MCP server \u201Cweather\u201D requests your input',
    )
  })

  test('clamp never exceeds columns minus horizontal chrome', () => {
    const columns = 40
    const title = formatElicitationTitle(
      'a-very-long-mcp-server-name',
      columns,
      true,
    )
    expect(stringWidth(title)).toBeLessThanOrEqual(
      Math.max(ELICITATION_MIN_WIDTH, columns - ELICITATION_H_CHROME),
    )
    expect(
      title.includes('\u2026') || title.includes('requests your input'),
    ).toBe(true)
  })
})
