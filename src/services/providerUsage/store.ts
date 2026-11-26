import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionRoot.js'
import type {
  ProviderBalance,
  ProviderUsage,
  ProviderUsageBucket,
} from './types.js'

type Listener = (snapshot: ProviderUsage) => void

type ProviderUsageHostState = {
  current: ProviderUsage
  listeners: Set<Listener>
}

// Per-host provider usage store on SessionHost.
const providerUsageHostSlot = new HostSlot<ProviderUsageHostState>(() => ({
  current: {
    providerId: 'unknown',
    buckets: [],
  },
  listeners: new Set(),
}))

function getProviderUsageHostState(): ProviderUsageHostState {
  return providerUsageHostSlot.of(getBootstrapSessionHost())
}

export function getProviderUsage(): ProviderUsage {
  return getProviderUsageHostState().current
}

/**
 * Replace buckets for a provider. Passing an empty array is valid — it records
 * that the latest response carried no usable quota header.
 */
export function updateProviderBuckets(
  providerId: string,
  buckets: ProviderUsageBucket[],
): void {
  const state = getProviderUsageHostState()
  state.current = {
    ...state.current,
    providerId,
    buckets,
  }
  emit(state)
}

export function setProviderBalance(
  providerId: string,
  balance: ProviderBalance | null,
): void {
  const state = getProviderUsageHostState()
  state.current = {
    ...state.current,
    providerId,
    ...(balance === null ? { balance: undefined } : { balance }),
  }
  emit(state)
}

export function subscribeProviderUsage(listener: Listener): () => void {
  const { listeners } = getProviderUsageHostState()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetProviderUsage(): void {
  const state = getProviderUsageHostState()
  state.current = { providerId: 'unknown', buckets: [] }
  emit(state)
}

function emit(state: ProviderUsageHostState): void {
  for (const listener of state.listeners) {
    try {
      listener(state.current)
    } catch {
      // Listener errors must not break the publish loop.
    }
  }
}
