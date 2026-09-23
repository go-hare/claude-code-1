import { is1mContextDisabled } from '../context.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import {
  getDensableCatalogModel,
  resolveCatalogIdFromProviderId,
  type DensableCatalogModel,
} from './modelCatalogCapabilities.js'
import {
  firstPartyNameToCanonical,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getUserSpecifiedModelSetting,
} from './model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
  type APIProvider,
} from './providers.js'

const MYTHOS_PREVIEW_ID = 'claude-mythos-preview'

function strip1mSuffix(model: string): string {
  return model.replace(/\[1m\]/gi, '')
}

function catalogModelFor(model: string): DensableCatalogModel | undefined {
  const stripped = strip1mSuffix(model).trim()
  const direct =
    getDensableCatalogModel(stripped) ??
    getDensableCatalogModel(firstPartyNameToCanonical(stripped))
  if (direct !== undefined) return direct
  const viaProvider = resolveCatalogIdFromProviderId(stripped)
  if (viaProvider === undefined) return undefined
  return getDensableCatalogModel(viaProvider)
}

/** densable `fn` + `Xe` — catalog id when one exists, else the stripped id. */
function catalogIdFor(model: string): string {
  return catalogModelFor(model)?.id ?? strip1mSuffix(model).trim()
}

/** densable `yw` — catalog native_1m, or the mythos preview id. */
function modelIdHasNative1m(model: string): boolean {
  const id = catalogIdFor(model)
  const entry = getDensableCatalogModel(id) ?? catalogModelFor(model)
  return entry?.context?.native_1m === true || id === MYTHOS_PREVIEW_ID
}

/** densable `Rw` — id that yw accepts, else undefined. */
function resolveNative1mModelId(model: string): string | undefined {
  const stripped = catalogIdFor(model)
  if (modelIdHasNative1m(stripped)) return stripped
  if (stripped === model) return undefined
  if (modelIdHasNative1m(model)) return catalogIdFor(model)
  return undefined
}

/** densable `O3`. */
export function providerNative1mContextEnabled(
  provider: APIProvider,
  context: DensableCatalogModel['context'] | undefined,
): boolean {
  const flags = context?.native_1m_3p
  switch (provider) {
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return flags?.[provider] === true
    case 'gateway':
      return (
        flags?.bedrock === true &&
        flags?.vertex === true &&
        flags?.foundry === true
      )
    default:
      return false
  }
}

/**
 * densable `ky` — the resolved model already has a native 1M window, so the
 * "[1m] / 5x more context" tip must stay hidden.
 * firstParty requires the first-party API host (`jo`). anthropicAws and
 * mantle count as native. Other providers use native_1m_3p (`O3`).
 */
export function resolvedModelHasNative1mWindow(model: string): boolean {
  if (is1mContextDisabled()) return false
  const resolved = resolveNative1mModelId(model)
  if (resolved === undefined) return false
  const context = catalogModelFor(resolved)?.context
  const provider = getAPIProvider()
  if (
    (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()) ||
    provider === 'anthropicAws' ||
    provider === 'mantle'
  ) {
    return true
  }
  return providerNative1mContextEnabled(provider, context)
}

// @[MODEL LAUNCH]: Add a branch for the new model if it supports a 1M context upgrade path.
/**
 * Get available model upgrade for more context.
 * densable `n` — setting is opus/sonnet, the 1M access check passes, and
 * ky(resolved default) is false.
 */
function getAvailableUpgrade(): {
  alias: string
  name: string
  multiplier: number
} | null {
  const currentModelSetting = getUserSpecifiedModelSetting()
  if (
    currentModelSetting === 'opus' &&
    checkOpus1mAccess() &&
    !resolvedModelHasNative1mWindow(getDefaultOpusModel())
  ) {
    return {
      alias: 'opus[1m]',
      name: 'Opus 1M',
      multiplier: 5,
    }
  } else if (
    currentModelSetting === 'sonnet' &&
    checkSonnet1mAccess() &&
    !resolvedModelHasNative1mWindow(getDefaultSonnetModel())
  ) {
    return {
      alias: 'sonnet[1m]',
      name: 'Sonnet 1M',
      multiplier: 5,
    }
  }

  return null
}

/**
 * Get upgrade message for different contexts
 */
export function getUpgradeMessage(context: 'warning' | 'tip'): string | null {
  const upgrade = getAvailableUpgrade()
  if (!upgrade) return null

  switch (context) {
    case 'warning':
      return `/model ${upgrade.alias}`
    case 'tip':
      return `Tip: You have access to ${upgrade.name} with ${upgrade.multiplier}x more context`
    default:
      return null
  }
}
