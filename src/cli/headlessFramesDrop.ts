/**
 * densable 2.1.283 leftover gold `class st` @202335343 — peer-hold / drop-before-init.
 *
 * Gold fields: `peerHeldForInit=0;peerFramesDroppedBeforeInitCount=0;maxHeldForInit=0`
 * Gold `counts.peerFramesDroppedBeforeInit` aliases `peerFramesDroppedBeforeInitCount`.
 * Gold `emitAfterInit`: peer over `Is=200` increments drop-count and returns;
 * otherwise `peerHeldForInit+=1` and `maxHeldForInit=Math.max(...,heldForInit.length)`.
 */

/** gold `Is` — peer frames held for init before drop */
export const PEER_HELD_FOR_INIT_CAP = 200

export type HeadlessPeerInitBag = {
  peerFramesDroppedBeforeInitCount: number
  peerHeldForInit: number
  maxHeldForInit: number
}

export function createHeadlessPeerInitBag(): HeadlessPeerInitBag {
  return {
    peerFramesDroppedBeforeInitCount: 0,
    peerHeldForInit: 0,
    maxHeldForInit: 0,
  }
}

/**
 * gold `counts.peerFramesDroppedBeforeInit` — alias of
 * `peerFramesDroppedBeforeInitCount`.
 */
export function peerFramesDroppedBeforeInit(bag: HeadlessPeerInitBag): number {
  return bag.peerFramesDroppedBeforeInitCount
}

/**
 * gold `class st` emitAfterInit peer branch — count held vs dropped-before-init.
 */
export function notePeerFrameBeforeInit(
  bag: HeadlessPeerInitBag,
  opts: { holdingForInit: boolean; dropped: boolean; held: boolean },
): void {
  if (!opts.holdingForInit) return
  if (opts.held) {
    bag.peerHeldForInit += 1
    bag.maxHeldForInit = Math.max(bag.maxHeldForInit, bag.peerHeldForInit)
  }
  if (opts.dropped) {
    bag.peerFramesDroppedBeforeInitCount += 1
  }
}
