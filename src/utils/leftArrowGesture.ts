/**
 * densable 2.1.218 #4 — left-arrow empty-input gesture (odp / idp / sdp).
 *
 * Prevents accidental conversation background when the user just finished
 * editing (cleared input) and presses ← once. Second press within the arm
 * window fires; double-tap absorb suppresses bounce.
 */

/** densable Dzs — arm window + notification timeout (ms) */
export const LEFT_ARROW_ARM_WINDOW_MS = 3000

/** densable: empty-after-edit gate window (ms) — recent clear requires confirm */
export const LEFT_ARROW_EDITING_QUIET_MS = 2000

/** densable ndp — double-tap absorb window (ms) */
export const LEFT_ARROW_ABSORB_MS = 1000

/** densable _3y — attach-quiet fire min after arm (ms) */
export const LEFT_ARROW_ATTACH_FIRE_MIN_MS = 150

export type LeftArrowGestureState = {
  editedEmptyAtMs: number
  armedAtMs: number
  lastLeftPressMs: number
  attachConfirmArmedAtMs: number
}

export type LeftArrowGestureDecision =
  | 'fire'
  | 'arm'
  | 'absorb'
  | 'reject'
  | 'attach-arm'
  | 'attach-absorb'

/** densable odp() */
export function createLeftArrowGestureState(): LeftArrowGestureState {
  return {
    editedEmptyAtMs: 0,
    armedAtMs: 0,
    lastLeftPressMs: 0,
    attachConfirmArmedAtMs: 0,
  }
}

/**
 * densable idp(e, t, r, n, o=xKr(t), i=Ske())
 *
 * @param state gesture state
 * @param nowMs current time
 * @param soloKeypress densable Me.soloKeypress — false → reject (move cursor)
 * @param editingGuard densable Je("tengu_left_arrow_editing_guard", true)
 * @param attachQuiet densable xKr — attach-quiet window (usually false)
 * @param monotonicFloor densable Ske() — timestamps must be ≥ floor when non-zero
 */
export function decideLeftArrowEmptyGesture(
  state: LeftArrowGestureState,
  nowMs: number,
  soloKeypress: boolean,
  editingGuard: boolean,
  attachQuiet = false,
  monotonicFloor = 0,
): LeftArrowGestureDecision {
  if (soloKeypress !== true) return 'reject'

  const isLive = (ts: number): boolean => ts !== 0 && ts >= monotonicFloor

  // densable attach-quiet branch (o / xKr) — currently always false in official build
  if (attachQuiet) {
    if (
      isLive(state.lastLeftPressMs) &&
      nowMs - state.lastLeftPressMs < LEFT_ARROW_ABSORB_MS
    ) {
      return 'attach-absorb'
    }
    if (
      isLive(state.attachConfirmArmedAtMs) &&
      nowMs - state.attachConfirmArmedAtMs <= LEFT_ARROW_ARM_WINDOW_MS
    ) {
      return nowMs - state.attachConfirmArmedAtMs >=
        LEFT_ARROW_ATTACH_FIRE_MIN_MS
        ? 'fire'
        : 'attach-absorb'
    }
    return 'attach-arm'
  }

  // Guard off → always fire (no double-press)
  if (!editingGuard) return 'fire'

  if (
    isLive(state.lastLeftPressMs) &&
    nowMs - state.lastLeftPressMs < LEFT_ARROW_ABSORB_MS
  ) {
    return 'absorb'
  }
  if (
    isLive(state.armedAtMs) &&
    nowMs - state.armedAtMs <= LEFT_ARROW_ARM_WINDOW_MS
  ) {
    return 'fire'
  }
  // Recent empty-after-edit → arm (require second ←); else fire immediately
  return isLive(state.editedEmptyAtMs) &&
    nowMs - state.editedEmptyAtMs < LEFT_ARROW_EDITING_QUIET_MS
    ? 'arm'
    : 'fire'
}

/** densable sdp(e, t, r) — mutate gesture state after decision */
export function applyLeftArrowGestureDecision(
  state: LeftArrowGestureState,
  decision: LeftArrowGestureDecision,
  nowMs: number,
): void {
  switch (decision) {
    case 'fire':
      state.armedAtMs = 0
      state.attachConfirmArmedAtMs = 0
      state.lastLeftPressMs = nowMs
      return
    case 'arm':
      state.armedAtMs = nowMs
      state.lastLeftPressMs = nowMs
      return
    case 'absorb':
      state.lastLeftPressMs = nowMs
      return
    case 'reject':
      return
    case 'attach-arm':
      state.attachConfirmArmedAtMs = nowMs
      return
    case 'attach-absorb':
      return
  }
}

/** Stamp densable editedEmptyAtMs when input becomes empty after non-empty. */
export function noteLeftArrowInputEmptied(
  state: LeftArrowGestureState,
  nowMs: number = Date.now(),
): void {
  state.editedEmptyAtMs = nowMs
}

export const LEFT_ARROW_CONFIRM_HINT = 'Press ← again'
export const LEFT_ARROW_AGAIN_NOTIFICATION_KEY = 'left-arrow-again-for-agents'
export const LEFT_ARROW_ATTACH_HINT = 'Ambiguous ←, press again to detach'
