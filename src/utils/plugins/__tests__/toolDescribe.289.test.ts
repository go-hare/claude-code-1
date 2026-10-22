/**
 * densable 2.1.289 `AH` / `sFn` / `hQ` / `r8` / `Gue` / `lFn` / `nls`.
 * User plugins cannot rewrite org-managed MCP sign-in tool descriptions.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Tool } from '../../../Tool.js'
import { toolToAPISchema } from '../../api.js'
import { clearToolSchemaCache } from '../../toolSchemaCache.js'
import {
  setLoadedFunctionHooksModules,
  type FunctionHookHandler,
  type LoadedFunctionHooksModule,
} from '../functionHooksModules.js'
import {
  floorsAfterNextTo,
  hopBypassReason,
  pastUsers,
  USER_REACHABLE_TIERS,
} from '../functionHooksHop.js'
import {
  CORE_TOOL_PROVIDER,
  MANAGED_MCP_SCOPES,
  SEC_DEFAULT_PLUGIN,
  TOOL_DESCRIBE_ENGINE,
  deferralOf,
  forgetDeferrals,
  hasUserInstalledLink,
  isToolDescribeCounted,
  mcpInfoSource,
  modulesForToolDescribeCount,
  providerForMcpServer,
  providerForTool,
  resetToolDescribeSecDefaultSent,
  resolveToolDescription,
  setMcpRecordLookup,
  ya,
} from '../toolDescribe.js'

const SRC = readFileSync(join(import.meta.dir, '../toolDescribe.ts'), 'utf8')
const HOP = readFileSync(
  join(import.meta.dir, '../functionHooksHop.ts'),
  'utf8',
)
const CHAIN = readFileSync(
  join(import.meta.dir, '../functionHooksModules.ts'),
  'utf8',
)
const API = readFileSync(join(import.meta.dir, '../../api.ts'), 'utf8')
const HOOKS = readFileSync(
  join(import.meta.dir, '../loadPluginHooks.ts'),
  'utf8',
)
const AUTH = readFileSync(
  join(
    import.meta.dir,
    '../../../../packages/builtin-tools/src/tools/McpAuthTool/McpAuthTool.ts',
  ),
  'utf8',
)
const CLIENT = readFileSync(
  join(import.meta.dir, '../../../services/mcp/client.ts'),
  'utf8',
)

function rewrite(to: string): FunctionHookHandler {
  return async (_api, event, next) => next({ ...event, description: to })
}

function describeMod(
  name: string,
  extras: Partial<LoadedFunctionHooksModule> = {},
): LoadedFunctionHooksModule {
  return {
    name,
    patterns: ['tool.describe'],
    hooks: [
      { pattern: 'tool.describe', hook: rewrite(`rewritten-by-${name}`) },
    ],
    ...extras,
  }
}

function mcpTool(name: string, mcpInfo?: Tool['mcpInfo']): Tool {
  return {
    name,
    isMcp: true,
    mcpInfo,
    description: async () => 'prompt',
    prompt: async () => 'prompt',
    inputJSONSchema: { type: 'object', properties: {} },
    inputSchema: {} as never,
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
  } as unknown as Tool
}

async function schemaOf(
  tool: Tool,
  extras: { withoutToolDescribeHooks?: boolean } = {},
) {
  return toolToAPISchema(tool, {
    getToolPermissionContext: async () => ({ mode: 'default' }) as never,
    tools: [tool],
    agents: [],
    ...extras,
  })
}

function schemaDescription(schema: unknown): string | undefined {
  return (schema as { description?: string }).description
}

afterEach(() => {
  setLoadedFunctionHooksModules([])
  setMcpRecordLookup(null)
  forgetDeferrals()
  resetToolDescribeSecDefaultSent()
  clearToolSchemaCache()
})

describe('densable 2.1.289 tool.describe / sFn / hQ / r8 / lFn', () => {
  test('gold strings and nls host', () => {
    expect(TOOL_DESCRIBE_ENGINE).toBe('engine')
    expect([...MANAGED_MCP_SCOPES]).toEqual(['enterprise', 'managed'])
    expect(SEC_DEFAULT_PLUGIN).toBe('cc-plugin-sec-default')
    expect(SRC).toContain(
      "provider (${server}): plugin record unread, read as the organization's: ",
    )
    expect(SRC).toContain('a hook set isDeferred')
    expect(SRC).toContain(
      'the built-in sec-default plugin changed this tool, though its hook should only pass the event on',
    )
    expect(API).toContain('await resolveToolDescription(tool, description, fo)')
    expect(API).toContain('withoutToolDescribeHooks')
    expect(HOOKS).toContain('link: plugin.source')
    expect(HOOKS).toContain("tier: 'user' as const")
    expect(AUTH).toContain('source: mcpInfoSource(serverName, config)')
    expect(CLIENT).toContain('scope: client.config.scope')
    expect(CLIENT).toContain(
      'source: mcpInfoSource(client.name, client.config)',
    )
    expect(SRC).toContain('ya(')
    expect(SRC).toContain("'tool.describe'")
    expect(SRC).toContain('runFunctionHookHop(event, payload, toolDescribeCore')
    expect(SRC).not.toContain('modulesForToolDescribeDispatch')
    expect(HOP).toContain('USER_REACHABLE_TIERS')
    expect(HOP).toContain('bypassed by ')
    expect(HOP).toContain('next.to(e, "append")')
    expect(CHAIN).toContain('export async function runFunctionHookHop')
    expect([...USER_REACHABLE_TIERS]).toEqual(['user', 'builtin', 'core'])
  })

  test('d / pastUsers next.to(e, append) when provider is not user-reachable', async () => {
    const calls: string[] = []
    const next = Object.assign(
      async (value?: unknown) => {
        calls.push('next')
        return value
      },
      {
        to: async (_value: unknown, ...tiers: string[]) => {
          calls.push(`to:${tiers.join(',')}`)
          return _value
        },
      },
    )
    await pastUsers({ provider: { plugin: 'mcp:org', tier: 'prepend' } }, next)
    expect(calls).toEqual(['to:append'])
    calls.length = 0
    await pastUsers({ provider: { plugin: 'engine', tier: 'user' } }, next)
    expect(calls).toEqual(['next'])
  })

  test('Fn / Mn: next.to append from prepend bypasses user', () => {
    const floors = floorsAfterNextTo([], ['append'], {
      plugin: SEC_DEFAULT_PLUGIN,
      tier: 'prepend',
    })
    expect(hopBypassReason({ name: 'shop', tier: 'user' }, floors)).toBe(
      `bypassed by ${SEC_DEFAULT_PLUGIN}`,
    )
    expect(
      hopBypassReason({ name: 'policy', tier: 'prepend' }, floors),
    ).toBeUndefined()
    expect(
      hopBypassReason({ name: 'core', isCore: true, tier: 'user' }, floors),
    ).toBeUndefined()
    expect(() =>
      floorsAfterNextTo([], ['append'], { plugin: 'shop', tier: 'user' }),
    ).toThrow(/managed plugins/)
  })

  test('ya hop: user plugin is in the chain and Mn-skipped on prepend', async () => {
    setLoadedFunctionHooksModules([
      describeMod('shop', { tier: 'user', link: 'shop@m' }),
    ])
    const org = await ya(
      'tool.describe',
      {},
    )({
      tool: 'mcp__org__authenticate',
      description: 'prompt',
      provider: { plugin: 'mcp:org', tier: 'prepend' },
    })
    expect(org).toEqual({ description: 'prompt' })
    const user = await ya(
      'tool.describe',
      {},
    )({
      tool: 'mcp__slack__list',
      description: 'prompt',
      provider: { plugin: 'mcp:slack', tier: 'user' },
    })
    expect(user).toEqual({ description: 'rewritten-by-shop' })
  })

  test('sFn core vs missing server vs managed scope', async () => {
    expect(await providerForTool({ name: 'Bash' })).toEqual(CORE_TOOL_PROVIDER)
    expect(
      await providerForTool({ name: 'not-an-mcp-name', isMcp: true }),
    ).toEqual({
      plugin: 'mcp',
      tier: 'user',
    })
    expect(
      await providerForTool({
        name: 'mcp__org__authenticate',
        isMcp: true,
        mcpInfo: {
          serverName: 'org',
          toolName: 'authenticate',
          source: 'enterprise',
        },
      }),
    ).toEqual({ plugin: 'mcp:org', tier: 'prepend' })
    expect(providerForMcpServer({ name: 'org', scope: 'managed' }).tier).toBe(
      'prepend',
    )
  })

  test('sFn unread plugin record is the organization', async () => {
    setMcpRecordLookup(async () => {
      throw new Error('disk')
    })
    expect(
      await providerForTool({
        name: 'mcp__slack__list',
        isMcp: true,
        mcpInfo: { serverName: 'slack', toolName: 'list' },
      }),
    ).toEqual({ plugin: 'mcp:slack', tier: 'prepend' })
  })

  test('sFn pluginSource is qFe user', async () => {
    setMcpRecordLookup(async () => ({ pluginSource: 'slack@anthropic' }))
    expect(
      await providerForTool({
        name: 'mcp__slack__list',
        isMcp: true,
        mcpInfo: { serverName: 'slack', toolName: 'list' },
      }),
    ).toEqual({ plugin: 'slack@anthropic', tier: 'user' })
  })

  test('Tj source: sdk / plugin / scope', () => {
    expect(mcpInfoSource('s', { type: 'sdk', scope: 'user' })).toBe('sdk')
    expect(mcpInfoSource('s', { pluginSource: 'a@b', scope: 'dynamic' })).toBe(
      'plugin',
    )
    expect(mcpInfoSource('s', { scope: 'enterprise' })).toBe('enterprise')
  })

  test('r8 drops user-installed sec-default from isCounted', () => {
    setLoadedFunctionHooksModules([
      {
        ...describeMod(SEC_DEFAULT_PLUGIN, { link: 'copied' }),
      },
    ])
    expect(hasUserInstalledLink({ link: 'copied' })).toBe(true)
    expect(modulesForToolDescribeCount('tool.describe')).toEqual([])
    expect(isToolDescribeCounted('mcp__org__authenticate')).toBe(false)
    setLoadedFunctionHooksModules([describeMod(SEC_DEFAULT_PLUGIN)])
    expect(isToolDescribeCounted('mcp__org__authenticate')).toBe(true)
  })

  test('lFn user plugin rewrites user MCP, not enterprise sign-in', async () => {
    setLoadedFunctionHooksModules([
      describeMod('shop', { tier: 'user', link: 'shop@m' }),
    ])
    const userMcp = {
      name: 'mcp__slack__list',
      isMcp: true,
      mcpInfo: { serverName: 'slack', toolName: 'list', source: 'user' },
    }
    const orgAuth = {
      name: 'mcp__org__authenticate',
      isMcp: true,
      mcpInfo: {
        serverName: 'org',
        toolName: 'authenticate',
        source: 'enterprise',
      },
    }
    expect(await resolveToolDescription(userMcp, 'prompt', false)).toEqual({
      description: 'rewritten-by-shop',
      isDeferred: false,
    })
    expect(await resolveToolDescription(orgAuth, 'prompt', false)).toEqual({
      description: 'prompt',
      isDeferred: false,
    })
  })

  test('lFn prepend/builtin still runs on managed MCP', async () => {
    setLoadedFunctionHooksModules([
      describeMod('shop', { tier: 'user', link: 'shop@m' }),
      describeMod('policy', { tier: 'prepend' }),
    ])
    const orgAuth = {
      name: 'mcp__org__authenticate',
      isMcp: true,
      mcpInfo: {
        serverName: 'org',
        toolName: 'authenticate',
        source: 'managed',
      },
    }
    expect(await resolveToolDescription(orgAuth, 'prompt', false)).toEqual({
      description: 'rewritten-by-policy',
      isDeferred: false,
    })
  })

  test('HJn nls: user rewrite skipped for enterprise auth tool', async () => {
    setLoadedFunctionHooksModules([
      describeMod('shop', { tier: 'user', link: 'shop@m' }),
    ])
    const tool = mcpTool('mcp__org__authenticate', {
      serverName: 'org',
      toolName: 'authenticate',
      source: 'enterprise',
    })
    const schema = await schemaOf(tool)
    expect(schemaDescription(schema)).toBe('prompt')
    const skipped = await schemaOf(
      mcpTool('mcp__slack__list', {
        serverName: 'slack',
        toolName: 'list',
        source: 'user',
      }),
      { withoutToolDescribeHooks: true },
    )
    expect(schemaDescription(skipped)).toBe('prompt')
  })

  test('HJn nls: user MCP description is rewritten', async () => {
    setLoadedFunctionHooksModules([
      describeMod('shop', { tier: 'user', link: 'shop@m' }),
    ])
    const schema = await schemaOf(
      mcpTool('mcp__slack__list', {
        serverName: 'slack',
        toolName: 'list',
        source: 'user',
      }),
    )
    expect(schemaDescription(schema)).toBe('rewritten-by-shop')
    expect(deferralOf('mcp__slack__list')).toBeUndefined()
  })
})
