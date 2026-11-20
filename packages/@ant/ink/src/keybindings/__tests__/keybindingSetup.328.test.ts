import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeyboardEvent } from '../../core/events/keyboard-event.js'
import type { ParsedKey } from '../../core/parse-keypress.js'
import { CHORD_TIMEOUT_MS } from '../KeybindingSetup.js'

function makeParsedKey(overrides: Partial<ParsedKey> = {}): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: '',
    raw: '',
    ...overrides,
  }
}

describe('2.1.328 KeyboardEvent jU (A-P1-3) & KeybindingSetup (A-P1-7)', () => {
  test('A-P1-3: KeyboardEvent sets meta from isEscPrefixedKey and suppresses key on meta/super/ctrl+digit', () => {
    // ESC-prefixed sequence sets meta=true and clears key while keeping shortcutKey
    const escA = new KeyboardEvent(
      makeParsedKey({ name: 'a', sequence: '\x1ba', raw: '\x1ba' }),
    )
    expect(escA.meta).toBe(true)
    expect(escA.shortcutKey).toBe('a')
    expect(escA.key).toBe('')

    // Meta + single char clears key, preserves shortcutKey
    const metaP = new KeyboardEvent(
      makeParsedKey({ name: 'p', meta: true, sequence: 'p', raw: 'p' }),
    )
    expect(metaP.meta).toBe(true)
    expect(metaP.shortcutKey).toBe('p')
    expect(metaP.key).toBe('')

    // Meta + return clears key, preserves shortcutKey
    const metaReturn = new KeyboardEvent(
      makeParsedKey({ name: 'return', meta: true, sequence: '\r', raw: '\r' }),
    )
    expect(metaReturn.shortcutKey).toBe('return')
    expect(metaReturn.key).toBe('')

    // Super + single char clears key, preserves shortcutKey
    const superK = new KeyboardEvent(
      makeParsedKey({ name: 'k', super: true, sequence: 'k', raw: 'k' }),
    )
    expect(superK.shortcutKey).toBe('k')
    expect(superK.key).toBe('')

    // Ctrl + digit/space clears key, preserves shortcutKey
    const ctrl5 = new KeyboardEvent(
      makeParsedKey({ name: '5', ctrl: true, sequence: '5', raw: '5' }),
    )
    expect(ctrl5.shortcutKey).toBe('5')
    expect(ctrl5.key).toBe('')

    const ctrlSpace = new KeyboardEvent(
      makeParsedKey({ name: 'space', ctrl: true, sequence: ' ', raw: ' ' }),
    )
    expect(ctrlSpace.shortcutKey).toBe(' ')
    expect(ctrlSpace.key).toBe('')

    // Plain printable key keeps key === shortcutKey
    const plainA = new KeyboardEvent(
      makeParsedKey({ name: 'a', sequence: 'a', raw: 'a' }),
    )
    expect(plainA.meta).toBe(false)
    expect(plainA.shortcutKey).toBe('a')
    expect(plainA.key).toBe('a')
  })

  test('A-P1-7: KeybindingSetup uses 3000ms chord timeout, feedback notification, active kmo(), and capture-first interception', () => {
    expect(CHORD_TIMEOUT_MS).toBe(3000)
    const src = readFileSync(
      join(import.meta.dir, '../KeybindingSetup.tsx'),
      'utf8',
    )
    expect(src).toContain('export const CHORD_TIMEOUT_MS = 3000')
    expect(src).toContain("key: 'chord-timeout'")
    expect(src).toContain('no next key within ${CHORD_TIMEOUT_MS / 1000}s')
    // No dead kmo(event) discard
    expect(src).not.toContain('void input;')
    expect(src).not.toContain('void key;')
    // Capture phase calls interceptChord(input, key) before emitting 'input'
    const captureStart = src.indexOf('const handleKeyDownCapture')
    const captureEnd = src.indexOf('const handleWheelCapture')
    const captureBody = src.slice(captureStart, captureEnd)
    const interceptIdx = captureBody.indexOf('interceptChord(input, key)')
    const emitIdx = captureBody.indexOf("internal_eventEmitter.emit('input'")
    expect(interceptIdx).toBeGreaterThan(0)
    expect(emitIdx).toBeGreaterThan(interceptIdx)
    // Fallback ChordInterceptor also registers with prepend: true
    expect(src).toContain('useInput(handleInput, { prepend: true })')
  })
})
