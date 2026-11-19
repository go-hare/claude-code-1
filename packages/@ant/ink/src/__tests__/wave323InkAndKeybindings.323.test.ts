import { describe, expect, test } from 'bun:test'
import { isMultiCharTextEvent } from '../core/events/keyboard-event.js'
import { reorderLeadingCombiningMarks } from '../core/output.js'
import {
  clearScreenReaderAnnouncements,
  isScreenReaderHoldActive,
  startScreenReaderHold,
} from '../core/screenReaderAnnounce.js'
import { wrapAnsi } from '../core/wrapAnsi.js'
import {
  hasLostKeystrokePart,
  parseKeystroke,
  stripLostModifierBindings,
} from '../keybindings/parser.js'

describe('Wave 323 Ink & Keybindings (#1989, #1990, #2074, #2088, #2089)', () => {
  test('#1989 reorderLeadingCombiningMarks moves leading combining marks after base char and wrapAnsi preserves them', () => {
    expect(reorderLeadingCombiningMarks('\u0301e')).toBe('e\u0301')
    expect(reorderLeadingCombiningMarks('e\u0301')).toBe('e\u0301')
    expect(reorderLeadingCombiningMarks('plain')).toBe('plain')

    const wrapped = wrapAnsi('cafe\u0301 world', 6)
    expect(wrapped).toContain('e\u0301')
  })

  test('#2074 misspelled keybinding modifier is detected and stripped instead of binding bare key', () => {
    expect(hasLostKeystrokePart('ctl+k')).toBe(true)
    expect(hasLostKeystrokePart('shfit+tab')).toBe(true)
    expect(hasLostKeystrokePart('ctrl+k')).toBe(false)
    expect(hasLostKeystrokePart('ctrl+del')).toBe(false)
    expect(parseKeystroke('ctrl+del')).toEqual({
      key: 'delete',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
      super: false,
    })

    const stripped = stripLostModifierBindings([
      {
        context: 'Chat',
        bindings: {
          'ctl+k': 'chat:newline',
          'ctrl+k': 'chat:cancel',
        },
      },
    ])
    expect(stripped[0]?.bindings).toEqual({ 'ctrl+k': 'chat:cancel' })
  })

  test('#2088 screen reader hold uses monotonic performance.now() clock', () => {
    clearScreenReaderAnnouncements()
    const now = performance.now()
    startScreenReaderHold(now + 5000)
    expect(isScreenReaderHoldActive(now + 1000)).toBe(true)
    expect(isScreenReaderHoldActive(now + 6000)).toBe(false)
    clearScreenReaderAnnouncements()
  })

  test('#2089 isMultiCharTextEvent accepts dictated/emoji input and rejects named control keys', () => {
    expect(isMultiCharTextEvent({ key: 'hello world', name: '' })).toBe(true)
    expect(isMultiCharTextEvent({ key: '🎉', name: '' })).toBe(true)
    expect(isMultiCharTextEvent({ key: 'return', name: 'return' })).toBe(false)
    expect(isMultiCharTextEvent({ key: 'a', name: 'a' })).toBe(false)
  })
})
