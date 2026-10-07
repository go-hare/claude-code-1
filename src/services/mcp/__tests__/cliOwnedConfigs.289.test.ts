import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCliOwnedBearerProvider,
  isCcrInjectedConfig,
  isCliOwnedConfig,
  markCcrInjectedConfig,
  markCliOwnedConfig,
  resetCliOwnedConfigsForTests,
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
