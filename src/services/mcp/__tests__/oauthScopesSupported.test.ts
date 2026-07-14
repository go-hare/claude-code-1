import { describe, expect, test } from 'bun:test'

/**
 * Official 2.1.196: MCP OAuth must not request the full scopes_supported
 * catalog (breaks GitLab self-hosted with invalid_scope). Prefer explicit
 * `scope` / `default_scope` only.
 *
 * Mirrors getScopeFromMetadata in auth.ts without loading the full OAuth
 * module (which pulls keychain / secure storage).
 */

function getScopeFromMetadata(
  metadata:
    | {
        scope?: string
        default_scope?: string
        scopes_supported?: string[]
      }
    | undefined,
): string | undefined {
  if (!metadata) return undefined
  if ('scope' in metadata && typeof metadata.scope === 'string') {
    return metadata.scope
  }
  if (
    'default_scope' in metadata &&
    typeof metadata.default_scope === 'string'
  ) {
    return metadata.default_scope
  }
  // Intentionally no scopes_supported fallback (2.1.196).
  return undefined
}

describe('getScopeFromMetadata (2.1.196)', () => {
  test('prefers scope over default_scope and scopes_supported', () => {
    expect(
      getScopeFromMetadata({
        scope: 'api',
        default_scope: 'read',
        scopes_supported: ['api', 'read', 'write', 'admin'],
      }),
    ).toBe('api')
  })

  test('uses default_scope when scope absent', () => {
    expect(
      getScopeFromMetadata({
        default_scope: 'read_api',
        scopes_supported: ['api', 'read_api', 'sudo'],
      }),
    ).toBe('read_api')
  })

  test('does NOT fall back to scopes_supported catalog', () => {
    expect(
      getScopeFromMetadata({
        scopes_supported: ['api', 'read_user', 'read_repository', 'sudo'],
      }),
    ).toBeUndefined()
  })

  test('undefined metadata → undefined', () => {
    expect(getScopeFromMetadata(undefined)).toBeUndefined()
  })
})
