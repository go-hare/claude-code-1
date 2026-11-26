/**
 * In-memory singleton that tracks cache hit-rate state for the current session.
 *
 * Call `onResponse(usage)` every time a new API response arrives.
 * The singleton compares the token signature of the new response against the
 * previously seen signature.  When it changes (= a new API call completed),
 * it resets `lastResetAt` to Date.now() and asynchronously persists state so
 * that a future session can show the TTL countdown immediately on startup.
 */

import type { CacheUsage, CacheStatsState } from './cacheStats.js'
import {
  computeHitRate,
  tokenSignature,
  getStateFilePath,
  readState,
  writeStateAtomic,
} from './cacheStats.js'
import { RootSessionSlot } from './hostSlot.js'
import { getBootstrapSession } from './sessionRoot.js'

interface MemState {
  signature: string | null
  lastResetAt: number | null
  lastHitRate: number | null
}

type CacheStatsSessionState = {
  memState: MemState
  sessionId: string | null
}

const cacheStatsSessionSlot = new RootSessionSlot<CacheStatsSessionState>(
  () => ({
    memState: {
      signature: null,
      lastResetAt: null,
      lastHitRate: null,
    },
    sessionId: null,
  }),
)

function getCacheStatsSessionState(): CacheStatsSessionState {
  return cacheStatsSessionSlot.of(getBootstrapSession())
}

/**
 * Must be called once at session start so the singleton knows which state file
 * to persist to and can pre-load the last known state.
 */
export async function initCacheStatsState(sid: string): Promise<void> {
  const state = getCacheStatsSessionState()
  state.sessionId = sid
  const filePath = getStateFilePath(sid)
  const persisted = await readState(filePath)
  // Pre-load persisted values so the UI can show fallback immediately
  state.memState = {
    signature: persisted.signature,
    lastResetAt: persisted.lastResetAt,
    lastHitRate: persisted.lastHitRate,
  }
}

/**
 * Called whenever a new assistant response is received with usage data.
 * Returns the updated in-memory state.
 */
export function onResponse(usage: CacheUsage): MemState {
  const state = getCacheStatsSessionState()
  const sig = tokenSignature(usage)
  const hitRate = computeHitRate(usage)

  if (sig !== state.memState.signature) {
    // New API response — reset the TTL clock
    state.memState = {
      signature: sig,
      lastResetAt: Date.now(),
      lastHitRate: hitRate,
    }
    // Persist asynchronously; intentionally fire-and-forget
    if (state.sessionId !== null) {
      const filePath = getStateFilePath(state.sessionId)
      const toWrite: CacheStatsState = {
        version: 1,
        signature: sig,
        lastResetAt: state.memState.lastResetAt,
        lastHitRate: hitRate,
      }
      void writeStateAtomic(filePath, toWrite)
    }
  }

  return { ...state.memState }
}

/** Read current in-memory state without triggering a response update. */
export function getCacheStatsState(): MemState {
  return { ...getCacheStatsSessionState().memState }
}

/**
 * Reset singleton — used in tests to isolate test runs.
 */
export function _resetCacheStatsStateForTest(): void {
  const state = getCacheStatsSessionState()
  state.memState = { signature: null, lastResetAt: null, lastHitRate: null }
  state.sessionId = null
}
