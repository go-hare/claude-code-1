/**
 * densable Qre pool resolution — POe + wqr (2.1.212).
 *
 * wqr(id) is stubbed `return !1` in densable 212: no environment id is treated
 * as a "trusted self-hosted pool" that skips Nye env-list. The branch still
 * exists so callers/tests can align 1:1; product behavior is identical to
 * always-false until densable un-stubs it.
 *
 * POe walks settings sources high→low for remote.defaultEnvironmentId. When
 * wqr(id) is true and the source is NOT in the trusted-source allowlist
 * (policy/flag/user), that hit is recorded as ignoredUntrustedPool and the
 * walk continues. First trusted (or non-wqr) hit wins.
 */
import { SETTING_SOURCES, type SettingSource } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'

/** densable rOg — sources allowed to place a wqr-trusted pool default. */
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
 * densable `wqr(e){return!1}` — pool-trust helper.
 * Always false in 2.1.212; kept as a named function for 1:1 call sites.
 */
export function isTrustedPoolEnvironment(
  _environmentId: string | undefined,
): boolean {
  return false
}

/**
 * densable `POe()` — resolve default environment/pool id from settings sources.
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
