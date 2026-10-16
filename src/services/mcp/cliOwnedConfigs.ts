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

/** densable Bkn request bag `{method, body}`. */
export type CliOwnedRequestInfo = {
  method: string
  body?: unknown
}

export type CliOwnedRequestHeaderProvider = (
  request?: CliOwnedRequestInfo,
) => Record<string, string> | undefined

export type CliOwnedResponseInfo = {
  method: string
  status: number
  headers: Headers
  requestHeaders: { get: (name: string) => string | null }
  bearerFingerprint?: string | null
}

export type CliOwnedResponseObserver = (response: CliOwnedResponseInfo) => void

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

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

/**
 * densable `bOe(e)` — owned when sync OR async bearer provider is registered.
 */
export function isCliOwnedBearerConfig(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false
  const host = getCliOwnedRegistry()
  return (
    host.cliOwnedBearerProviders.has(config) ||
    host.cliOwnedAsyncBearerProviders.has(config)
  )
}

/**
 * densable `I(e)` — sync cli-owned bearer. Catch → null.
 */
export function resolveCliOwnedSyncBearerToken(config: unknown): string | null {
  if (typeof config !== 'object' || config === null) return null
  const provider = getCliOwnedRegistry().cliOwnedBearerProviders.get(config)
  if (!provider) return null
  try {
    return provider() || null
  } catch {
    return null
  }
}

/**
 * densable `Ukn(e)` — await async resolver; if none, fall back to `I(e)`.
 */
export async function resolveCliOwnedBearerToken(
  config: unknown,
): Promise<string | null> {
  if (typeof config !== 'object' || config === null) return null
  const asyncProvider =
    getCliOwnedRegistry().cliOwnedAsyncBearerProviders.get(config)
  if (!asyncProvider) return resolveCliOwnedSyncBearerToken(config)
  try {
    return (await asyncProvider()) || null
  } catch {
    return null
  }
}

/**
 * densable `Bkn(e,r)` — extra request headers except Authorization (Hr skips that).
 */
export function collectCliOwnedRequestHeaders(
  config: unknown,
  request: CliOwnedRequestInfo,
): Record<string, string> {
  if (typeof config !== 'object' || config === null) return {}
  const provider =
    getCliOwnedRegistry().cliOwnedRequestHeaderProviders.get(config)
  if (!provider) return {}
  try {
    return provider(request) ?? {}
  } catch {
    return {}
  }
}

/**
 * densable `jkn(e,r)` — response observer; swallow throws.
 */
export function notifyCliOwnedResponse(
  config: unknown,
  info: CliOwnedResponseInfo,
): void {
  if (typeof config !== 'object' || config === null) return
  const observer = getCliOwnedRegistry().cliOwnedResponseObservers.get(config)
  if (!observer) return
  try {
    observer(info)
  } catch {
    // gold jkn swallows
  }
}

/**
 * densable `Hr(e,r)` — per-request cli-owned header + async bearer wrap.
 * Gold: extra headers then `await Ukn(r)` when Authorization is missing.
 */
export function wrapCliOwnedFetch(inner: FetchLike, config: object): FetchLike {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    const extras = collectCliOwnedRequestHeaders(config, {
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body,
    })
    for (const [name, value] of Object.entries(extras)) {
      if (!headers.has(name) && name.toLowerCase() !== 'authorization') {
        headers.set(name, value)
      }
    }
    let bearerFingerprint: string | null = null
    if (!headers.has('Authorization')) {
      const token = await resolveCliOwnedBearerToken(config)
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
        bearerFingerprint = token
      }
    }
    const response = await inner(input, {
      ...init,
      headers,
      redirect: 'error',
    })
    notifyCliOwnedResponse(config, {
      method: (init?.method ?? 'GET').toUpperCase(),
      status: response.status,
      headers: response.headers,
      requestHeaders: {
        get: name =>
          name.toLowerCase() === 'authorization' ? null : headers.get(name),
      },
      bearerFingerprint,
    })
    return response
  }
}
