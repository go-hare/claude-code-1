import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCliOwnedBearerProvider,
  isCcrInjectedConfig,
  isCliOwnedBearerConfig,
  isCliOwnedConfig,
  markCcrInjectedConfig,
  markCliOwnedConfig,
  resetCliOwnedConfigsForTests,
  resolveCliOwnedBearerToken,
  wrapCliOwnedFetch,
} from '../cliOwnedConfigs.js'
import { isMcpCcrProxyServerConfig } from '../mcpConnectTimeout.js'
import {
  densableBareClientCapabilities,
  densableClientCapabilitiesForServer,
} from '../mcpV2Client.js'

afterEach(() => {
  resetCliOwnedConfigsForTests()
})

describe('densable 2.1.289 markCliOwnedConfig / isCliOwnedConfig (OEe/nf)', () => {
  test('markCliOwnedConfig registers object; isCliOwnedConfig true', () => {
    const config = { type: 'http', url: 'https://example/mcp' }
    expect(isCliOwnedConfig(config)).toBe(false)
    markCliOwnedConfig(config, {
      getBearerToken: () => 'tok',
    })
    expect(isCliOwnedConfig(config)).toBe(true)
    expect(getCliOwnedBearerProvider(config)?.()).toBe('tok')
  })

  test('HEe OR: isMcpCcrProxyServerConfig true for owned config without CCR url', () => {
    const config = { type: 'http', url: 'https://other.example/not-ccr' }
    expect(isMcpCcrProxyServerConfig(config)).toBe(false)
    markCliOwnedConfig(config)
    expect(isMcpCcrProxyServerConfig(config)).toBe(true)
  })

  test('Idt: owned config forces bare elicitation bag', () => {
    const config = {
      type: 'http' as const,
      url: 'https://other.example/not-ccr',
    }
    markCliOwnedConfig(config)
    expect(
      densableClientCapabilitiesForServer(config, {
        readFeature: () => true,
      }),
    ).toEqual(densableBareClientCapabilities())
  })

  test('markCcrInjectedConfig stamps ccrInjectedConfigs', () => {
    const config = { type: 'http', url: 'https://example/mcp' }
    markCcrInjectedConfig(config)
    expect(isCcrInjectedConfig(config)).toBe(true)
  })

  test('does not export minify OEe/nf/Kt', async () => {
    const mod = await import('../cliOwnedConfigs.js')
    expect('OEe' in mod).toBe(false)
    expect('nf' in mod).toBe(false)
    expect('Kt' in mod).toBe(false)
  })
})

describe('densable 2.1.289 Ukn / Hr / bOe cli-owned fetch', () => {
  test('bOe: async resolver counts as owned bearer', () => {
    const config = { type: 'http', url: 'https://example/mcp' }
    expect(isCliOwnedBearerConfig(config)).toBe(false)
    markCliOwnedConfig(config, {
      resolveBearerToken: async () => 'async-tok',
    })
    expect(isCliOwnedBearerConfig(config)).toBe(true)
  })

  test('Ukn awaits async resolver; falls back to sync I(e)', async () => {
    const asyncCfg = { type: 'http', url: 'https://async.example/mcp' }
    markCliOwnedConfig(asyncCfg, {
      resolveBearerToken: async () => 'from-async',
      getBearerToken: () => 'from-sync',
    })
    expect(await resolveCliOwnedBearerToken(asyncCfg)).toBe('from-async')

    const syncCfg = { type: 'http', url: 'https://sync.example/mcp' }
    markCliOwnedConfig(syncCfg, { getBearerToken: () => 'from-sync' })
    expect(await resolveCliOwnedBearerToken(syncCfg)).toBe('from-sync')
  })

  test('Hr sets Bearer from Ukn when Authorization is missing', async () => {
    const config = { type: 'http', url: 'https://example/mcp' }
    markCliOwnedConfig(config, {
      resolveBearerToken: async () => 'live-async',
      requestHeaders: () => ({ 'X-Owned': '1' }),
    })
    const inner = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer live-async')
      expect(headers.get('X-Owned')).toBe('1')
      expect(init?.redirect).toBe('error')
      return new Response('ok', { status: 204 })
    }
    const fetch = wrapCliOwnedFetch(inner, config)
    const res = await fetch('https://example/mcp')
    expect(res.status).toBe(204)
  })
})
