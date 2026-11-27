/**
 * Typed host-adapter bridge between `@anthropic/ink` and the host application
 * (`src/`). Eliminates upward relative `require()` calls into `src/` inside
 * `@ant/ink` while preserving safe standalone defaults when unregistered.
 */

export type InkSessionObject = {
  host: object
  root?: object
}

export type InkSessionRootAdapter = {
  getBootstrapSession: () => InkSessionObject
  hasActiveSessionAls: () => boolean
  getActiveSessionFromAls: () => object | undefined
  runWithSession: <T>(session: object, fn: () => T) => T
}

export type InkHostAdapter = {
  sessionRoot?: InkSessionRootAdapter
  getFeatureFlag?: <T>(name: string, defaultValue: T) => T
  isScreenReaderModeEnabled?: () => boolean
  isTmuxControlMode?: () => boolean
}

let registeredAdapter: InkHostAdapter = {}
let adapterGeneration = 0

/**
 * Register (or merge) host adapter callbacks for `@anthropic/ink`.
 * Partial registrations merge cleanly so `sessionRoot` can register at leaf
 * module init without loading React/Yoga, while `init` / `inkRoot` wire the
 * remaining GrowthBook / screen-reader / fullscreen hooks.
 */
export function registerInkHostAdapter(adapter: InkHostAdapter): void {
  registeredAdapter = { ...registeredAdapter, ...adapter }
  adapterGeneration++
}

export function getInkHostAdapter(): Readonly<InkHostAdapter> {
  return registeredAdapter
}

/**
 * Monotonic generation counter incremented whenever `registerInkHostAdapter`
 * or `resetInkHostAdapterForTests` mutates the registered adapter. Callers
 * that memoize adapter-backed feature flags (e.g. `terminal.ts`) compare
 * against this generation so late registration immediately invalidates any
 * pre-registration fallback value.
 */
export function getInkHostAdapterGeneration(): number {
  return adapterGeneration
}

/** Test-only helper to replace or reset the registered host adapter. */
export function resetInkHostAdapterForTests(
  next: InkHostAdapter = {},
): InkHostAdapter {
  const prev = registeredAdapter
  registeredAdapter = { ...next }
  adapterGeneration++
  return prev
}
