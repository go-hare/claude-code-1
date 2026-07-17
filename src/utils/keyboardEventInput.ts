import type { Key, KeyboardEvent } from '@anthropic/ink'

/**
 * Official densable 2.1.210 `tS_` — functional key names that must NOT insert
 * via `insert(q.key)` even when `q.key` is non-empty (named multi-char keys
 * like "wheeldown" / "enter" / "f1").
 *
 *   tS_ = new Set(["pageup","pagedown","insert","wheelup","wheeldown",
 *                  "mouse","clear","enter","f1"…"f12"])
 *
 * Arrows / return / tab / escape / backspace / delete are handled by name
 * before the insert branch, so they are not in tS_ but still never type
 * their key string as text.
 */
export const FUNCTIONAL_KEY_NAMES = new Set([
  'pageup',
  'pagedown',
  'insert',
  'wheelup',
  'wheeldown',
  'mouse',
  'clear',
  'enter',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

/**
 * Map official KeyboardEvent → Ink `Key` flags used by useTextInput mapKey.
 * Mirrors InputEvent.parseKey name→flag mapping, driven by KeyboardEvent.name
 * (not sji InputEvent).
 */
export function keyFromKeyboardEvent(e: KeyboardEvent): Key {
  return {
    upArrow: e.name === 'up',
    downArrow: e.name === 'down',
    leftArrow: e.name === 'left',
    rightArrow: e.name === 'right',
    pageDown: e.name === 'pagedown',
    pageUp: e.name === 'pageup',
    wheelUp: e.name === 'wheelup',
    wheelDown: e.name === 'wheeldown',
    home: e.name === 'home',
    end: e.name === 'end',
    // Official: only name "return" submits; bare \n is name "enter".
    return: e.name === 'return',
    escape: e.name === 'escape',
    ctrl: e.ctrl,
    shift: e.shift,
    fn: e.fn,
    tab: e.name === 'tab',
    backspace: e.name === 'backspace',
    delete: e.name === 'delete',
    meta: e.meta,
    super: e.superKey,
  }
}

/**
 * Official insert payload for main prompt:
 *   if (q.key.length >= 1 && !tS_.has(q.name)) insert(q.key)
 *
 * Plus name==="enter" → "\n" so multiline path matches densable sji/handleKeyDown.
 * Named functional keys (return/tab/arrows/…) yield "" — mapKey handles them.
 */
export function insertInputFromKeyboardEvent(e: KeyboardEvent): string {
  if (e.name === 'enter') return '\n'
  // Named edit/nav keys are handled by mapKey; never treat their key string
  // as insertable text (e.g. key==="return", key==="backspace").
  if (
    e.name === 'return' ||
    e.name === 'tab' ||
    e.name === 'escape' ||
    e.name === 'backspace' ||
    e.name === 'delete' ||
    e.name === 'up' ||
    e.name === 'down' ||
    e.name === 'left' ||
    e.name === 'right' ||
    e.name === 'home' ||
    e.name === 'end'
  ) {
    return ''
  }
  if (e.key.length >= 1 && !FUNCTIONAL_KEY_NAMES.has(e.name)) {
    return e.key
  }
  return ''
}
