/**
 * densable 2.1.289 `OEe` / `nf` / `Kt().cliOwned*` slice — CLI-owned MCP
 * config registry for bridge hearthbot / meta / carrier / REMOTE rewrite.
 *
 * Gold host is densable `class h` via `Kt()`; we keep only the ownership
 * WeakSet + bearer/header/response maps (+ `ccrInjectedConfigs`). Do **not**
 * export minify `OEe` / `nf` / `Kt`.
 *
 * Callers: projects reply mount (`role:"comms"` + getBearerToken), server-config
 * meta mount, bridgeCarrierChild `Cet` rewrite, CLAUDE_CODE_REMOTE `nf?OEe`.
 */

export type CliOwnedBearerProvider = () => string | null | undefined

export type CliOwnedAsyncBearerProvider = () => Promise<
  string | null | undefined
>

export type CliOwnedResponseObserver = (response: unknown) => void

export type CliOwnedRequestHeaderProvider = () =>
  | Record<string, string>
  | undefined

export type MarkCliOwnedConfigOpts = {
  getBearerToken?: CliOwnedBearerProvider
  resolveBearerToken?: CliOwnedAsyncBearerProvider
  onResponse?: CliOwnedResponseObserver
  requestHeaders?: CliOwnedRequestHeaderProvider
}

type CliOwnedRegistry = {
  cliOwnedConfigs: WeakSet<object>
  cliOwnedBearerProviders: WeakMap<object, CliOwnedBearerProvider>
  cliOwnedAsyncBearerProviders: WeakMap<object, CliOwnedAsyncBearerProvider>
  cliOwnedResponseObservers: WeakMap<object, CliOwnedResponseObserver>
  cliOwnedRequestHeaderProviders: WeakMap<object, CliOwnedRequestHeaderProvider>
  ccrInjectedConfigs: WeakSet<object>
}

function createRegistry(): CliOwnedRegistry {
  return {
    cliOwnedConfigs: new WeakSet(),
    cliOwnedBearerProviders: new WeakMap(),
    cliOwnedAsyncBearerProviders: new WeakMap(),
    cliOwnedResponseObservers: new WeakMap(),
    cliOwnedRequestHeaderProviders: new WeakMap(),
    ccrInjectedConfigs: new WeakSet(),
  }
}

let registry = createRegistry()

/** densable `Kt()` ownership slice — module singleton. */
function getCliOwnedRegistry(): CliOwnedRegistry {
  return registry
}

/**
 * densable `OEe(e,r)` — register config as CLI-owned; optional bearer/header
 * providers. Returns the same object for chaining into pending MCP rows.
 */
export function markCliOwnedConfig<T extends object>(
  config: T,
  opts?: MarkCliOwnedConfigOpts,
): T {
  const host = getCliOwnedRegistry()
  host.cliOwnedConfigs.add(config)
  if (opts?.getBearerToken) {
    host.cliOwnedBearerProviders.set(config, opts.getBearerToken)
  }
  if (opts?.resolveBearerToken) {
    host.cliOwnedAsyncBearerProviders.set(config, opts.resolveBearerToken)
  }
  if (opts?.onResponse) {
    host.cliOwnedResponseObservers.set(config, opts.onResponse)
  }
  if (opts?.requestHeaders) {
    host.cliOwnedRequestHeaderProviders.set(config, opts.requestHeaders)
  }
  return config
}

/** densable `nf(e)` — config object is in `cliOwnedConfigs`. */
export function isCliOwnedConfig(config: unknown): config is object {
  return (
    typeof config === 'object' &&
    config !== null &&
    getCliOwnedRegistry().cliOwnedConfigs.has(config)
  )
}

export function getCliOwnedBearerProvider(
  config: object,
): CliOwnedBearerProvider | undefined {
  return getCliOwnedRegistry().cliOwnedBearerProviders.get(config)
}

export function getCliOwnedAsyncBearerProvider(
  config: object,
): CliOwnedAsyncBearerProvider | undefined {
  return getCliOwnedRegistry().cliOwnedAsyncBearerProviders.get(config)
}

export function getCliOwnedRequestHeaderProvider(
  config: object,
): CliOwnedRequestHeaderProvider | undefined {
  return getCliOwnedRegistry().cliOwnedRequestHeaderProviders.get(config)
}

export function getCliOwnedResponseObserver(
  config: object,
): CliOwnedResponseObserver | undefined {
  return getCliOwnedRegistry().cliOwnedResponseObservers.get(config)
}

/**
 * densable `mpn` — when CLAUDE_CODE_REMOTE + ENn shape, stamp ccrInjected.
 * Caller gates REMOTE + shape; this only adds to the set.
 */
export function markCcrInjectedConfig(config: object): void {
  getCliOwnedRegistry().ccrInjectedConfigs.add(config)
}

export function isCcrInjectedConfig(config: object): boolean {
  return getCliOwnedRegistry().ccrInjectedConfigs.has(config)
}

/** Tests only — rebuild WeakSet/Maps (cannot clear WeakSet). */
export function resetCliOwnedConfigsForTests(): void {
  registry = createRegistry()
}
