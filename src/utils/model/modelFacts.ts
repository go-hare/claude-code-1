/**
 * densable 2.1.289 `zu` / `Tqe` — per-request model facts snapshot.
 *
 * Gold `zu` @188234335, wait-wrapper `Tqe` @195358988. Never export those
 * minify ids. `Syo` is the inflight leftoverQrr fetch map (not a second
 * client_data store).
 */

import { CONTEXT_1M_BETA_HEADER } from '../../constants/betas.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import {
  catalogDeclaresNative1mWindow,
  getContextWindowForModel,
  getModelMaxOutputTokens,
  has1mContext,
  isRecognizedModelForWindowEnforcement,
  modelSupports1M,
} from '../context.js'
import { modelClampsEffortWhenThinkingDisabled } from '../effortThinkingGuard.js'
import {
  modelRejectsDisabledThinking,
  modelSupportsThinking,
} from '../thinking.js'
import {
  getDensableCatalogModel,
  resolveCatalogIdFromProviderId,
} from './modelCatalogCapabilities.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { sleep } from '../sleep.js'
import { firstPartyNameToCanonical, getCanonicalName } from './model.js'

export type ClientDataAutoCompactWindow = {
  window: number | null
  replacesDefault: boolean
}

export type ModelFacts = {
  model: string
  contextWindow: number
  maxOutputTokens: number
  canonical: string
  settingsKey: string
  native1mHere: boolean
  native1mInCatalog: boolean
  optIn1mHonored: boolean
  unclampedButBilledPast200k: boolean
  recognized: boolean
  bytesPerToken: number
  clientDataAutoCompactWindow: ClientDataAutoCompactWindow
  thinking: {
    supported: boolean
    rejectsDisabled: boolean
    capsEffortWhenDisabled: boolean
  }
  acceptsTemperature: boolean
}

/** densable `UZn` @188233452 */
const UNCLAMPED_BUT_BILLED_PAST_200K = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
])

/** densable `ZI` @182054525 — 4 bytes/token families; else 3. */
const FOUR_BYTES_PER_TOKEN = new Set([
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
])

/**
 * densable `Sv` @182068533 — series order for `sr(canonical, "claude-opus-4-7")`.
 * `acceptsTemperature` is true for claude-3-* and anything strictly older
 * than opus-4-7 in this list.
 */
const TEMPERATURE_SERIES = [
  'claude-opus-4-0',
  'claude-sonnet-4-0',
  'claude-opus-4-1',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
]

function strip1mSuffix(model: string): string {
  return model.replace(/\[1m\]/gi, '').trim()
}

function settingsKeyFor(model: string): string {
  return getCanonicalName(strip1mSuffix(model)).replace(/[._]/g, '-')
}

function bytesPerTokenFor(model: string): number {
  if (!model) return 4
  const key = settingsKeyFor(model)
  return FOUR_BYTES_PER_TOKEN.has(key) ? 4 : 3
}

/** densable `hv` / `P9r` — catalog native_1m, ignoring DISABLE_1M. */
function catalogHasNative1m(model: string): boolean {
  const stripped = strip1mSuffix(model)
  const entry =
    getDensableCatalogModel(stripped) ??
    getDensableCatalogModel(firstPartyNameToCanonical(stripped)) ??
    (() => {
      const via = resolveCatalogIdFromProviderId(stripped)
      return via ? getDensableCatalogModel(via) : undefined
    })()
  return (
    entry?.context?.native_1m === true || stripped === 'claude-mythos-preview'
  )
}

function acceptsTemperatureFor(canonical: string): boolean {
  if (canonical.includes('claude-3-')) return true
  const index = TEMPERATURE_SERIES.indexOf(canonical)
  const opus47 = TEMPERATURE_SERIES.indexOf('claude-opus-4-7')
  return index !== -1 && index < opus47
}

function integerWindow(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nested = (value as { window?: unknown }).window
    if (typeof nested === 'number' && Number.isInteger(nested)) return nested
  }
  return null
}

function lookupCanonicalWindow(
  bag: unknown,
  canonical: string,
): { window: number | null; present: boolean } {
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
    return { window: null, present: false }
  }
  if (!Object.hasOwn(bag, canonical)) {
    return { window: null, present: false }
  }
  return {
    window: integerWindow((bag as Record<string, unknown>)[canonical]),
    present: true,
  }
}

