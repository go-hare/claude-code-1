/**
 * densable 2.1.289 `_r` / Ua / fr — MCP step-up re-auth.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { McpAuthError } from '../client.js'
import {
  MCP_STEP_UP_AUTH_DIALOG_GATE,
  displayableMcpScope,
  extractInsufficientScope,
  isMcpStepUpScopeDisplayable,
  mcpConfiguredScopesPermit,
} from '../mcpStepUpReauth.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 mcp_step_up_reauth', () => {
  test('pr gate name', () => {
    expect(MCP_STEP_UP_AUTH_DIALOG_GATE).toBe('tengu_mcp_step_up_auth_dialog')
  })

  test('Ua displayable scope', () => {
    expect(isMcpStepUpScopeDisplayable('tools:read tools:write')).toBe(true)
    expect(displayableMcpScope('tools:read')).toBe('tools:read')
    expect(isMcpStepUpScopeDisplayable('tools:\nread')).toBe(false)
  })

  test('fr configured scopes', () => {
    expect(mcpConfiguredScopesPermit({}, 'x')).toBe(true)
    expect(mcpConfiguredScopesPermit({ oauth: { scopes: 'a b' } }, 'a')).toBe(
      true,
    )
    expect(mcpConfiguredScopesPermit({ oauth: { scopes: 'a b' } }, 'c')).toBe(
      false,
    )
    expect(
      mcpConfiguredScopesPermit(
        { oauth: { authServerMetadataUrl: 'https://as.example' } },
        'a',
      ),
    ).toBe(false)
  })

  test('EI requestedScope + 403 extract', () => {
    const err = new McpAuthError(
      's',
      'needs scope',
      'insufficient_scope',
      undefined,
      'tools:write',
    )
    expect(err.requestedScope).toBe('tools:write')
    expect(err.authErrorKind).toBe('insufficient_scope')
    expect(
      extractInsufficientScope({
        message: '403 insufficient_scope scope="openid"',
      }),
    ).toBe('openid')
  })

  test('source-lock WKe caller + connections', () => {
    const step = readFileSync(
      join(root, 'src/services/mcp/mcpStepUpReauth.ts'),
      'utf8',
    )
    expect(step).toContain("source: 'mcp_step_up_reauth'")
    expect(step).toContain("header: 'MCP'")
    expect(step).toContain('connections()')
    expect(step).toContain('adoptServer')
    expect(step).toContain('appendIfAbsent: false')

    const wiring = readFileSync(join(root, 'src/utils/sessionSlots.ts'), 'utf8')
    expect(wiring).toContain('registerConnections')
    expect(wiring).toContain('acquireConnections')

    const client = readFileSync(
      join(root, 'src/services/mcp/client.ts'),
      'utf8',
    )
    expect(client).toContain('requestedScope')
    expect(client).toContain('insufficient_scope')
    expect(client).toContain('requestMcpStepUpReauth')
  })
})
