import { createStore, type Store } from '../../state/store.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'

const compactWarningStoreBySession = new RootSessionSlot<Store<boolean>>(() =>
  createStore<boolean>(false),
)

function getCompactWarningStore(): Store<boolean> {
  return compactWarningStoreBySession.of(getBootstrapSession())
}

/**
 * Tracks whether the "context left until autocompact" warning should be suppressed.
 * We suppress immediately after successful compaction since we don't have accurate
 * token counts until the next API response.
 * Scoped per root session via RootSessionSlot.
 */
export const compactWarningStore: Store<boolean> = {
  getSnapshot: () =>
    compactWarningStoreBySession.peek(getBootstrapSession())?.getSnapshot() ??
    false,
  getState: () =>
    compactWarningStoreBySession.peek(getBootstrapSession())?.getState() ??
    false,
  setState: updater => {
    getCompactWarningStore().setState(updater)
  },
  subscribe: listener => getCompactWarningStore().subscribe(listener),
}

/** Suppress the compact warning. Call after successful compaction. */
export function suppressCompactWarning(): void {
  compactWarningStore.setState(() => true)
}

/** Clear the compact warning suppression. Called at start of new compact attempt. */
export function clearCompactWarningSuppression(): void {
  compactWarningStore.setState(() => false)
}