/** densable `jZn` @188233963 — rowan_thicket then default client data. */
function clientDataAutoCompactWindowFor(
  canonical: string,
): ClientDataAutoCompactWindow {
  try {
    const { leftoverQrr } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../collapseReadSearch.js') as typeof import('../collapseReadSearch.js')
    const data = leftoverQrr()?.data
    if (data === null || data === undefined || typeof data !== 'object') {
      return { window: null, replacesDefault: false }
    }
    const record = data as Record<string, unknown>
    const fromThicket = lookupCanonicalWindow(record.rowan_thicket, canonical)
    const fromDefault = lookupCanonicalWindow(record, canonical)
    return {
      window: fromThicket.window ?? fromDefault.window,
      replacesDefault: fromDefault.present,
    }
  } catch {
    return { window: null, replacesDefault: false }
  }
}

/**
 * densable `zu` — sync snapshot. `betas` defaults to sdkBetas (`af()`).
 */
export function getModelFacts(
  model: string,
  betas: string[] | undefined = getSdkBetas(),
): ModelFacts {
  const canonical = getCanonicalName(model)
  const native1mInCatalog = catalogHasNative1m(model)
  return {
    model,
    contextWindow: getContextWindowForModel(model, betas),
    maxOutputTokens: getModelMaxOutputTokens(model).default,
    canonical,
    settingsKey: settingsKeyFor(model),
    native1mHere: catalogDeclaresNative1mWindow(model),
    native1mInCatalog,
    optIn1mHonored:
      has1mContext(model) ||
      (betas?.includes(CONTEXT_1M_BETA_HEADER) === true &&
        modelSupports1M(model)),
    unclampedButBilledPast200k: UNCLAMPED_BUT_BILLED_PAST_200K.has(canonical),
    recognized: isRecognizedModelForWindowEnforcement(model),
    bytesPerToken: bytesPerTokenFor(model),
    clientDataAutoCompactWindow: clientDataAutoCompactWindowFor(canonical),
    thinking: {
      supported: modelSupportsThinking(model),
      rejectsDisabled: modelRejectsDisabledThinking(model),
      capsEffortWhenDisabled: modelClampsEffortWhenThinkingDisabled(model),
    },
    acceptsTemperature: acceptsTemperatureFor(canonical),
  }
}

export type ResolveModelFactsContext = {
  storageV5?: unknown
  credentials?: unknown
  abortController?: { signal?: AbortSignal }
}

/**
 * densable `Syo` — inflight leftoverQrr fetch. Starts `fetchBootstrapData`
 * when the cache-key getter exists, fetchesClientData is on, firstParty, and
 * the timed slot is empty.
 */
export function getInFlightClientDataFetch(
  _ctx?: ResolveModelFactsContext,
): Promise<unknown> | undefined {
  try {
    const {
      leftoverQrrCacheKeyNow,
      leftoverQrrHasTimedSlot,
      fetchesClientDataEnabled,
      peekClientDataFetch,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../collapseReadSearch.js') as typeof import('../collapseReadSearch.js')
    const key = leftoverQrrCacheKeyNow()
    if (key === undefined || !fetchesClientDataEnabled()) return undefined
    const { getAPIProvider } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./providers.js') as typeof import('./providers.js')
    if (getAPIProvider() !== 'firstParty' || leftoverQrrHasTimedSlot()) {
      return undefined
    }
    const inflight = peekClientDataFetch(key)
    if (inflight !== undefined) {
      return inflight === 'over' ? undefined : inflight
    }
    const { fetchBootstrapData } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/api/bootstrap.js') as typeof import('../../services/api/bootstrap.js')
    return fetchBootstrapData()
  } catch {
    return undefined
  }
}

/**
 * densable `Tqe` — wait on in-flight client-data fetch when one exists, then
 * `zu`.
 */
export async function resolveModelFacts(
  model: string,
  ctx?: ResolveModelFactsContext,
  timeoutMs = 1500,
): Promise<ModelFacts> {
  try {
    const inflight = getInFlightClientDataFetch(ctx)
    if (
      inflight !== undefined &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_deep_shore', true)
    ) {
      await Promise.race([
        inflight.then(
          () => true,
          () => false,
        ),
        sleep(timeoutMs),
      ])
    }
  } catch {
    // gold Tqe swallows wait errors then still returns zu(e)
  }
  return getModelFacts(model)
}

/**
 * densable `Ase(request, fallback)` — fallback context window is smaller.
 */
export function isSmallerContextWindow(
  requestModel: string,
  fallbackModel: string,
  betas?: string[],
): boolean {
  return (
    getContextWindowForModel(fallbackModel, betas) <
    getContextWindowForModel(requestModel, betas)
  )
}

/** densable `$z` @181937293 — auto-mode sources skip prefetched facts reuse. */
export function querySourceSkipsModelFactsReuse(
  querySource: string | undefined,
): boolean {
  return querySource === 'auto_mode' || querySource === 'auto_mode_investigator'
}
