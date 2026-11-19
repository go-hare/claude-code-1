import { afterEach, describe, expect, test } from 'bun:test'
import { zipSync } from 'fflate'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isEngineConfirmationAsk,
  registerEngineConfirmQuestion,
} from '../../../components/PluginRasterPanes.js'
import {
  checkPluginHandoverBeforeSend,
  compareFileIdentity,
  inspectPluginHandoverArchive,
  isPluginAuthoringChatSession,
  PLUGIN_HANDOVER_CHECK_SOURCE,
  registerPluginAuthoringHooks,
} from '../../../plugins/bundled/pluginAuthoring.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
  checkMcpToolRemovedByPlugin,
  flushHeadlessInlineModStderr,
  getLoadedFunctionHooksModules,
  getPluginToolListState,
  invalidatePluginToolList,
  isToolRemovedByPlugin,
  matcherAllows,
  recordPluginToolListAnswer,
  reportHeadlessInlineModStderr,
  resetHeadlessInlineModStderrState,
  resetPluginToolListState,
  runFunctionHookChain,
  setHeadlessPluginOutputFormat,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'
import {
  createDevModStampTracker,
  createDevModWatchHandlers,
  isRelevantModWatchFile,
} from '../pluginDevMods.js'

afterEach(() => {
  resetPluginToolListState()
  resetHeadlessInlineModStderrState()
})

