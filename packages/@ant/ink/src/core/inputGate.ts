/**
 * Official 2.1.328 `class Kh` (`InputGate` @307106586) — drops early accidental
 * commit/confirmation keys right after a gated dialog or menu paints, while
 * honoring `wantEveryKey` opt-outs (e.g. search inputs / ThemePicker).
 */
import type { DOMElement, InputGateWait } from './dom.js'
import {
  isMultiCharTextEvent,
  type KeyboardEvent,
} from './events/keyboard-event.js'

const EARLY_KEY_WINDOW_MS = 700
const REPEAT_DROPPED_WINDOW_MS = 1000
const TYPING_NO_RE = /^("\P{Cc}|(paste|backspace|delete|left|right|return)$)/u

export const INPUT_GATE_OTHER = 'other'
export const INPUT_GATE_WAY_OUT = 'way out'

function goBackDoneSentinel(): void {}

function setWaitDropped(
  wait: InputGateWait,
  dropped: string | null | undefined,
  detail?: unknown,
): void {
  if (dropped !== undefined || wait.dropped !== undefined) {
    wait.dropped = dropped
    wait.onChange(dropped, detail)
  }
}

/** Official `Gx` — walk ancestors for the enclosing wait frame and question node. */
function findGate(node: DOMElement): {
  frame?: DOMElement
  question?: DOMElement
} {
  let question: DOMElement | undefined
  for (let cur: DOMElement | undefined = node; cur; cur = cur.parentNode) {
    if (question === undefined && cur.no) {
      question = cur
    }
    if (cur.wait) {
      return {
        frame: cur,
        question: question ?? (cur.wait.isMenu ? undefined : cur),
      }
    }
  }
  return {}
}

/** Official `bT` — latest `firstFrame.writtenAt` along node's ancestor chain. */
function latestFirstFrameWrittenAt(node: DOMElement): number {
  let latest = Number.NEGATIVE_INFINITY
  for (let cur: DOMElement | undefined = node; cur; cur = cur.parentNode) {
    latest = Math.max(latest, cur.firstFrame?.writtenAt ?? latest)
  }
  return latest
}

/** Official `zM` — printable character or multi-char text event. */
export function isPrintableKeyboardEvent(event: KeyboardEvent): boolean {
  return (
    isMultiCharTextEvent(event) || (!event.ctrl && [...event.key].length === 1)
  )
}

/** Official `ICo(event, true)` — digit/space/comma shortcut key when `key` was cleared. */
export function shortcutKeyForInputGate(event: KeyboardEvent): string {
  return event.key === '' && /^[0-9 ,]$/.test(event.shortcutKey)
    ? event.shortcutKey
    : ''
}

export class InputGate {
  private readonly wantsEveryKey: (owner: unknown) => boolean
  private last = {
    input: '',
    at: Number.NEGATIVE_INFINITY,
    runFrom: 0,
  }
  private lastFrame: DOMElement | undefined

  constructor(wantsEveryKey: (owner: unknown) => boolean = () => false) {
    this.wantsEveryKey = wantsEveryKey
  }

  drops(
    target: DOMElement,
    input: string,
    at: number,
    detail?: unknown,
  ): boolean {
    const { frame, question } = findGate(target)
    const wait = frame?.wait
    const burstWindow =
      wait?.dropped === undefined
        ? EARLY_KEY_WINDOW_MS
        : REPEAT_DROPPED_WINDOW_MS
    const inBurst = at - this.last.at < burstWindow
    const sameInputInBurst = inBurst && input === this.last.input
    const runFrom = !inBurst
      ? at
      : frame === this.lastFrame
        ? this.last.runFrom
        : Number.NEGATIVE_INFINITY

    this.last = { input, at, runFrom }
    this.lastFrame = frame

    if (
      !wait ||
      input === INPUT_GATE_OTHER ||
      this.wantsEveryKey(wait.owner ?? null)
    ) {
      return false
    }

    if (input === INPUT_GATE_WAY_OUT) {
      wait.onChange(undefined)
      return false
    }

    const consecutiveReturn = sameInputInBurst && input === 'return'
    if (!question) {
      setWaitDropped(wait, undefined)
      wait.dropped = consecutiveReturn ? input : undefined
      return consecutiveReturn
    }

    const { dropped } = wait
    const goBack =
      wait.goBack === goBackDoneSentinel && !inBurst ? undefined : wait.goBack

    if (input === question.no?.key && dropped !== null) {
      return false
    }

    const confirmsOrNavigates =
      input === 'down' || input === 'click' || input === dropped
    if (
      runFrom < latestFirstFrameWrittenAt(question) + EARLY_KEY_WINDOW_MS ||
      consecutiveReturn ||
      (dropped !== undefined && (inBurst || !confirmsOrNavigates)) ||
      (dropped === undefined && goBack !== undefined && input.startsWith('"'))
    ) {
      if (question.no?.isBeingTyped() && TYPING_NO_RE.test(input)) {
        wait.dropped = null
        wait.onChange(undefined)
        return false
      }
      setWaitDropped(
        wait,
        dropped === undefined || dropped === input ? input : null,
        input === 'click' ? input : detail,
      )
      return true
    }

    setWaitDropped(wait, undefined)
    wait.goBack = undefined

    if (input === 'down' && dropped !== undefined) {
      wait.goBack = question.no?.goTo()
      return wait.goBack !== undefined
    }

    if (goBack && (input === 'up' || (input === 'down' && sameInputInBurst))) {
      if (input === 'up') goBack()
      wait.goBack = goBackDoneSentinel
      return true
    }

    return false
  }

  noteStrayText(target: DOMElement): void {
    const { frame, question } = findGate(target)
    if (
      frame?.wait &&
      question &&
      !this.wantsEveryKey(frame.wait.owner ?? null)
    ) {
      setWaitDropped(frame.wait, null)
    }
  }
}
