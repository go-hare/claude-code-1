/**
 * densable iay marker-index selection (pure).
 *
 * densable pins:
 *   1. Primary: last cacheable message; if skipCacheWrite, one cacheable back.
 *   2. When basalt_spur (krr): optionally pin a fork-point / previous marker.
 *      - with forkPointUuid: pin at (or before) that uuid, scarp may step back
 *        when skipCacheWrite && forkIdx === primary
 *      - without forkPointUuid and !skipCacheWrite: pin previous cacheable
 *
 * Local messages lack densable `api_system`; callers pass isCacheable that
 * mirrors densable `i` (assistant last block not thinking/redacted/connector).
 */

export type CacheBreakpointSourceMessage = {
  type: string
  uuid?: string
}

export type ComputeCacheBreakpointMarkersArgs = {
  messages: CacheBreakpointSourceMessage[]
  skipCacheWrite: boolean
  basaltSpur: boolean
  basaltScarp: boolean
  forkPointUuid?: string
  isCacheable: (message: CacheBreakpointSourceMessage, index: number) => boolean
}

export type CacheBreakpointMarkers = {
  markers: Set<number>
  forkPointPinned: boolean
  primaryIndex: number
}

export function findLastCacheableIndex(
  messages: CacheBreakpointSourceMessage[],
  from: number,
  isCacheable: (message: CacheBreakpointSourceMessage, index: number) => boolean,
): number {
  let i = from
  while (i >= 0 && !isCacheable(messages[i]!, i)) i--
  return i
}

export function computeCacheBreakpointMarkers(
  args: ComputeCacheBreakpointMarkersArgs,
): CacheBreakpointMarkers {
  const {
    messages,
    skipCacheWrite,
    basaltSpur,
    basaltScarp,
    forkPointUuid,
    isCacheable,
  } = args

  let primary = findLastCacheableIndex(
    messages,
    messages.length - 1,
    isCacheable,
  )
  if (skipCacheWrite) {
    primary = findLastCacheableIndex(messages, primary - 1, isCacheable)
  }

  const markers = new Set<number>()
  if (primary >= 0) markers.add(primary)

  let forkPointPinned = false
  // densable: if (krr()) { if (forkUuid) pin; else if (!skipCacheWrite) pin prev }
  if (basaltSpur) {
    if (forkPointUuid) {
      let forkIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.uuid === forkPointUuid) {
          forkIdx = i
          break
        }
      }
      if (forkIdx >= 0 && forkIdx <= primary) {
        let pinIdx: number
        if (skipCacheWrite && forkIdx === primary && basaltScarp) {
          pinIdx = findLastCacheableIndex(messages, forkIdx - 1, isCacheable)
        } else if (isCacheable(messages[forkIdx]!, forkIdx)) {
          pinIdx = forkIdx
        } else {
          pinIdx = findLastCacheableIndex(messages, forkIdx - 1, isCacheable)
        }
        if (pinIdx >= 0) {
          markers.add(pinIdx)
          forkPointPinned = true
        }
      }
    } else if (!skipCacheWrite) {
      const prev = findLastCacheableIndex(messages, primary - 1, isCacheable)
      if (prev >= 0) {
        markers.add(prev)
        forkPointPinned = true
      }
    }
  }

  return { markers, forkPointPinned, primaryIndex: primary }
}

/**
 * densable Bio / forkPointUuidOf — uuid of the last message, collapsing
 * trailing multi-block assistant rows that share the same message.id.
 */
export function forkPointUuidOf(
  messages: Array<{ type: string; uuid?: string; message?: { id?: string } }>,
): string | undefined {
  if (messages.length === 0) return undefined
  let t = messages.length - 1
  const last = messages[t]
  if (last?.type === 'assistant') {
    const id = last.message?.id
    if (id) {
      while (t > 0) {
        const prev = messages[t - 1]
        if (prev?.type !== 'assistant' || prev.message?.id !== id) break
        t--
      }
    }
  }
  return messages[t]?.uuid
}
