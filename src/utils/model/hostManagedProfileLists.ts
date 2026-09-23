/**
 * densable 2.1.251 #53 — host-flag empty returns for profile list
 * functions (bedrock S/F, vertex R/U, mantle B) and zje.
 *
 * Gold S/F/R/U/B return [] on CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST.
 * Gold zje returns undefined on that flag. Probe / upgrade APIs are
 * not invented here.
 */
import { isEnvTruthy } from '../envUtils.js'
import { getAPIProvider } from './providers.js'

function isHostManagedProviderFlag(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

/** densable S — bedrock upgrade list. */
export async function listBedrockUpgradeCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<never[]> {
  if (getAPIProvider() !== 'bedrock') return []
  if (isHostManagedProviderFlag(env)) return []
  return []
}

/** densable F — bedrock fallback list. */
export async function listBedrockFallbackCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<never[]> {
  if (getAPIProvider() !== 'bedrock') return []
  if (isHostManagedProviderFlag(env)) return []
  return []
}

/** densable R — vertex upgrade list. */
export async function listVertexUpgradeCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<never[]> {
  if (getAPIProvider() !== 'vertex') return []
  if (isHostManagedProviderFlag(env)) return []
  return []
}

/** densable U — vertex fallback list. */
export async function listVertexFallbackCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<never[]> {
  if (getAPIProvider() !== 'vertex') return []
  if (isHostManagedProviderFlag(env)) return []
  return []
}

/** densable B — mantle default/fallback list. */
export async function listMantleFallbackCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<never[]> {
  if (getAPIProvider() !== 'mantle') return []
  if (isHostManagedProviderFlag(env)) return []
  return []
}

/**
 * densable zje — host flag returns undefined, not [].
 * Empty / blank raw values are also undefined. The rest of gold zje
 * (tier map / modelOverrides) is not invented.
 */
export function readHostManagedAdminPin(
  raw: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  if (isHostManagedProviderFlag(env)) return undefined
  return trimmed
}
