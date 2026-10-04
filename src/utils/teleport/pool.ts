/**
 * densable 2.1.283 I4 + H4 + AIt (was Qre/POe/wqr in 2.1.212).
 *
 * I4(id) is `startsWith("ccpool_")` — a self-hosted environment id. CreateSession
 * then sends `{self_hosted_runner_pool_id}` instead of `{environment_id}`.
 *
 * H4 walks settings sources high→low for remote.defaultEnvironmentId. When
 * I4(id) is true and the source is NOT in the trusted-source allowlist
 * (policy/flag/user), that hit is recorded as ignoredUntrustedPool and the
 * walk continues. First trusted (or non-I4) hit wins.
 */
import { SETTING_SOURCES, type SettingSource } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'

/** densable rOg — sources allowed to place an I4-trusted pool default. */
const TRUSTED_POOL_SETTING_SOURCES: readonly SettingSource[] = [
  'policySettings',
  'flagSettings',
  'userSettings',
]

export type PoolResolution = {
  id: string | undefined
  source: SettingSource | undefined
  ignoredUntrustedPool: { id: string; source: SettingSource } | undefined
}

/**
 * densable `I4(e){return e!==void 0&&e.startsWith("ccpool_")}`
 */
export function isSelfHostedEnvironmentId(
  environmentId: string | undefined,
): environmentId is string {
  return environmentId !== undefined && environmentId.startsWith('ccpool_')
}

/**
 * densable `wqr` / `I4` — pool-trust helper used by H4 and teleport env-select.
 */
export function isTrustedPoolEnvironment(
  environmentId: string | undefined,
): boolean {
  return isSelfHostedEnvironmentId(environmentId)
}

/**
 * densable `AIt(e)` — CreateSession worker field for an environment id.
 */
export function sessionCreateEnvironmentFields(
  environmentId: string,
): { self_hosted_runner_pool_id: string } | { environment_id: string } {
  return environmentId.startsWith('ccpool_')
    ? { self_hosted_runner_pool_id: environmentId }
    : { environment_id: environmentId }
}

/**
 * densable `H4()` / `POe()` — resolve default environment/pool id from settings.
 */
export function resolveDefaultPoolEnvironment(): PoolResolution {
  let ignoredUntrusted: { id: string; source: SettingSource } | undefined

  // SETTING_SOURCES is low→high merge order; densable PT() walks high→low.
  for (let i = SETTING_SOURCES.length - 1; i >= 0; i--) {
    const source = SETTING_SOURCES[i]
    if (!source) continue
    const id = getSettingsForSource(source)?.remote?.defaultEnvironmentId
    if (id === undefined) continue

    if (
      isTrustedPoolEnvironment(id) &&
      !TRUSTED_POOL_SETTING_SOURCES.includes(source)
    ) {
      ignoredUntrusted ??= { id, source }
      continue
    }

    return {
      id,
      source,
      ignoredUntrustedPool:
        ignoredUntrusted?.id === id ? undefined : ignoredUntrusted,
    }
  }

  return {
    id: undefined,
    source: undefined,
    ignoredUntrustedPool: ignoredUntrusted,
  }
}
