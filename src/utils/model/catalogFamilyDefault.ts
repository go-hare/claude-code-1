import { CANONICAL_ID_TO_KEY, type CanonicalModelId } from './configs.js'
import { DENSABLE_EHL_CATALOG } from './densableEhlCatalog.219.js'
import type { ModelStrings } from './modelStrings.js'
import type { APIProvider } from './providers.js'

/**
 * Official fWb — getAPIProvider() → catalog aliases.per_provider key.
 * openai/gemini/grok are not in official fWb; QHu then uses alias.default.
 */
const CATALOG_PROVIDER_KEY: Partial<Record<APIProvider, string>> = {
  firstParty: 'first_party',
  bedrock: 'bedrock',
  vertex: 'vertex',
  foundry: 'foundry',
  anthropicAws: 'anthropic_aws',
  mantle: 'mantle',
  gateway: 'gateway',
}

/**
 * Official QHu(alias, catalogProvider) — per_provider[key] ?? default.
 */
function resolveCatalogAliasId(
  alias: string,
  catalogProvider: string | undefined,
): string | undefined {
  const aliases = DENSABLE_EHL_CATALOG.aliases as Record<
    string,
    { default: string; per_provider?: Record<string, string> }
  >
  const entry = Object.hasOwn(aliases, alias) ? aliases[alias] : undefined
  if (!entry) return undefined
  const per = entry.per_provider
  if (catalogProvider && per && Object.hasOwn(per, catalogProvider)) {
    return per[catalogProvider]
  }
  return entry.default
}

/**
 * Official SZo(alias, modelStrings, provider=ao()):
 *   catalog id → ZA(id).provider_ids.first_party → ZOe → modelStrings[key]
 */
export function resolveCatalogFamilyModelString(
  alias: string,
  strings: ModelStrings,
  provider: APIProvider,
): string | undefined {
  const catalogId = resolveCatalogAliasId(alias, CATALOG_PROVIDER_KEY[provider])
  if (catalogId === undefined) return undefined
  const model = DENSABLE_EHL_CATALOG.models.find(m => m.id === catalogId)
  const firstParty = model?.provider_ids.first_party
  if (firstParty === undefined) return undefined
  const key = CANONICAL_ID_TO_KEY[firstParty as CanonicalModelId]
  if (key === undefined) return undefined
  return strings[key]
}
