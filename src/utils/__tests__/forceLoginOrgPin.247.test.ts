/**
 * densable 2.1.247 J$ — `forceLoginOrgUUID` is an org *pin* that accepts either
 * a single UUID or a list, and any listed org satisfies it:
 *
 *   let o = typeof n === "string" ? [n] : n;
 *   if (o.length === 0) return { valid: false, message: "...empty array..." }
 *   let i = o.length === 1 ? `organization ${o[0]}` : `one of these organizations: ${o.join(", ")}`
 *   ...
 *   if (o.includes(d)) return { valid: true }
 *
 * We used to declare the setting as a bare string and compare with `===`, so an
 * array pin was rejected by schema validation before it could ever be honored.
 * validateForceLoginOrg needs live OAuth + a profile fetch, so the membership and
 * empty-array rules are asserted against the source; schema acceptance is covered
 * by config.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import {
  normalizeForceLoginOrgUuids,
  oauthLoginOrgUUIDHint,
} from '../forceLoginOrg.js'

async function authSrc(): Promise<string> {
  return await Bun.file(new URL('../auth.ts', import.meta.url)).text()
}

/**
 * The body of validateForceLoginOrg, with runs of whitespace collapsed so these
 * assertions survive Biome reflowing a ternary across lines.
 */
async function validateBody(): Promise<string> {
  const src = await authSrc()
  const start = src.indexOf('export async function validateForceLoginOrg')
  expect(start).toBeGreaterThan(0)
  const end = src.indexOf('\nclass ', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end).replace(/\s+/g, ' ')
}

describe('forceLoginOrgUUID pin (densable J$)', () => {
  test('normalizes a single UUID into the permitted list', async () => {
    const body = await validateBody()
    expect(body).toContain('normalizeForceLoginOrgUuids(configuredOrgUuid)')
    // `undefined` must be the only "unset" value: an empty array is a real,
    // deny-everything configuration and must not be treated as absent.
    expect(body).toContain('configuredOrgUuid === undefined')
  })

  test('an empty array denies rather than permits', async () => {
    const body = await validateBody()
    expect(body).toContain('permittedOrgUuids.length === 0')
    expect(body).toContain('is set to an empty array')
    const emptyAt = body.indexOf('permittedOrgUuids.length === 0')
    const validAt = body.indexOf('valid: false', emptyAt)
    expect(validAt).toBeGreaterThan(emptyAt)
  })

  test('membership is a list check, not string equality', async () => {
    const body = await validateBody()
    expect(body).toContain('permittedOrgUuids.includes(tokenOrgUuid)')
    // The old `tokenOrgUuid === requiredOrgUuid` compared a UUID against the
    // whole pin and would never match an array.
    expect(body).not.toContain('tokenOrgUuid === requiredOrgUuid')
  })

  test('the requirement phrase is singular or plural to match the pin', async () => {
    const body = await validateBody()
    expect(body).toContain('permittedOrgUuids.length === 1')
    expect(body).toContain('`organization ${permittedOrgUuids[0]}`')
    expect(body).toContain('one of these organizations:')
    // Every user-facing message must render through the phrase, otherwise an
    // array pin prints as a bare comma-joined blob.
    expect(body).not.toContain('organization ${requiredOrgUuid}')
  })

  test('branch order matches J$: host-managed, then ssh, then 3P, then policy', async () => {
    const body = await validateBody()
    const hostAt = body.indexOf('isHostManagedProviderAuth()')
    const sshAt = body.indexOf('process.env.ANTHROPIC_UNIX_SOCKET')
    const authAt = body.indexOf('if (!isAnthropicAuthEnabled())')
    const unreadableAt = body.indexOf(
      'getAdminManagedPolicyUnreadableError()\n',
    )
    const permittedAt = body.indexOf('permittedOrgUuids')
    for (const at of [hostAt, sshAt, authAt, permittedAt]) {
      expect(at).toBeGreaterThan(-1)
    }
    expect(sshAt).toBeGreaterThan(hostAt)
    expect(authAt).toBeGreaterThan(sshAt)
    expect(permittedAt).toBeGreaterThan(authAt)
    void unreadableAt
  })

  test('the pin is read from policySettings, not merged settings', async () => {
    const body = await validateBody()
    expect(body).toContain("getSettingsForSource('policySettings')")
    // densable `r`: forceLoginMethod alone also counts as a configured pin.
    expect(body).toContain('policy?.forceLoginMethod !== undefined')
  })

  test('host-managed provider skips the pin but still reports it', async () => {
    const body = await validateBody()
    const at = body.indexOf('isHostManagedProviderAuth()')
    const window = body.slice(at, at + 400)
    expect(window).toContain('managed_by_host_under_pin')
    expect(window).toContain('valid: true')
  })

  test('the ssh remote branch reports which pin situation it skipped', async () => {
    const body = await validateBody()
    for (const reason of [
      'unix_socket_3p_under_pin',
      'unix_socket_ssh_under_pin',
      'unix_socket_unreadable_policy',
    ]) {
      expect(body).toContain(reason)
    }
    // Upstream distinguishes the two by whether 1P auth is on, and only the
    // ssh case requires an org UUID specifically (the 3P case accepts either pin).
    expect(body).toContain('!anthropicAuth && pinConfigured')
    expect(body).toContain('anthropicAuth && configuredOrgUuid !== undefined')
  })

  test('a pinned machine carrying a non-OAuth Anthropic credential is refused', async () => {
    const body = await validateBody()
    expect(body).toContain('pinConfigured && hasNonOAuthAnthropicCredential()')
    const at = body.indexOf('pinConfigured && hasNonOAuthAnthropicCredential()')
    expect(body.slice(at, at + 200)).toContain('valid: false')
  })
})

