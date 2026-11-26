/**
 * densable hover-rest pin — `_828.js` sud/tud @204616439.
 * `e===true` is Po(); first write is "pinned", same value "unchanged",
 * different value "conflict".
 */

import {
  getBootstrapSessionHost,
  HostSlot,
  ofDefaultHost,
} from '../sessionHost.js'

const hoverRestPinHostSlot = new HostSlot<{
  hoverRestOn: boolean | undefined
}>(() => ({
  hoverRestOn: undefined,
}))

function getHoverRestPinState(): { hoverRestOn: boolean | undefined } {
  return hoverRestPinHostSlot.of(getBootstrapSessionHost())
}

export type HoverRestPinResult = 'pinned' | 'unchanged' | 'conflict'

export function isHoverRestOn(): boolean {
  const own = hoverRestPinHostSlot.peek(getBootstrapSessionHost())
  if (own !== undefined && own.hoverRestOn !== undefined) {
    return own.hoverRestOn === true
  }
  return ofDefaultHost(hoverRestPinHostSlot).hoverRestOn === true
}

export function pinHoverRest(value: unknown): HoverRestPinResult {
  const state = getHoverRestPinState()
  const on = value === true
  if (state.hoverRestOn === undefined) {
    state.hoverRestOn = on
    return 'pinned'
  }
  return state.hoverRestOn === on ? 'unchanged' : 'conflict'
}

export function resetHoverRestPinForTests(): void {
  const slot = hoverRestPinHostSlot.peek(getBootstrapSessionHost())
  if (slot) {
    slot.hoverRestOn = undefined
  }
}
