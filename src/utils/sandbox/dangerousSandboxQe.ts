/**
 * densable 2.1.251 #66 — VU `qe` / `so` / `ro` / `he` / `oo` / `no`.
 * Gold: docs/upstream-extraction/v2.1.251/snippets/gold-251-f.md
 *
 * Server-managed sandbox weakening keys (TLS terminate, proxy ports,
 * credentials inject, weaker isolation) enter the dangerous sandboxSettings
 * bag when `so` says the value is set. Pure helpers only — Zor / VU callers
 * live outside this module.
 */

/** densable qe — exact order from SEA */
export const DANGEROUS_SANDBOX_QE_KEYS = [
  'allowAppleEvents',
  'credentials',
  'enableWeakerNestedSandbox',
  'enableWeakerNetworkIsolation',
  'filesystem.disabled',
  'network.allowAllUnixSockets',
  'network.allowMachLookup',
  'network.allowUnixSockets',
  'network.httpProxyPort',
  'network.socksProxyPort',
  'network.tlsTerminate',
] as const

export type DangerousSandboxQeKey = (typeof DANGEROUS_SANDBOX_QE_KEYS)[number]

/**
 * densable no — qe keys that also attach `network.allowedDomains` on the
 * projected sandboxSettings value.
 */
export const SANDBOX_QE_ALLOWED_DOMAINS_KEYS = new Set<string>([
  'credentials',
  'network.tlsTerminate',
])

/**
 * densable he — read nested field by dotted path under sandbox object.
 */
export function getSandboxNestedValue(
  sandbox: Record<string, unknown> | null | undefined,
  path: string,
): unknown {
  if (sandbox === null || sandbox === undefined) return undefined
  let cur: unknown = sandbox
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * densable oo — unique string domains, sorted; non-array → undefined.
 * SEA uses `te` (uniq) then `.sort()`.
 */
export function sandboxAllowedDomainsProjection(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((t): t is string => typeof t === 'string')
  return [...new Set(strings)].sort()
}

/**
 * densable ro — credentials are "deny-only" (not dangerous for approval):
 * files/envVars every entry mode==="deny"; sigv4 values undefined|"deny";
 * allowPlaintextInject === false; unknown keys fail the every() → not deny-only.
 */
export function isSandboxCredentialsDenyOnly(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value as Record<string, unknown>).every(
    ([key, entry]) => {
      if (entry === undefined) return true
      if (key === 'files' || key === 'envVars') {
        return (
          Array.isArray(entry) &&
          entry.every(
            item =>
              typeof item === 'object' &&
              item !== null &&
              (item as { mode?: unknown }).mode === 'deny',
          )
        )
      }
      if (key === 'sigv4') {
        return (
          typeof entry === 'object' &&
          entry !== null &&
          Object.values(entry as Record<string, unknown>).every(
            v => v === undefined || v === 'deny',
          )
        )
      }
      return key === 'allowPlaintextInject' && entry === false
    },
  )
}

/**
 * densable so — qe value counts as set for hash/approval.
 * false for undefined / null / false / empty array;
 * credentials + ro(deny-only) → false.
 */
export function isDangerousSandboxQeValueSet(
  key: string,
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === false) return false
  if (Array.isArray(value) && value.length === 0) return false
  return !(key === 'credentials' && isSandboxCredentialsDenyOnly(value))
}

/**
 * densable VU loop body (sandbox branch only): for each qe key with so(key,value),
 * emit `sandbox.${key}` → stable payload `{value, enabled?, enabledPlatforms?, allowedDomains?}`.
 * Caller supplies JSON stringify / hash bag shape (re = sorted JSON in SEA).
 */
export function projectDangerousSandboxQeSettings(
  sandbox: Record<string, unknown> | null | undefined,
): Record<
  string,
  {
    value: unknown
    enabled?: unknown
    enabledPlatforms?: unknown
    allowedDomains?: string[]
  }
> {
  if (sandbox === null || typeof sandbox !== 'object') return {}
  const enabled = getSandboxNestedValue(sandbox, 'enabled')
  const enabledPlatforms = getSandboxNestedValue(sandbox, 'enabledPlatforms')
  const allowedDomains = sandboxAllowedDomainsProjection(
    getSandboxNestedValue(sandbox, 'network.allowedDomains'),
  )
  const out: Record<
    string,
    {
      value: unknown
      enabled?: unknown
      enabledPlatforms?: unknown
      allowedDomains?: string[]
    }
  > = {}
  for (const key of DANGEROUS_SANDBOX_QE_KEYS) {
    const value = getSandboxNestedValue(sandbox, key)
    if (!isDangerousSandboxQeValueSet(key, value)) continue
    const entry: {
      value: unknown
      enabled?: unknown
      enabledPlatforms?: unknown
      allowedDomains?: string[]
    } = { value }
    if (enabled !== undefined) entry.enabled = enabled
    if (enabledPlatforms !== undefined)
      entry.enabledPlatforms = enabledPlatforms
    if (
      SANDBOX_QE_ALLOWED_DOMAINS_KEYS.has(key) &&
      allowedDomains !== undefined
    ) {
      entry.allowedDomains = allowedDomains
    }
    out[`sandbox.${key}`] = entry
  }
  return out
}