describe('hasNonOAuthAnthropicCredential (densable q$)', () => {
  test('covers exactly the credentials the refusal message names', async () => {
    const src = (await authSrc()).replace(/\s+/g, ' ')
    const at = src.indexOf('function hasNonOAuthAnthropicCredential()')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('}', at))
    expect(body).toContain('hasAnthropicApiKeyAuth()')
    expect(body).toContain('process.env.ANTHROPIC_AUTH_TOKEN')
    expect(body).toContain('process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR')
    expect(body).toContain('getConfiguredApiKeyHelper()')
  })

  test('the omitted upstream clause is documented, not silently dropped', async () => {
    const src = (await authSrc()).replace(/\s+/g, ' ')
    const at = src.indexOf('function hasNonOAuthAnthropicCredential()')
    // The doc comment above it must name the unresolved predicate and say which
    // way the omission errs, so a later pass can finish it deliberately.
    const doc = src.slice(Math.max(0, at - 900), at)
    expect(doc).toContain('tt')
    expect(doc).toContain('under-matching')
  })
})

describe('normalizeForceLoginOrgUuids', () => {
  test('undefined is unset; a string becomes a one-item list', () => {
    expect(normalizeForceLoginOrgUuids(undefined)).toBeUndefined()
    expect(normalizeForceLoginOrgUuids('org-a')).toEqual(['org-a'])
  })

  test('an array pin is kept as-is, including empty', () => {
    expect(normalizeForceLoginOrgUuids(['org-a', 'org-b'])).toEqual([
      'org-a',
      'org-b',
    ])
    expect(normalizeForceLoginOrgUuids([])).toEqual([])
  })
})

describe('oauthLoginOrgUUIDHint', () => {
  test('a string pin is the authorize-URL hint', () => {
    expect(oauthLoginOrgUUIDHint('org-a', false)).toBe('org-a')
  })

  test('a one-element array is the same pin as a string', () => {
    expect(oauthLoginOrgUUIDHint(['org-a'], false)).toBe('org-a')
  })

  test('two or more orgs stay unhinted so the URL cannot pick one', () => {
    expect(oauthLoginOrgUUIDHint(['org-a', 'org-b'], false)).toBeUndefined()
    expect(oauthLoginOrgUUIDHint([], false)).toBeUndefined()
    expect(oauthLoginOrgUUIDHint(undefined, false)).toBeUndefined()
  })

  test('a method mismatch suppresses even a string pin', () => {
    expect(oauthLoginOrgUUIDHint('org-a', true)).toBeUndefined()
    expect(oauthLoginOrgUUIDHint(['org-a'], true)).toBeUndefined()
  })
})

describe('login sites share oauthLoginOrgUUIDHint', () => {
  test('REPL / CLI auth / print do not inline typeof === string', async () => {
    const files = [
      new URL('../../components/ConsoleOAuthFlow.tsx', import.meta.url),
      new URL('../../cli/handlers/auth.ts', import.meta.url),
      new URL('../../cli/print.ts', import.meta.url),
    ]
    for (const file of files) {
      const src = await Bun.file(file).text()
      expect(src).toContain('oauthLoginOrgUUIDHint(')
      expect(src).not.toContain(
        "typeof settings.forceLoginOrgUUID === 'string'",
      )
      expect(src).not.toContain(
        "typeof authSettings.forceLoginOrgUUID === 'string'",
      )
    }
  })
})