describe('Wave 323 Group 5B — Mods, Function Hooks, Panes & Handover Checks', () => {
  test('#2039 engine confirmation AskUserQuestion cannot be matched or reworded by mods', () => {
    expect(isEngineConfirmationAsk('confirm_123')).toBe(true)
    expect(isEngineConfirmationAsk('req-1', 'mod_hot_reload')).toBe(true)
    expect(isEngineConfirmationAsk('req-2', PLUGIN_HANDOVER_CHECK_SOURCE)).toBe(
      true,
    )
    const unregister = registerEngineConfirmQuestion('custom-confirm-id')
    expect(isEngineConfirmationAsk('custom-confirm-id')).toBe(true)
    unregister()
    expect(isEngineConfirmationAsk('custom-confirm-id')).toBe(false)

    // Non-builtin mod ui.render matcher blocked for engine confirmation AskUserQuestion
    expect(
      matcherAllows(
        undefined,
        {
          component: 'AskUserQuestion',
          props: { metadataSource: 'mod_hot_reload' },
        },
        'ui.render',
        false,
      ),
    ).toBe(false)
    expect(
      matcherAllows(
        undefined,
        { component: 'AskUserQuestion', requestId: 'confirm_abc' },
        'ui.render',
        false,
      ),
    ).toBe(false)
    expect(
      matcherAllows(
        undefined,
        { component: 'AskUserQuestion', requestId: 'normal-ask' },
        'ui.render',
        false,
      ),
    ).toBe(true)
  })

  test('#2040 mod hot reload resumes watching newly created files after a failed reload', async () => {
    const tracked = new Set(['/mods/demo/hooks.ts'])
    const manifests = new Set(['/mods/demo/hooks.json'])

    expect(
      isRelevantModWatchFile('/mods/demo/helper.ts', manifests, tracked, false),
    ).toBe(false)
    expect(
      isRelevantModWatchFile('/mods/demo/helper.ts', manifests, tracked, true),
    ).toBe(true)

    let reloads = 0
    const tracker = createDevModStampTracker()
    const handlers = createDevModWatchHandlers(
      tracker,
      () => {
        reloads += 1
      },
      async () => ({
        ctimeMs: 1000,
        stamp: { size: 10, hash: 'deadbeef' },
      }),
      {
        manifests,
        getTrackedFiles: () => tracked,
        isReloadFailed: () => true,
      },
    )
    await handlers.onFileChange('/mods/demo/new-file.ts')
    expect(reloads).toBe(1)
  })

  test('#2053 headless text-output claude -p reports --plugin-dir mod crash/unload on stderr', () => {
    const writes: string[] = []
    setHeadlessPluginOutputFormat('text')
    reportHeadlessInlineModStderr(
      { name: 'broken-mod', source: 'broken-mod@inline' },
      'broken-mod was unloaded: hook threw',
      { isNonInteractive: true, write: text => writes.push(text) },
    )
    expect(writes.length).toBe(1)
    expect(writes[0]).toContain('broken-mod')

    // Non-text headless format does not write stderr
    writes.length = 0
    setHeadlessPluginOutputFormat('json')
    reportHeadlessInlineModStderr(
      { name: 'broken-mod', source: 'broken-mod@inline' },
      'should be suppressed in json mode',
      { isNonInteractive: true, write: text => writes.push(text) },
    )
    expect(writes.length).toBe(0)
    flushHeadlessInlineModStderr(text => writes.push(text))
    expect(writes.length).toBe(0)
  })

  test('#2183 engine.create wildcard/namespace/negated hooks are observer-only', async () => {
    const prev = [...getLoadedFunctionHooksModules()]
    let observed = false
    try {
      setLoadedFunctionHooksModules([
        {
          name: 'observer-mod',
          root: '/tmp/observer-mod',
          patterns: ['engine.*'],
          hooks: [
            {
              pattern: 'engine.*',
              matcher: undefined,
              hook: async (
                _api: unknown,
                e: unknown,
                next: (arg: unknown) => Promise<unknown>,
              ) => {
                observed = true
                await next(e)
                return { core: 'hijacked', injected: true }
              },
            },
          ],
        } as never,
      ])
      const result = await runFunctionHookChain(
        'engine.create',
        {},
        async () => ({ core: 'original' }),
      )
      expect(observed).toBe(true)
      expect(result).toEqual({ core: 'original' })
    } finally {
      setLoadedFunctionHooksModules(prev)
    }
  })

  test('#2188 tool.list plugin hook answers filter model & subagent tools and deny rules', () => {
    recordPluginToolListAnswer(['Bash', 'Read', 'mcp__srv__run'], ['Read'])
    expect(getPluginToolListState().answer).not.toBeNull()
    expect(isToolRemovedByPlugin({ name: 'Bash' })).toBe(true)
    expect(isToolRemovedByPlugin({ name: 'Read' })).toBe(false)

    const tools = [{ name: 'Bash' }, { name: 'Read' }, { name: 'Glob' }]
    expect(applyPluginToolListFilter(tools).map(t => t.name)).toEqual([
      'Read',
      'Glob',
    ])

    // #2188: when no tool in the list is removed, return the exact same array reference
    const unaffected = [{ name: 'Read' }, { name: 'Glob' }]
    expect(applyPluginToolListFilter(unaffected)).toBe(unaffected)

    // #2188: fast path when no tool.list mod has removed/added anything returns exact reference
    resetPluginToolListState()
    expect(applyPluginToolListFilter(tools)).toBe(tools)
    // Restore state for remaining assertions below
    recordPluginToolListAnswer(['Bash', 'Read', 'mcp__srv__run'], ['Read'])

    const updatedPerm = applyPluginToolListDenyRules({
      alwaysDenyRules: { session: ['WebFetch'] },
    })
    expect(updatedPerm.alwaysDenyRules?.session).toContain('Bash')
    expect(updatedPerm.alwaysDenyRules?.session).toContain('WebFetch')
    expect(checkMcpToolRemovedByPlugin('srv', 'run')).toBeDefined()
    expect(checkMcpToolRemovedByPlugin('srv', 'other')).toBeUndefined()

    invalidatePluginToolList()
    expect(getPluginToolListState().isInvalidated).toBe(true)
  })

  test('#2190 pre-send secret check inspects .plugin archives, asks on secrets, detects mid-ask file change', async () => {
    expect(
      isPluginAuthoringChatSession({ CLAUDE_CODE_ENTRYPOINT: 'remote_cowork' }),
    ).toBe(true)
    expect(
      isPluginAuthoringChatSession({
        CLAUDE_CODE_SESSION_ORIGIN: 'claude_ai_chat',
      }),
    ).toBe(true)
    expect(isPluginAuthoringChatSession({})).toBe(false)

    const dir = await mkdtemp(join(tmpdir(), 'w323-handover-'))
    try {
      const cleanPath = join(dir, 'clean.plugin')
      const cleanZip = zipSync({
        '.claude-plugin/plugin.json': new TextEncoder().encode(
          '{"name":"clean"}',
        ),
        'index.ts': new TextEncoder().encode('export const x = 1\n'),
      })
      await writeFile(cleanPath, cleanZip)
      const cleanRes = await inspectPluginHandoverArchive(cleanPath)
      expect(cleanRes.kind).toBe('clean')

      const leakyPath = join(dir, 'leaky.plugin')
      const fakeKey = `sk-ant-${'a'.repeat(45)}`
      const leakyZip = zipSync({
        '.claude-plugin/plugin.json': new TextEncoder().encode(
          '{"name":"leaky"}',
        ),
        'config.ts': new TextEncoder().encode(`const k = "${fakeKey}"\n`),
      })
      await writeFile(leakyPath, leakyZip)
      const leakyRes = await inspectPluginHandoverArchive(leakyPath)
      expect(leakyRes.kind).toBe('ask')
      if (leakyRes.kind === 'ask') {
        expect(leakyRes.question).toContain('may contain a secret key')
      }

      const refused = await checkPluginHandoverBeforeSend([leakyPath], {
        askUser: async req => {
          expect(req.source).toBe(PLUGIN_HANDOVER_CHECK_SOURCE)
          return { kind: 'chose', value: 'hold' }
        },
      })
      expect(refused).toContain('Nothing in this call was sent:')
      expect(refused).toContain('did not choose to')

      const allowed = await checkPluginHandoverBeforeSend([leakyPath], {
        askUser: async () => ({ kind: 'chose', value: 'send' }),
      })
      expect(allowed).toBeUndefined()

      const changed = await checkPluginHandoverBeforeSend([leakyPath], {
        askUser: async () => {
          await writeFile(
            leakyPath,
            Buffer.concat([leakyZip, Buffer.from('x')]),
          )
          return { kind: 'chose', value: 'send' }
        },
      })
      expect(changed).toContain('changed while the person was being asked')

      const bogusPath = join(dir, 'bogus.plugin')
      await writeFile(bogusPath, 'not a zip file')
      const bogusRes = await inspectPluginHandoverArchive(bogusPath)
      expect(bogusRes.kind).toBe('refused')

      expect(
        compareFileIdentity(
          { dev: 1, ino: 2, size: 10, mtimeMs: 100, ctimeMs: 100 },
          { dev: 1, ino: 2, size: 11, mtimeMs: 100, ctimeMs: 100 },
        ),
      ).toBe('size')

      const registered: Array<{
        event: string
        matcher: unknown
        handler: unknown
      }> = []
      registerPluginAuthoringHooks(
        (event, matcher, handler) => {
          registered.push({ event, matcher, handler })
        },
        () => undefined,
        {
          isChatSession: () => true,
          askUser: async () => ({ kind: 'chose', value: 'hold' }),
        },
      )
      const sendHook = registered.find(
        r =>
          r.event === 'tool.call' &&
          typeof r.matcher === 'object' &&
          r.matcher !== null &&
          (r.matcher as { tool?: string }).tool === 'SendUserFile',
      )
      expect(sendHook).toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
