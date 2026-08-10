import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'
import { mock } from 'bun:test'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

// densable: use real bootstrap foundry map + real getAPIProvider.
// Do NOT mock.module bootstrap/state or providers — process-global
// last-write-wins pollutes other files (getCwdState / isFirstParty…).
import { getFoundryDeploymentCapabilities } from '../../bootstrap/state.js'
import {
  isFoundryCapabilitySupported,
  parseFoundryUnsupportedCapabilities,
  recordFoundryUnsupportedCapabilities,
  getFoundryCapabilityKey,
  stripFoundryUnsupportedToolFields,
  getFoundryResourceBaseUrl,
} from '../foundryCapabilities.js'

const FOUNDRY_ENV = 'CLAUDE_CODE_USE_FOUNDRY'

describe('densable foundry $Fe / lnu / cns', () => {
  const prevFoundry = process.env[FOUNDRY_ENV]
  const prevBase = process.env.ANTHROPIC_FOUNDRY_BASE_URL
  const prevRes = process.env.ANTHROPIC_FOUNDRY_RESOURCE

  beforeEach(() => {
    getFoundryDeploymentCapabilities().clear()
    process.env[FOUNDRY_ENV] = '1'
    delete process.env.ANTHROPIC_FOUNDRY_BASE_URL
    delete process.env.ANTHROPIC_FOUNDRY_RESOURCE
  })

  afterEach(() => {
    getFoundryDeploymentCapabilities().clear()
    if (prevFoundry === undefined) delete process.env[FOUNDRY_ENV]
    else process.env[FOUNDRY_ENV] = prevFoundry
    if (prevBase === undefined) delete process.env.ANTHROPIC_FOUNDRY_BASE_URL
    else process.env.ANTHROPIC_FOUNDRY_BASE_URL = prevBase
    if (prevRes === undefined) delete process.env.ANTHROPIC_FOUNDRY_RESOURCE
    else process.env.ANTHROPIC_FOUNDRY_RESOURCE = prevRes
  })

  test('$Fe empty map defaults to true (allow)', () => {
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search'),
    ).toBe(true)
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search_server'),
    ).toBe(true)
  })

  test('$Fe non-foundry provider always true even with learned denials', () => {
    process.env.ANTHROPIC_FOUNDRY_RESOURCE = 'my-res'
    recordFoundryUnsupportedCapabilities('claude-sonnet-4-5', [
      'tool_search',
      'tool_search_server',
    ])
    delete process.env[FOUNDRY_ENV]
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search'),
    ).toBe(true)
    process.env[FOUNDRY_ENV] = '1'
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search'),
    ).toBe(false)
  })

  test('$Fe false when capability recorded for deployment key', () => {
    process.env.ANTHROPIC_FOUNDRY_RESOURCE = 'my-res'
    const key = getFoundryCapabilityKey('claude-sonnet-4-5')
    expect(key).toContain('my-res.services.ai.azure.com')
    expect(key).toContain('claude-sonnet-4-5')
    recordFoundryUnsupportedCapabilities('claude-sonnet-4-5', [
      'tool_search',
      'tool_search_server',
    ])
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search'),
    ).toBe(false)
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'tool_search_server'),
    ).toBe(false)
    // other capabilities still ok
    expect(
      isFoundryCapabilitySupported('claude-sonnet-4-5', 'structured_outputs'),
    ).toBe(true)
  })

  test('lnu parses workspace not-supported message', () => {
    expect(
      parseFoundryUnsupportedCapabilities(
        'tool_search_server, tool_search not supported in your workspace',
      ),
    ).toEqual(['tool_search_server', 'tool_search'])
  })

  test('lnu parses Azure features-not-available message', () => {
    expect(
      parseFoundryUnsupportedCapabilities(
        'features are not available for Azure AI Foundry workspace: tool_search and structured_outputs',
      ),
    ).toEqual(['tool_search', 'structured_outputs'])
  })

  test('cnu strips defer_loading when tool_search unsupported', () => {
    process.env.ANTHROPIC_FOUNDRY_BASE_URL = 'https://foundry.example'
    recordFoundryUnsupportedCapabilities('claude-sonnet-4-5', [
      'tool_search_server',
    ])
    const tools = [
      { name: 'Read', description: 'r' },
      {
        name: 'DeferredToolPlaceholder',
        description:
          'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
        defer_loading: true as boolean | undefined,
      },
      {
        // densable requires description===kco to drop; wrong desc only strips defer
        name: 'DeferredToolPlaceholder',
        description: 'not the kco placeholder text',
        defer_loading: true as boolean | undefined,
      },
      {
        name: 'Config',
        description: 'c',
        defer_loading: true as boolean | undefined,
      },
      {
        name: 'StrictTool',
        description: 's',
        strict: true as boolean | undefined,
      },
    ]
    const stripped = stripFoundryUnsupportedToolFields(
      tools,
      'claude-sonnet-4-5',
    )
    // exact kco description dropped
    expect(
      stripped.find(
        t =>
          t.name === 'DeferredToolPlaceholder' &&
          t.description ===
            'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
      ),
    ).toBeUndefined()
    // name-only match without kco description is kept but defer_loading stripped
    const wrongDesc = stripped.find(
      t =>
        t.name === 'DeferredToolPlaceholder' &&
        t.description === 'not the kco placeholder text',
    )
    expect(wrongDesc).toBeDefined()
    expect(wrongDesc?.defer_loading).toBeUndefined()
    const config = stripped.find(t => t.name === 'Config')
    expect(config).toBeDefined()
    expect(config?.defer_loading).toBeUndefined()
    // structured_outputs not stripped → strict kept
    expect(stripped.find(t => t.name === 'StrictTool')?.strict).toBe(true)
  })

  test('lns prefers ANTHROPIC_FOUNDRY_BASE_URL', () => {
    process.env.ANTHROPIC_FOUNDRY_BASE_URL = 'https://custom.foundry'
    process.env.ANTHROPIC_FOUNDRY_RESOURCE = 'ignored'
    expect(getFoundryResourceBaseUrl()).toBe('https://custom.foundry')
  })
})
