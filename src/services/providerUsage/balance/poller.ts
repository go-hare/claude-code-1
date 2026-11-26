import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../../../utils/sessionHost.js'
import { setProviderBalance } from '../store.js'
import { deepseekBalanceProvider } from './deepseek.js'
import { genericBalanceProvider } from './generic.js'
import type { BalanceProvider } from './types.js'

const DEFAULT_INTERVAL_MIN = 10

// Registration order = priority. First enabled wins. Generic (user-supplied
// URL) comes first so operators can override the built-in DeepSeek detection.
const PROVIDERS: BalanceProvider[] = [
  genericBalanceProvider,
  deepseekBalanceProvider,
]

function selectProvider(): BalanceProvider | null {
  if (process.env.CLAUDE_CODE_BALANCE_PROVIDER === 'none') return null
  return PROVIDERS.find(p => p.isEnabled()) ?? null
}

function intervalMs(): number {
  const raw = process.env.CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES
  const n = raw ? Number(raw) : DEFAULT_INTERVAL_MIN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MIN * 60_000
  return Math.floor(n * 60_000)
}

type BalancePollerState = {
  timer: ReturnType<typeof setInterval> | null
  inflight: AbortController | null
  active: BalanceProvider | null
  unregisterCleanup: (() => void) | null
}

const balancePollerHostSlot = new HostSlot<BalancePollerState>(() => ({
  timer: null,
  inflight: null,
  active: null,
  unregisterCleanup: null,
}))

function getBalancePollerState(): BalancePollerState {
  return balancePollerHostSlot.of(getBootstrapSessionHost())
}

const FETCH_TIMEOUT_MS = 10_000

async function tick(state: BalancePollerState): Promise<void> {
  const provider = state.active
  if (!provider) return
  state.inflight?.abort()
  const controller = new AbortController()
  state.inflight = controller
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const balance = await provider.fetchBalance(controller.signal)
    if (state.active === provider) {
      setProviderBalance(provider.providerId, balance)
    }
  } catch {
    // Never bubble into the host process.
  } finally {
    clearTimeout(timeout)
    if (state.inflight === controller) {
      state.inflight = null
    }
  }
}

function stopBalancePollingForState(state: BalancePollerState): void {
  if (state.timer !== null) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.inflight?.abort()
  state.inflight = null
  state.active = null
  const unregister = state.unregisterCleanup
  state.unregisterCleanup = null
  unregister?.()
}

/** Start polling if a provider is configured. Idempotent. */
export function startBalancePolling(): void {
  const state = getBalancePollerState()
  if (state.timer !== null) return
  state.active = selectProvider()
  if (!state.active) return
  const capturedSession = getActiveSessionFromAls()
  const sessionRef = capturedSession
    ? new WeakRef(capturedSession.root)
    : undefined
  const runTick = () => {
    if (sessionRef !== undefined) {
      const liveSession = sessionRef.deref()
      if (liveSession === undefined) {
        stopBalancePollingForState(state)
        return
      }
      if (getActiveSessionFromAls() !== liveSession) {
        runWithSession(liveSession, () => {
          void tick(state)
        })
        return
      }
    }
    void tick(state)
  }
  // Kick off immediately, then on interval.
  void tick(state)
  state.timer = setInterval(runTick, intervalMs())
  // Don't keep the event loop alive just for the poller.
  if (
    typeof (state.timer as unknown as { unref?: () => void }).unref ===
    'function'
  ) {
    ;(state.timer as unknown as { unref: () => void }).unref()
  }
  state.unregisterCleanup = registerCleanup(() => {
    stopBalancePollingForState(state)
  })
}

export function stopBalancePolling(): void {
  stopBalancePollingForState(getBalancePollerState())
}

export function getActiveBalanceProviderId(): string | null {
  return getBalancePollerState().active?.providerId ?? null
}
