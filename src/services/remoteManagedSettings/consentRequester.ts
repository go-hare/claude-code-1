/**
 * densable J2m / X2m / cMl / Cqw / Z2m (SEA offs≈315331000).
 *
 * REPL registers a requester so managed-settings consent reuses the same Ink
 * surface instead of opening a second standalone render (236 #11).
 */
import { Stream } from '../../utils/stream.js'
import { withTimeout } from '../../utils/sleep.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { logEvent } from '../analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'

export type ManagedSettingsConsentResult =
  | 'approved'
  | 'rejected'
  | 'deferred_no_consent_surface'
  | 'superseded'

/** densable requester: (settings, updates Stream) → consent result */
export type ManagedSettingsRequester = (
  settings: SettingsJson,
  updates: Stream<SettingsJson>,
) => Promise<ManagedSettingsConsentResult>

/** densable Tqw */
export const MANAGED_SETTINGS_REQUESTER_WAIT_MS = 5000

/** densable Cqw timeout message */
export const MANAGED_SETTINGS_REQUESTER_WAIT_TIMEOUT =
  'managed-settings security dialog requester wait timed out'

/**
 * densable X2m — pending review owner + settings update stream for supersede.
 */
class PendingReview {
  updates = new Stream<SettingsJson>()
  owner: (result: ManagedSettingsConsentResult) => void

  constructor(owner: (result: ManagedSettingsConsentResult) => void) {
    this.owner = owner
  }

  supersede(
    settings: SettingsJson,
    nextOwner: (result: ManagedSettingsConsentResult) => void,
  ): void {
    const prev = this.owner
    this.owner = nextOwner
    this.updates.enqueue(settings)
    prev('superseded')
  }

  settle(result: ManagedSettingsConsentResult): void {
    this.updates.done()
    this.owner(result)
  }
}

/**
 * densable J2m — singleton consent surface registry.
 */
class ManagedSettingsConsentRegistry {
  replRequester: ManagedSettingsRequester | null = null
  requesterWaiters: Array<(requester: ManagedSettingsRequester) => void> = []
  pendingReview: PendingReview | null = null

  registerRequester(requester: ManagedSettingsRequester | null): void {
    this.replRequester = requester
    if (requester && this.requesterWaiters.length > 0) {
      const waiters = this.requesterWaiters
      this.requesterWaiters = []
      for (const waiter of waiters) {
        waiter(requester)
      }
    }
  }

  addWaiter(waiter: (requester: ManagedSettingsRequester) => void): void {
    this.requesterWaiters.push(waiter)
  }

  dropWaiter(waiter: (requester: ManagedSettingsRequester) => void): void {
    this.requesterWaiters = this.requesterWaiters.filter(w => w !== waiter)
  }

  review(
    requester: ManagedSettingsRequester,
    settings: SettingsJson,
  ): Promise<ManagedSettingsConsentResult> {
    return new Promise(resolve => {
      if (this.pendingReview) {
        this.pendingReview.supersede(settings, resolve)
        return
      }
      const pending = new PendingReview(resolve)
      this.pendingReview = pending
      logEvent('tengu_managed_settings_security_dialog_shown', {})
      let dialogPromise: Promise<ManagedSettingsConsentResult>
      try {
        dialogPromise = requester(settings, pending.updates)
      } catch {
        dialogPromise = Promise.resolve('deferred_no_consent_surface')
      }
      void dialogPromise.then(
        result => this.close(pending, result),
        () => this.close(pending, 'deferred_no_consent_surface'),
      )
    })
  }

  close(pending: PendingReview, result: ManagedSettingsConsentResult): void {
    this.pendingReview = null
    if (result === 'approved') {
      logEvent('tengu_managed_settings_security_dialog_accepted', {})
      logEvent('tengu_feature_ok', {
        feature_name:
          'remote_managed_settings_security_check' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (result === 'rejected') {
      logEvent('tengu_managed_settings_security_dialog_rejected', {})
    }
    pending.settle(result)
  }
}

const registry = new ManagedSettingsConsentRegistry()

/** densable lMl() */
export function getManagedSettingsConsentRegistry(): ManagedSettingsConsentRegistry {
  return registry
}

/** densable cMl(e) — REPL mount/unmount */
export function registerManagedSettingsRequester(
  requester: ManagedSettingsRequester | null,
): void {
  registry.registerRequester(requester)
}

/**
 * densable sXg cleanup helper — register and return disposer that clears.
 * Call site: REPL useEffect(() => register…, []).
 */
export function installManagedSettingsRequester(
  requester: ManagedSettingsRequester,
): () => void {
  registerManagedSettingsRequester(requester)
  return () => registerManagedSettingsRequester(null)
}

/** densable Cqw — wait up to 5s for REPL requester while Ink owns stdout */
export async function waitForManagedSettingsRequester(): Promise<ManagedSettingsRequester | null> {
  const reg = registry
  let resolveWaiter: ((requester: ManagedSettingsRequester) => void) | undefined
  const waitPromise = new Promise<ManagedSettingsRequester>(resolve => {
    resolveWaiter = resolve
    reg.addWaiter(resolve)
  })
  const result = await withTimeout(
    waitPromise,
    MANAGED_SETTINGS_REQUESTER_WAIT_MS,
    MANAGED_SETTINGS_REQUESTER_WAIT_TIMEOUT,
  ).catch(() => null)
  if (result === null && resolveWaiter) {
    reg.dropWaiter(resolveWaiter)
  }
  return result
}

/** Test helper */
export function resetManagedSettingsConsentRegistryForTests(): void {
  registry.replRequester = null
  registry.requesterWaiters = []
  registry.pendingReview = null
}
