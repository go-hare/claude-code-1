/**
 * densable Al() → osc h()/zue — ink cannot import src/bootstrap, so the
 * attacher-caps getter is injected once.
 */

import { setClipboardAttacherCapsGetter } from '@anthropic/ink'
import { getAttacherCaps } from '../bootstrap/state.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

const clipboardAttacherWiredHostSlot = new HostSlot<{ wired: boolean }>(() => ({
  wired: false,
}))

export function wireClipboardAttacherCaps(): void {
  const hostState = clipboardAttacherWiredHostSlot.of(getBootstrapSessionHost())
  if (hostState.wired) return
  hostState.wired = true
  setClipboardAttacherCapsGetter(() => getAttacherCaps())
}
