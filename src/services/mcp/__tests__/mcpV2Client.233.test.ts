/**
 * densable 2.1.233 #6 — MCP v2 Client factory (listen-capable).
 */
import { describe, expect, test } from 'bun:test'
import {
  createDensableMcpClient,
  densableClientCapabilities,
  densableListChangedOptions,
  DENSABLE_JSON_SCHEMA_DRAFT_URIS,
  DensableAjvJsonSchemaValidator,
  toV2VersionNegotiation,
} from '../mcpV2Client.js'

describe('createDensableMcpClient densable k() surface', () => {
  test('capabilities match densable KPb (roots.listChanged + elicitation)', () => {
    const caps = densableClientCapabilities()
    expect(caps.roots).toEqual({ listChanged: true })
    expect(caps.elicitation).toEqual({})
  })

  test('listChanged stubs autoRefresh false', () => {
    const lc = densableListChangedOptions()
    expect(lc.tools?.autoRefresh).toBe(false)
    expect(lc.prompts?.autoRefresh).toBe(false)
    expect(lc.resources?.autoRefresh).toBe(false)
  })

  test('versionNegotiation maps densable BVa plan', () => {
    expect(toV2VersionNegotiation({ mode: 'legacy' })).toEqual({
      mode: 'legacy',
    })
    expect(
      toV2VersionNegotiation({ mode: 'auto', probe: { timeoutMs: 5000 } }),
    ).toEqual({ mode: 'auto', probe: { timeoutMs: 5000 } })
  })

  test('factory exposes listen + getProtocolEra (v2 Client)', () => {
    const client = createDensableMcpClient({ mode: 'legacy' })
    expect(typeof client.listen).toBe('function')
    expect(typeof client.getProtocolEra).toBe('function')
    expect(client.autoOpenedSubscription).toBeUndefined()
  })

  test('setRequestHandler accepts densable string method', () => {
    const client = createDensableMcpClient({ mode: 'legacy' })
    client.setRequestHandler('roots/list', async () => ({
      roots: [],
    }))
  })

  test('k0i/kpS strips only densable draft $schema URIs', () => {
    expect(DENSABLE_JSON_SCHEMA_DRAFT_URIS.size).toBe(10)
    expect(
      DENSABLE_JSON_SCHEMA_DRAFT_URIS.has(
        'https://json-schema.org/draft-07/schema',
      ),
    ).toBe(true)
    // trailing # stripped before membership (densable t.replace(/#$/,""))
    const v = new DensableAjvJsonSchemaValidator()
    // getValidator must accept draft-07 with trailing # without throw
    const validator = v.getValidator({
      $schema: 'https://json-schema.org/draft-07/schema#',
      type: 'object',
    })
    expect(typeof validator).toBe('function')
  })
})
