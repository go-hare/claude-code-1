import { describe, expect, test } from 'bun:test'
import {
  applyLeftArrowGestureDecision,
  createLeftArrowGestureState,
  decideLeftArrowEmptyGesture,
  LEFT_ARROW_ABSORB_MS,
  LEFT_ARROW_REPEAT_ABSORB_MS,
  noteLeftArrowInputEmptied,
} from '../leftArrowGesture.js'

describe('2.1.290 #151 leftArrowGesture (vto / kto 150ms repeat absorb)', () => {
  test('createLeftArrowGestureState initializes 325 fields', () => {
    expect(createLeftArrowGestureState()).toEqual({
      editedEmptyAtMs: 0,
      armedAtMs: 0,
      absorbAnchorMs: 0,
      lastQualifiedLeftPressMs: 0,
      attachConfirmArmedAtMs: 0,
      absorbLogged: false,
    })
  })

  test('arm → 100ms repeat absorbs, 200ms within 3000ms fires', () => {
    expect(LEFT_ARROW_REPEAT_ABSORB_MS).toBe(150)
    expect(LEFT_ARROW_ABSORB_MS).toBe(1000)

    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 1000)
    expect(decideLeftArrowEmptyGesture(s, 1100, true, true)).toBe('arm')
    applyLeftArrowGestureDecision(s, 'arm', 1100)

    // Within 150ms repeat absorb window -> absorb
    expect(decideLeftArrowEmptyGesture(s, 1100 + 100, true, true)).toBe(
      'absorb',
    )
    applyLeftArrowGestureDecision(s, 'absorb', 1100 + 100)

    // After 150ms from lastQualifiedLeftPressMs (1200 + 160 = 1360) and within 3000ms arm window -> fire!
    expect(decideLeftArrowEmptyGesture(s, 1360, true, true)).toBe('fire')
    applyLeftArrowGestureDecision(s, 'fire', 1360)
    expect(s.armedAtMs).toBe(0)
    expect(s.editedEmptyAtMs).toBe(0)
  })

  test('after fire, press within 1000ms absorbAnchorMs absorbs', () => {
    const s = createLeftArrowGestureState()
    applyLeftArrowGestureDecision(s, 'fire', 5000)
    expect(decideLeftArrowEmptyGesture(s, 5500, true, true)).toBe('absorb')
    expect(decideLeftArrowEmptyGesture(s, 6000, true, true)).toBe('fire')
  })
})
