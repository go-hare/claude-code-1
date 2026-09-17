/**
 * densable hover-rest pin — `_828.js` sud/tud @204616439.
 * `e===true` is Po(); first write is "pinned", same value "unchanged",
 * different value "conflict".
 */

let hoverRestOn: boolean | undefined

export type HoverRestPinResult = 'pinned' | 'unchanged' | 'conflict'

export function isHoverRestOn(): boolean {
  return hoverRestOn === true
}

export function pinHoverRest(value: unknown): HoverRestPinResult {
  const on = value === true
  if (hoverRestOn === undefined) {
    hoverRestOn = on
    return 'pinned'
  }
  return hoverRestOn === on ? 'unchanged' : 'conflict'
}

export function resetHoverRestPinForTests(): void {
  hoverRestOn = undefined
}
