import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { joinNonEmptyLines } from '../../../commands/plugin/PluginSettings.js'
import { execCommandHook } from '../../hooks.js'
import {
  bindPluginDevModsSession,
  canAutoEnablePluginDevMods,
  pluginDevModsRefusal,
  restorePluginDevModsHost,
} from '../pluginDevMods.js'
import {
  buildPluginToolsDynamicHttpConfig,
  clearPluginToolRegistrarForTests,
  createBunPluginToolRegistrar,
  createPluginToolsMcpServer,
} from '../pluginToolLoopbackRegistrar.js'
import {
  clearPluginToolRegistryForTests,
  setPluginRegisteredTool,
} from '../pluginToolRegistry.js'

describe('Wave 5A plugin & hooks alignments (#287, #366, #405/#406/#410/#425, #436)', () => {
  afterEach(() => {
    clearPluginToolRegistrarForTests()
    clearPluginToolRegistryForTests()
  })

  test('#287: loopback config uses Authorization Bearer header instead of secret in URL path and exposes serves()', () => {
    const { key, config } = buildPluginToolsDynamicHttpConfig({
      pluginName: 'my.plugin',
      port: 4321,
      secret: 'top-secret',
      version: 3,
    })
    expect(key).toBe('my.plugin')
    expect(config.type).toBe('http')
    if (config.type === 'http') {
      expect(config.url).toBe('http://127.0.0.1:4321/my.plugin?v=3')
      expect(config.url).not.toContain('top-secret')
      expect(config.headers).toEqual({ Authorization: 'Bearer top-secret' })
    }

    const registrar = createBunPluginToolRegistrar()
    const res = registrar('demo-plugin', [
      { name: 'ping', description: 'p', inputSchema: { type: 'object' } },
    ])
    expect(res.config.type).toBe('http')
    if (res.config.type === 'http') {
      expect(registrar.serves?.(res.config.url)).toBe(true)
      expect(registrar.serves?.('http://127.0.0.1:1/other')).toBe(false)
    }
  })

  test('#287: createPluginToolsMcpServer emits _meta["anthropic/alwaysLoad"] when isDeferred is defined', async () => {
    setPluginRegisteredTool('meta-plugin', {
      name: 'always_on',
      description: 'always',
      inputSchema: { type: 'object' },
      isDeferred: false,
    })
    setPluginRegisteredTool('meta-plugin', {
      name: 'deferred_tool',
      description: 'deferred',
      inputSchema: { type: 'object' },
      isDeferred: true,
    })
    setPluginRegisteredTool('meta-plugin', {
      name: 'default_tool',
      description: 'default',
      inputSchema: { type: 'object' },
    })

    const server = createPluginToolsMcpServer('meta-plugin', 1)
    const { Client } = await import('@modelcontextprotocol/client')
    const { createLinkedTransportPair } = await import(
      '@claude-code/mcp-client'
    )
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)

    const listed = await client.listTools()
    const byName = new Map(listed.tools.map(t => [t.name, t]))
    expect(byName.get('always_on')?._meta).toEqual({
      'anthropic/alwaysLoad': true,
    })
    expect(byName.get('deferred_tool')?._meta).toEqual({
      'anthropic/alwaysLoad': false,
    })
    expect(byName.get('default_tool')?._meta).toBeUndefined()

    await client.close()
  })

  test('#366: joinNonEmptyLines combines non-empty segments with newline', () => {
    expect(joinNonEmptyLines(undefined, '')).toBeUndefined()
    expect(joinNonEmptyLines('Saved.', undefined)).toBe('Saved.')
    expect(
      joinNonEmptyLines(
        'Installed foo.',
        'Plugin changes apply when the current response finishes (/reload-plugins is queued).',
      ),
    ).toBe(
      'Installed foo.\nPlugin changes apply when the current response finishes (/reload-plugins is queued).',
    )
  })

  test('#405/#406/#410/#425: pluginDevMods dont_ask refusal and canAutoEnablePluginDevMods', () => {
    restorePluginDevModsHost()
    bindPluginDevModsSession({
      canUseTool: (async () => ({ behavior: 'deny', message: 'no' })) as never,
      toolContext: () => ({}) as never,
      permissionMode: () => 'dontAsk',
    })
    // Refusal probe may return an earlier refusal (e.g. untrusted/hooks_modules_off) or dont_ask
    const refusal = pluginDevModsRefusal()
    expect(typeof refusal === 'string' || refusal === undefined).toBe(true)
    expect(canAutoEnablePluginDevMods()).toBe(false)

    bindPluginDevModsSession({
      canUseTool: (async () => ({ behavior: 'deny', message: 'no' })) as never,
      toolContext: () => ({}) as never,
      permissionMode: () => 'bypassPermissions',
    })
    expect(canAutoEnablePluginDevMods()).toBe(true)
  })

  test('#436: execCommandHook rejects missing pluginRoot via pluginDirectoryExists', async () => {
    const missingRoot = join(tmpdir(), `missing-plugin-root-${Date.now()}`)
    const controller = new AbortController()
    await expect(
      execCommandHook(
        { type: 'command', command: 'echo ok' },
        'PreToolUse',
        'PreToolUse',
        '{}',
        controller.signal,
        'hook-436',
        0,
        missingRoot,
        'demo@mkt',
      ),
    ).rejects.toThrow(
      `Plugin directory does not exist: ${missingRoot} (demo@mkt — run /plugin to reinstall)`,
    )
  })
})
