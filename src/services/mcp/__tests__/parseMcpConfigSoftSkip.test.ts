import { afterEach, describe, expect, test } from 'bun:test'
import {
  getMcpConfigServerErrors,
  parseMcpConfig,
  resetMcpConfigServerErrors,
  storeMcpConfigServerErrors,
} from '../config.js'

afterEach(() => {
  resetMcpConfigServerErrors()
})

describe('parseMcpConfig densable 2.1.219 soft-skip (Tlr)', () => {
  test('keeps valid siblings when one entry is url_missing_type', () => {
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          good: { type: 'http', url: 'https://example.com/mcp' },
          bad: { url: 'https://example.com/missing-type' },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      filePath: 'command line',
    })
    expect(config).not.toBeNull()
    expect(config!.mcpServers).toHaveProperty('good')
    expect(config!.mcpServers).not.toHaveProperty('bad')
    const skip = errors.find(e => e.mcpErrorMetadata?.skipReason)
    expect(skip?.mcpErrorMetadata?.skipReason).toBe('url_missing_type')
    expect(skip?.mcpErrorMetadata?.serverName).toBe('bad')
    expect(skip?.message).toContain('Skipped')
  })

  test('soft-skips unknown_type', () => {
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          weird: { type: 'not-a-real-type', url: 'https://x' },
        },
      },
      expandVars: false,
      scope: 'dynamic',
    })
    expect(config).not.toBeNull()
    expect(Object.keys(config!.mcpServers)).toEqual([])
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe('unknown_type')
  })

  test('soft-skips reserved_name claude-in-chrome', () => {
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          'claude-in-chrome': {
            type: 'http',
            url: 'https://example.com/chrome',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
    })
    expect(config).not.toBeNull()
    expect(config!.mcpServers).not.toHaveProperty('claude-in-chrome')
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe('reserved_name')
  })

  test('fatal when top-level shape missing mcpServers', () => {
    const { config, errors } = parseMcpConfig({
      configObject: { servers: { a: { command: 'x' } } },
      expandVars: false,
      scope: 'dynamic',
      filePath: 'foo.json',
    })
    expect(config).toBeNull()
    expect(errors[0]?.mcpErrorMetadata?.severity).toBe('fatal')
    expect(errors[0]?.message).toContain('mcpServers')
  })

  test('accepts streamable-http as http alias', () => {
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          remote: {
            type: 'streamable-http',
            url: 'https://example.com/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
    })
    expect(config).not.toBeNull()
    expect(config!.mcpServers.remote).toBeDefined()
    expect(errors.filter(e => e.mcpErrorMetadata?.skipReason)).toEqual([])
  })

  test('store/get mcp config server errors (gEm/yEm)', () => {
    storeMcpConfigServerErrors([
      { name: 'a', type: 'url_missing_type', message: 'Skipped — a' },
    ])
    expect(getMcpConfigServerErrors()).toEqual([
      { name: 'a', type: 'url_missing_type', message: 'Skipped — a' },
    ])
    resetMcpConfigServerErrors()
    expect(getMcpConfigServerErrors()).toEqual([])
  })
})
