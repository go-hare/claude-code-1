/**
 * densable 2.1.218 #4 — idp/sdp left-arrow editing-quiet confirm.
 */
import { describe, expect, test } from 'bun:test'
import {
  applyLeftArrowGestureDecision,
  createLeftArrowGestureState,
  decideLeftArrowEmptyGesture,
  LEFT_ARROW_ABSORB_MS,
  LEFT_ARROW_ARM_WINDOW_MS,
  LEFT_ARROW_EDITING_QUIET_MS,
  noteLeftArrowInputEmptied,
} from '../leftArrowGesture.js'

describe('densable 2.1.218 #4 leftArrowGesture (idp/sdp)', () => {
  test('odp initial state is zeros', () => {
    expect(createLeftArrowGestureState()).toEqual({
      editedEmptyAtMs: 0,
      armedAtMs: 0,
      lastLeftPressMs: 0,
      attachConfirmArmedAtMs: 0,
    })
  })

  test('reject when not solo keypress', () => {
    const s = createLeftArrowGestureState()
    expect(decideLeftArrowEmptyGesture(s, 1000, false, true)).toBe('reject')
  })

  test('guard off → fire', () => {
    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 900)
    expect(decideLeftArrowEmptyGesture(s, 1000, true, false)).toBe('fire')
  })

  test('no recent empty → fire (no always-on double-press)', () => {
    const s = createLeftArrowGestureState()
    expect(decideLeftArrowEmptyGesture(s, 5000, true, true)).toBe('fire')
  })

  test('recent empty-after-edit arms within 2000ms', () => {
    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 1000)
    expect(
      decideLeftArrowEmptyGesture(
        s,
        1000 + LEFT_ARROW_EDITING_QUIET_MS - 1,
        true,
        true,
      ),
    ).toBe('arm')
    expect(
      decideLeftArrowEmptyGesture(
        s,
        1000 + LEFT_ARROW_EDITING_QUIET_MS,
        true,
        true,
      ),
    ).toBe('fire')
  })

  test('second press within arm window fires', () => {
    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 1000)
    const t1 = 1100
    expect(decideLeftArrowEmptyGesture(s, t1, true, true)).toBe('arm')
    applyLeftArrowGestureDecision(s, 'arm', t1)
    // absorb window: wait past ndp
    const t2 = t1 + LEFT_ARROW_ABSORB_MS + 1
    expect(decideLeftArrowEmptyGesture(s, t2, true, true)).toBe('fire')
    applyLeftArrowGestureDecision(s, 'fire', t2)
    expect(s.armedAtMs).toBe(0)
    expect(s.lastLeftPressMs).toBe(t2)
  })

  test('double-tap within absorb window is absorb', () => {
    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 1000)
    applyLeftArrowGestureDecision(s, 'arm', 1100)
    expect(decideLeftArrowEmptyGesture(s, 1100 + 50, true, true)).toBe('absorb')
  })

  test('arm window expires after Dzs=3000 → re-arm if still in quiet', () => {
    const s = createLeftArrowGestureState()
    noteLeftArrowInputEmptied(s, 1000)
    applyLeftArrowGestureDecision(s, 'arm', 1100)
    // quiet expired and arm expired
    const t = 1100 + LEFT_ARROW_ARM_WINDOW_MS + 1
    expect(decideLeftArrowEmptyGesture(s, t, true, true)).toBe('fire')
  })

  test('attach-quiet arm / fire / absorb', () => {
    const s = createLeftArrowGestureState()
    expect(decideLeftArrowEmptyGesture(s, 1000, true, true, true)).toBe(
      'attach-arm',
    )
    applyLeftArrowGestureDecision(s, 'attach-arm', 1000)
    // too soon after arm → attach-absorb
    expect(decideLeftArrowEmptyGesture(s, 1000 + 50, true, true, true)).toBe(
      'attach-absorb',
    )
    // past _3y → fire
    expect(decideLeftArrowEmptyGesture(s, 1000 + 200, true, true, true)).toBe(
      'fire',
    )
  })
})
