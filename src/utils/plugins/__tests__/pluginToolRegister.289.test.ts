/**
 * densable 2.1.289 $.tool.register → HTTP loopback MCP (m_o / LHt / Xj).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { createLinkedTransportPair } from '@claude-code/mcp-client'
import { buildMcpToolName } from 'src/services/mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from 'src/services/mcp/normalization.js'
import {
  clearPluginToolRegistryForTests,
  forgetAllPluginRegisteredTools,
  forgetPluginRegisteredTools,
  getPluginRegisteredTool,
  getPluginToolServerKey,
  isPendingPluginToolServerRemoval,
  isPluginToolServerKeyMinted,
  listPluginRegisteredTools,
  setPluginRegisteredTool,
  setPluginToolServerKey,
} from '../pluginToolRegistry.js'
import {
  buildPluginToolsDynamicHttpConfig,
  clearPluginToolRegistrarForTests,
  createBunPluginToolRegistrar,
  createPluginToolsMcpServer,
  ensurePluginToolRegistrarInstalled,
  getPluginToolRegistrar,
  installPluginToolRegistrar,
} from '../pluginToolLoopbackRegistrar.js'
import {
  getPluginToolSessionHost,
  setPluginToolSessionHost,
} from '../pluginToolSessionHost.js'
import {
  handleHostOp,
  retireFunctionHooksModule,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'

describe('densable 2.1.289 plugin tool register bag + registrar', () => {
  beforeEach(() => {
    clearPluginToolRegistryForTests()
    clearPluginToolRegistrarForTests()
    setPluginToolSessionHost(undefined)
    setLoadedFunctionHooksModules([])
  })
  afterEach(() => {
    setLoadedFunctionHooksModules([])
    clearPluginToolRegistryForTests()
    clearPluginToolRegistrarForTests()
    setPluginToolSessionHost(undefined)
  })

  test('bag own/list/serverKey', () => {
    setPluginRegisteredTool('demo', {
      name: 'ping',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    expect(listPluginRegisteredTools('demo')).toHaveLength(1)
    expect(getPluginRegisteredTool('demo', 'ping')?.description).toBe('p')
  })

  test('forget clears minted server key so r_o conflict check can run again', () => {
    setPluginRegisteredTool('demo', {
      name: 'ping',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    setPluginToolServerKey('demo', 'demo')
    expect(isPluginToolServerKeyMinted('demo')).toBe(true)
    expect(forgetPluginRegisteredTools('demo')).toBe('demo')
    expect(getPluginToolServerKey('demo')).toBeUndefined()
    expect(isPluginToolServerKeyMinted('demo')).toBe(false)
  })

  test('forgetAll returns keys and clears minted (reload nuclear teardown)', () => {
    setPluginRegisteredTool('a', {
      name: 'ping',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    setPluginToolServerKey('a', 'a')
    setPluginRegisteredTool('b', {
      name: 'pong',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    setPluginToolServerKey('b', 'b')
    expect(forgetAllPluginRegisteredTools().sort()).toEqual(['a', 'b'])
    expect(isPluginToolServerKeyMinted('a')).toBe(false)
    expect(getPluginToolServerKey('a')).toBeUndefined()
  })

  test('setLoadedFunctionHooksModules removes prior MCP mounts', () => {
    const removed: string[] = []
    setPluginRegisteredTool('gone', {
      name: 'ping',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    setPluginToolServerKey('gone', 'gone')
    setPluginToolSessionHost({
      addMcpServer: () => {},
      removeMcpServer: name => {
        removed.push(name)
      },
      tools: () => [],
      mcpServers: () => [],
    })
    expect(setLoadedFunctionHooksModules([])).toEqual(['gone'])
    expect(removed).toEqual(['gone'])
    expect(isPluginToolServerKeyMinted('gone')).toBe(false)
    expect(isPendingPluginToolServerRemoval('gone')).toBe(true)
  })

  test('r_o skips pending removal so remount works while host.mcpServers lags', async () => {
    const lingering = new Set<string>()
    const visible: string[] = []
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: (name, _config) => {
        lingering.add(name)
        visible.push(buildMcpToolName(name, 'ping'))
      },
      removeMcpServer: async name => {
        await new Promise(r => setTimeout(r, 40))
        lingering.delete(name)
      },
      tools: () => visible.map(name => ({ name })),
      mcpServers: () => [...lingering],
    })
    setLoadedFunctionHooksModules([
      { name: 'demo', patterns: [], status: 'live' },
    ])
    await handleHostOp(
      'tool.register',
      [
        {
          name: 'ping',
          description: 'ping tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'demo',
    )
    const key = getPluginToolServerKey('demo')
    expect(key).toBe('demo')
    expect(lingering.has('demo')).toBe(true)

    // Nuclear clear: bags/minted gone; async remove still pending so host lists demo.
    const removedKeys = setLoadedFunctionHooksModules([])
    expect(removedKeys).toEqual(['demo'])
    expect(isPendingPluginToolServerRemoval('demo')).toBe(true)
    expect(lingering.has('demo')).toBe(true)

    // Remount same plugin must not throw densable r_o against lagging host list.
    setLoadedFunctionHooksModules([
      { name: 'demo', patterns: [], status: 'live' },
    ])
    await expect(
      handleHostOp(
        'tool.register',
        [
          {
            name: 'ping',
            description: 'ping tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        'demo',
      ),
    ).resolves.toMatchObject({
      tool: buildMcpToolName('demo', 'ping'),
    })
    expect(isPendingPluginToolServerRemoval('demo')).toBe(false)
  })

  test('retireFunctionHooksModule forgets bag and removeMcpServer after register', async () => {
    const removed: string[] = []
    const mounted: string[] = []
    const visible: string[] = []
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: (name, _config) => {
        mounted.push(name)
        // Simulate MCP connect making the tool visible immediately.
        visible.push(buildMcpToolName(name, 'ping'))
      },
      removeMcpServer: name => {
        removed.push(name)
        const idx = mounted.indexOf(name)
        if (idx >= 0) mounted.splice(idx, 1)
      },
      tools: () => visible.map(name => ({ name })),
      mcpServers: () => [...mounted],
    })
    // Seed live module so unload/retire can find it (reload removed path).
    setLoadedFunctionHooksModules([
      { name: 'drop-me', patterns: [], status: 'live' },
    ])

    await handleHostOp(
      'tool.register',
      [
        {
          name: 'ping',
          description: 'ping tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'drop-me',
    )
    const key = normalizeNameForMCP('drop-me')
    expect(getPluginToolServerKey('drop-me')).toBe(key)
    expect(mounted).toContain(key)

    await retireFunctionHooksModule('drop-me')

    expect(getPluginToolServerKey('drop-me')).toBeUndefined()
    expect(listPluginRegisteredTools('drop-me')).toHaveLength(0)
    expect(isPluginToolServerKeyMinted(key)).toBe(false)
    expect(removed).toEqual([key])
    expect(getPluginToolSessionHost()?.mcpServers()).not.toContain(key)
  })

  test('DHt keys the server by the raw plugin name (gold Bx)', () => {
    const { key, config } = buildPluginToolsDynamicHttpConfig({
      pluginName: 'my.plugin',
      port: 1234,
      secret: 'sec',
      version: 2,
    })
    expect(key).toBe('my.plugin')
    expect(key).not.toBe(normalizeNameForMCP('my.plugin'))
    expect(config.type).toBe('http')
    expect(config.scope).toBe('dynamic')
    if (config.type === 'http') {
      expect(config.url).toContain('127.0.0.1:1234/sec/')
      expect(config.url).toContain('v=2')
    }
  })

  test('YLo empty until install; YNo installs LHt', () => {
    expect(getPluginToolRegistrar()).toBeUndefined()
    ensurePluginToolRegistrarInstalled()
    expect(typeof getPluginToolRegistrar()).toBe('function')
  })

  test('MHt creates server with plugin-tools version', () => {
    setPluginRegisteredTool('demo', {
      name: 'echo',
      description: 'e',
      inputSchema: { type: 'object' },
    })
    const server = createPluginToolsMcpServer('demo', 3)
    expect(server).toBeTruthy()
    expect(listPluginRegisteredTools('demo')[0]?.name).toBe('echo')
  })

  test('CallTool stub advertises normalized mcp__ name for dotted plugin id', async () => {
    setPluginRegisteredTool('my.plugin', {
      name: 'ping',
      description: 'p',
      inputSchema: { type: 'object' },
    })
    const server = createPluginToolsMcpServer('my.plugin', 1)
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'ping', arguments: {} })
    const text = (result as { content?: Array<{ text?: string }> }).content?.[0]
      ?.text
    expect(text).toContain('mcp__my_plugin__ping')
    expect(text).not.toContain('mcp__my.plugin__ping')
    expect(text).toContain(buildMcpToolName('my.plugin', 'ping'))

    await client.close()
    await server.close()
  })

  test('m_o register returns mcp__ name and mounts via host', async () => {
    const mounted: Array<{ name: string; url?: string }> = []
    const visible: string[] = []
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: (name, config) => {
        mounted.push({
          name,
          url: config.type === 'http' ? config.url : undefined,
        })
        // Simulate MCP connect making the tool visible immediately.
        visible.push(buildMcpToolName(name, 'ping'))
      },
      tools: () => visible.map(name => ({ name })),
      mcpServers: () => mounted.map(m => m.name),
    })

    const result = (await handleHostOp(
      'tool.register',
      [
        {
          name: 'ping',
          description: 'ping tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'demo-plugin',
    )) as { tool: string }

    const key = normalizeNameForMCP('demo-plugin')
    expect(result.tool).toBe(buildMcpToolName(key, 'ping'))
    expect(mounted).toHaveLength(1)
    expect(mounted[0]?.name).toBe(key)
    expect(mounted[0]?.url).toContain('127.0.0.1:')
    expect(getPluginToolServerKey('demo-plugin')).toBe(key)
    expect(listPluginRegisteredTools('demo-plugin')[0]?.name).toBe('ping')
  })

  test('r_o conflict refuses before the bag is touched', async () => {
    const mounted: string[] = []
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: name => {
        mounted.push(name)
      },
      tools: () => [],
      mcpServers: () => ['clash'],
    })
    await expect(
      handleHostOp(
        'tool.register',
        [{ name: 'ping', description: 'ping tool' }],
        'clash',
      ),
    ).rejects.toThrow(/already has an MCP server named "clash"/)
    expect(listPluginRegisteredTools('clash')).toHaveLength(0)
    expect(getPluginToolServerKey('clash')).toBeUndefined()
    expect(mounted).toHaveLength(0)
  })

  test('bare mode refuses @builtin register', async () => {
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: () => {},
      tools: () => [],
      mcpServers: () => [],
    })
    const prevArgv = process.argv
    process.argv = [...process.argv, '--bare']
    try {
      await expect(
        handleHostOp(
          'tool.register',
          [
            {
              name: 'ping',
              description: 'ping tool',
              inputSchema: { type: 'object' },
            },
          ],
          'demo@builtin',
        ),
      ).rejects.toThrow(/--bare/)
    } finally {
      process.argv = prevArgv
    }
  })

  test('bare mode allows non-builtin register', async () => {
    const mounted: Array<{ name: string; url?: string }> = []
    const visible: string[] = []
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: (name, config) => {
        mounted.push({
          name,
          url: config.type === 'http' ? config.url : undefined,
        })
        visible.push(buildMcpToolName(name, 'ping'))
      },
      tools: () => visible.map(name => ({ name })),
      mcpServers: () => mounted.map(m => m.name),
    })
    const prevArgv = process.argv
    process.argv = [...process.argv, '--bare']
    try {
      const result = (await handleHostOp(
        'tool.register',
        [
          {
            name: 'ping',
            description: 'ping tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        'demo',
      )) as { tool: string }
      const key = normalizeNameForMCP('demo')
      expect(result.tool).toBe(buildMcpToolName(key, 'ping'))
      expect(mounted).toHaveLength(1)
    } finally {
      process.argv = prevArgv
    }
  })

  test('builtInToolsDisabled refuses', async () => {
    installPluginToolRegistrar(createBunPluginToolRegistrar())
    setPluginToolSessionHost({
      addMcpServer: () => {},
      tools: () => [],
      mcpServers: () => [],
      builtInToolsDisabled: true,
    })
    await expect(
      handleHostOp(
        'tool.register',
        [
          {
            name: 'ping',
            description: 'ping tool',
            inputSchema: { type: 'object' },
          },
        ],
        'demo',
      ),
    ).rejects.toThrow(/--tools ""/)
  })

  test('session host can be unbound', () => {
    expect(getPluginToolSessionHost()).toBeUndefined()
  })

  test('Hu refuses register before the bag is written when no session is bound', async () => {
    await expect(
      handleHostOp(
        'tool.register',
        [{ name: 'ping', description: 'ping tool' }],
        'demo',
      ),
    ).rejects.toThrow(/no session is bound/)
    expect(listPluginRegisteredTools('demo')).toHaveLength(0)
    expect(getPluginToolRegistrar()).toBeUndefined()
  })
})
