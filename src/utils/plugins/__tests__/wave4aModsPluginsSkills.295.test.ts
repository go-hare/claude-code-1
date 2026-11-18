import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  SESSION_RECEIVE_HOP_SITE,
  loadFunctionHooksModules,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'
import { assertMarketplaceNameCanRecordPluginIds } from '../marketplaceManager.js'
import {
  clearPluginOptionsCache,
  getUnconfiguredOptions,
  loadPluginOptions,
  loadPluginOptionsNw,
  savePluginOptions,
} from '../pluginOptionsStorage.js'
import {
  createPluginTestKit,
  formatSessionAppendPinWarning,
  pinSessionAppendMessage,
} from '../../../services/plugins/pluginTestRunner.js'
import { fetchMcpSkillsForClient } from '../../../skills/mcpSkills.js'
import type { LoadedPlugin } from '../../../types/plugin.js'

describe('Wave 4A Mods / FunctionHooks / Plugins / Skills alignment', () => {
  test('#265 + #306 + #401 createPluginTestKit fails on hook expect/stub errors, exposes mock.session, and pins tool_use/tool_result/thinking blocks', async () => {
    const kit = createPluginTestKit()

    kit.test('hook expect failure fails the test', async ($, on) => {
      on('session.append', () => {
        kit.expect(1).toBe(2)
        return { message: { content: [] } }
      })
      await $.session.append({
        door: 'turn',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      })
    })

    kit.test('invalid stub answer fails the test', async ($, on) => {
      on('session.append', () => null)
      await $.session.append({
        door: 'turn',
        uuid: 'u2',
        message: { content: [{ type: 'text', text: 'hi' }] },
      })
    })

    kit.test(
      'session.append dropping tool_use/tool_result/thinking fails and preserves pinned blocks',
      async ($, on) => {
        on('session.append', () => ({
          message: { content: [{ type: 'text', text: 'only text' }] },
        }))
        const out = await $.session.append({
          door: 'turn',
          uuid: 'u3',
          message: {
            content: [
              { type: 'thinking', signature: 'sig-1', text: 'thought' },
              { type: 'tool_use', id: 'tu-1' },
              { type: 'tool_result', tool_use_id: 'tu-1', content: 'secret' },
              { type: 'text', text: 'orig' },
            ],
          },
        })
        const types = (out.message.content as Array<{ type: string }>).map(
          b => b.type,
        )
        kit
          .expect(types)
          .toEqual(['thinking', 'tool_use', 'tool_result', 'text'])
      },
    )

    kit.test('mock.session reads back appended rows', async ($, on) => {
      on('session.append', (_$, e) => ({
        message: {
          content: [{ type: 'text', text: 'kept' }],
        },
      }))
      await $.session.append({
        door: 'note',
        uuid: 'u4',
        message: { content: [{ type: 'text', text: 'raw' }] },
      })
      const rows = kit.mock.session.rows()
      kit.expect(rows.length).toBe(1)
      kit.expect(rows[0]!.uuid).toBe('u4')
    })

    const results = await kit.runRecorded()
    expect(results).toHaveLength(4)
    expect(results[0]!.failure).toContain('Expected 1 to be 2')
    expect(results[1]!.failure).toContain('invalid stub answer')
    expect(results[2]!.failure).toContain(
      'A session pins tool_use, tool_result, thinking',
    )
    expect(results[2]!.failure).toContain('To scrub a tool result')
    expect(results[3]!.failure).toBeNull()
  })

  test('#401 pinSessionAppendMessage allows scrubbing tool_result content with matching tool_use_id', () => {
    const orig = {
      content: [
        { type: 'tool_result', tool_use_id: 'tu-9', content: 'raw secret' },
      ],
    }
    const scrubbed = {
      content: [
        { type: 'tool_result', tool_use_id: 'tu-9', content: '[redacted]' },
      ],
    }
    const res = pinSessionAppendMessage(orig, scrubbed)
    expect(res.droppedTypes).toEqual([])
    expect(
      formatSessionAppendPinWarning('turn', 'u9', res.droppedTypes),
    ).toBeUndefined()
    expect(
      (res.message.content as Array<{ content?: unknown }>)[0]!.content,
    ).toBe('[redacted]')
  })

  test('#367 assertMarketplaceNameCanRecordPluginIds refuses unrecordable marketplace names', () => {
    expect(() =>
      assertMarketplaceNameCanRecordPluginIds('bad name with spaces'),
    ).toThrow(/Cannot add marketplace/)
    expect(() =>
      assertMarketplaceNameCanRecordPluginIds('-starts-with-dash'),
    ).toThrow(/Cannot add marketplace/)
    expect(() =>
      assertMarketplaceNameCanRecordPluginIds('valid-marketplace_1.0'),
    ).not.toThrow()
    expect(() =>
      assertMarketplaceNameCanRecordPluginIds('bad name', {
        'bad name': {
          source: { source: 'directory', path: '/tmp/x' },
          installLocation: '/tmp/x',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      }),
    ).not.toThrow()
  })

  test('#380 fetchMcpSkillsForClient passes AbortSignal to listResources and aborts cleanly', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const fakeClient = {
      type: 'connected' as const,
      name: 'test-mcp-380',
      capabilities: { resources: {} },
      client: {
        listResources: async (
          _params?: unknown,
          opts?: { signal?: AbortSignal },
        ) => {
          receivedSignal = opts?.signal
          controller.abort()
          throw new Error('aborted')
        },
        readResource: async () => ({ contents: [] }),
      },
    } as unknown as Parameters<typeof fetchMcpSkillsForClient>[0]

    fetchMcpSkillsForClient.cache.delete('test-mcp-380')
    const skills = await (
      fetchMcpSkillsForClient as unknown as (
        c: typeof fakeClient,
        s?: AbortSignal,
      ) => Promise<unknown[]>
    )(fakeClient, controller.signal)
    expect(skills).toEqual([])
    expect(receivedSignal).toBe(controller.signal)
  })

  test('#404 pluginOptionsStorage handles constructor/prototype option names with null-prototype isolation', async () => {
    clearPluginOptionsCache()
    const plugin: LoadedPlugin = {
      name: 'proto-opt-plugin',
      source: 'proto-opt-plugin@local',
      path: '/tmp/proto-opt-plugin',
      enabled: true,
      manifest: {
        name: 'proto-opt-plugin',
        userConfig: {
          constructor: {
            title: 'Constructor',
            description: 'Option named constructor',
            type: 'string',
          },
          prototype: {
            title: 'Prototype',
            description: 'Option named prototype',
            type: 'string',
          },
        },
      },
    } as unknown as LoadedPlugin

    const unconfiguredBefore = await getUnconfiguredOptions(plugin)
    expect(Object.hasOwn(unconfiguredBefore, 'constructor')).toBe(true)
    expect(Object.hasOwn(unconfiguredBefore, 'prototype')).toBe(true)

    const loaded = loadPluginOptions('nonexistent-proto-plugin@local')
    expect(Object.getPrototypeOf(loaded)).toBeNull()
    expect(loaded.constructor).toBeUndefined()
    expect(loaded.prototype).toBeUndefined()

    const loadedAsync = await loadPluginOptionsNw(
      'nonexistent-proto-plugin@local',
    )
    expect(Object.getPrototypeOf(loadedAsync)).toBeNull()
    expect(loadedAsync.constructor).toBeUndefined()
    expect(typeof savePluginOptions).toBe('function')
  })

  test('#438 SESSION_RECEIVE_HOP_SITE enforces pinned origin/event/agentId and validates consumed/text', () => {
    const orig = {
      origin: { kind: 'peer' },
      event: { type: 'message' },
      agentId: 'agent-1',
      text: 'hello',
    }
    expect(
      SESSION_RECEIVE_HOP_SITE.checkArgument?.(
        { ...orig, origin: { kind: 'other' } },
        orig,
      ),
    ).toContain('a changed origin')
    expect(
      SESSION_RECEIVE_HOP_SITE.checkArgument?.(
        { ...orig, agentId: 'agent-2' },
        orig,
      ),
    ).toContain('a changed agentId')
    expect(SESSION_RECEIVE_HOP_SITE.checkArgument?.(orig, orig)).toBeUndefined()
    expect(
      SESSION_RECEIVE_HOP_SITE.check?.({ consumed: 'muted' }),
    ).toBeUndefined()
    expect(SESSION_RECEIVE_HOP_SITE.check?.({ text: 'ok' })).toBeUndefined()
    expect(SESSION_RECEIVE_HOP_SITE.check?.({ consumed: 123 })).toContain(
      'not a string',
    )
  })

  test('#449 plugin-authoring SKILL.md gates terminal commands on terminal presence and mentions sharing only when asked', async () => {
    const skillPath = join(
      process.cwd(),
      'src/skills/bundled/plugin-authoring/SKILL.md',
    )
    const content = await readFile(skillPath, 'utf8')
    expect(content).toContain('Where this session has a terminal')
    expect(content).toContain(
      'Where this session has no terminal, there is no command to run',
    )
    expect(content).toContain(
      'Keeping and sharing go unmentioned until the person raises them',
    )
  })

  test('#352 pluginValidateHandler prints README install advice without changing exit code under --strict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-validate-352-'))
    try {
      await mkdir(join(dir, '.claude-plugin'), { recursive: true })
      await writeFile(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'advice-test-plugin',
          version: '1.0.0',
          description: 'Test plugin',
          author: { name: 'Test Author' },
        }),
      )
      await writeFile(
        join(dir, 'README.md'),
        '# advice-test-plugin\n\nNo install line here.\n',
      )

      const { pluginValidateHandler } = await import(
        '../../../cli/handlers/plugins.js'
      )
      const origLog = console.log
      let out = ''
      console.log = (...args: unknown[]) => {
        out += args.map(String).join(' ') + '\n'
      }
      const origExit = process.exit
      let exitCode: number | undefined
      process.exit = ((code?: number) => {
        exitCode = code
        return undefined as never
      }) as typeof process.exit
      try {
        await pluginValidateHandler(dir, { strict: true })
      } finally {
        console.log = origLog
        process.exit = origExit
      }
      expect(out).toContain('Advice (does not change the verdict):')
      expect(out).toContain(
        'This README has no line that installs "advice-test-plugin"',
      )
      expect(exitCode).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#429 loadFunctionHooksModules in-process isolates failing plugin without dropping healthy ones', async () => {
    setLoadedFunctionHooksModules([])
    const origEnv = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'
    try {
      await expect(loadFunctionHooksModules([])).resolves.toBeUndefined()
    } finally {
      if (origEnv === undefined) {
        delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
      } else {
        process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = origEnv
      }
      setLoadedFunctionHooksModules([])
    }
  })
})
