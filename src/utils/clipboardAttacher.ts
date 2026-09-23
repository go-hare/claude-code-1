/**
 * densable Al() → osc h()/zue — ink cannot import src/bootstrap, so the
 * attacher-caps getter is injected once.
 */

import { setClipboardAttacherCapsGetter } from '@anthropic/ink'
import { getAttacherCaps } from '../bootstrap/state.js'

let wired = false

export function wireClipboardAttacherCaps(): void {
  if (wired) return
  wired = true
  setClipboardAttacherCapsGetter(() => getAttacherCaps())
}
