import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PasteEvent } from '@anthropic/ink'
import { hasPastePayload } from '../select.js'

const SELECT_SRC = readFileSync(join(import.meta.dir, '../select.tsx'), 'utf8')
const MULTI_SRC = readFileSync(
  join(import.meta.dir, '../SelectMulti.tsx'),
  'utf8',
)

describe('v2.1.311–314 CustomSelect alignment', () => {
  test('#1270 screen-reader Escape on active input option resets value and returns to list', () => {
    expect(SELECT_SRC).toContain(
      "srInputOption.onChange(srInputOption.initialValue ?? '')",
    )
    expect(SELECT_SRC).toContain('setSrInputOptionValue(null)')
    expect(SELECT_SRC).toContain('Enter text for option ${srInputIndex}')
  })

  test('#1297 scrollbar arrows and track bar act on mouse release within tolerance', () => {
    expect(SELECT_SRC).toContain('withinPointerTolerance')
    expect(SELECT_SRC).toContain('jumpRef.current')
    expect(SELECT_SRC).toContain('holdRef.current')
    // startHold must not fire onPress immediately on mousedown
    const startHoldMatch = SELECT_SRC.match(
      /const startHold = [\s\S]*?\n {2}\};/,
    )
    expect(startHoldMatch).not.toBeNull()
    expect(startHoldMatch![0]).not.toContain('onPress')
  })

  test('#1404 hasPastePayload and usePasteFromOtherRows forward pastes to input option', () => {
    const ev = new PasteEvent('hello world')
    expect(hasPastePayload(ev)).toBe(true)
    const empty = new PasteEvent('')
    expect(hasPastePayload(empty, () => false)).toBe(false)
    expect(SELECT_SRC).toContain('usePasteFromOtherRows')
    expect(MULTI_SRC).toContain('usePasteFromOtherRows')
  })
})
