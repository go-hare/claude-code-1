import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createExplicitToolDeps,
  createToolCallContext,
  getEmptyToolPermissionContext,
  type ToolDeps,
  type ToolPermissionContext,
} from 'src/Tool.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import type { AppState } from 'src/state/AppState.js'
import type { Command } from 'src/types/command.js'
import { listAllCronTasks, removeCronTasks } from 'src/utils/cronTasks.js'
import {
  getSessionCronTasks,
  removeSessionCronTasks,
} from 'src/bootstrap/state.js'
import { DiscoverSkillsTool } from '../DiscoverSkillsTool/DiscoverSkillsTool.js'
import { ListMcpResourcesTool } from '../ListMcpResourcesTool/ListMcpResourcesTool.js'
import { MCPTool } from '../MCPTool/MCPTool.js'
import {
  createMcpAuthTool,
  createMcpCompleteAuthTool,
} from '../McpAuthTool/McpAuthTool.js'
import { McpTaskResumePollingTool } from '../McpTaskResumePollingTool/McpTaskResumePollingTool.js'
import {
  MCP_DIRECTORY_MIME_TYPE,
  MCP_SKILLS_EXTENSION_KEY,
} from '../ReadMcpResourceDirTool/constants.js'
import { ReadMcpResourceDirTool } from '../ReadMcpResourceDirTool/ReadMcpResourceDirTool.js'
import { ReadMcpResourceTool } from '../ReadMcpResourceTool/ReadMcpResourceTool.js'
import { RemoteTriggerTool } from '../RemoteTriggerTool/RemoteTriggerTool.js'
import { CronCreateTool } from '../ScheduleCronTool/CronCreateTool.js'
import { CronDeleteTool } from '../ScheduleCronTool/CronDeleteTool.js'
import { CronListTool } from '../ScheduleCronTool/CronListTool.js'
import { ScheduleWakeupTool } from '../ScheduleWakeupTool/ScheduleWakeupTool.js'
import { SkillTool } from '../SkillTool/SkillTool.js'
import { WaitForMcpServersTool } from '../WaitForMcpServersTool/WaitForMcpServersTool.js'
import { WebBrowserTool } from '../WebBrowserTool/WebBrowserTool.js'
import { WebFetchTool } from '../WebFetchTool/WebFetchTool.js'
import { WebSearchTool } from '../WebSearchTool/WebSearchTool.js'

const DUMMY_HTTP_CONFIG: ScopedMcpServerConfig = {
  type: 'http',
  url: 'https://mcp.example.test',
  scope: 'user',
}

const createdCronIds: string[] = []
const tempDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, val: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (val === undefined) delete process.env[key]
  else process.env[key] = val
}

function makePerms(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...overrides,
  }
}

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  if (createdCronIds.length > 0) {
    await removeCronTasks([...createdCronIds])
    createdCronIds.length = 0
  }
  const loopIds = getSessionCronTasks()
    .filter(t => t.kind === 'loop')
    .map(t => t.id)
  if (loopIds.length > 0) {
    removeSessionCronTasks(loopIds)
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Official 2.1.331 Tool.create(deps) — Bucket 4 (Web, MCP, Cron, Remote & Skills)', () => {
  test('all 17 Bucket 4 tools + both McpAuth builders survive Proxy-probe create(deps) without eager deps access', () => {
    const authTool = createMcpAuthTool('demo', DUMMY_HTTP_CONFIG)
    const completeAuthTool = createMcpCompleteAuthTool(
      'demo',
      DUMMY_HTTP_CONFIG,
    )

    const allTools = [
      WebFetchTool,
      WebSearchTool,
      WebBrowserTool,
      MCPTool,
      authTool,
      completeAuthTool,
      ListMcpResourcesTool,
      ReadMcpResourceTool,
      ReadMcpResourceDirTool,
      WaitForMcpServersTool,
      McpTaskResumePollingTool,
      CronCreateTool,
      CronDeleteTool,
      CronListTool,
      ScheduleWakeupTool,
      RemoteTriggerTool,
      SkillTool,
      DiscoverSkillsTool,
    ]

    const probeDeps = new Proxy({} as ToolDeps, {
      get: () => undefined,
    })

    for (const tool of allTools) {
      expect(typeof tool.create).toBe('function')
      const instance = tool.create!(probeDeps)
      expect(typeof instance.call).toBe('function')
    }

    // WebFetchTool exposes permissionCheckFailureDecision on its factory instance
    const webFetchInst = WebFetchTool.create(probeDeps)
    expect(typeof webFetchInst.permissionCheckFailureDecision).toBe('function')
  })

  test('ListMcpResourcesTool reads explicit deps.mcpResources (all servers, filtered, and unknown server error)', async () => {
    const deps = createExplicitToolDeps({
      mcpResources: {
        docs: [
          {
            uri: 'docs://intro',
            name: 'Intro',
            mimeType: 'text/markdown',
            server: 'docs',
          },
        ],
        wiki: [
          {
            uri: 'wiki://home',
            name: 'Home',
            server: 'wiki',
          },
        ],
      },
    })

    const inst = ListMcpResourcesTool.create(deps)
    const callCtx = createToolCallContext()

    const allRes = await inst.call({}, callCtx)
    expect(allRes.data).toHaveLength(2)
    expect(allRes.data.map(r => r.uri)).toEqual(['docs://intro', 'wiki://home'])

    const filteredRes = await inst.call({ server: 'docs' }, callCtx)
    expect(filteredRes.data).toEqual([
      {
        uri: 'docs://intro',
        name: 'Intro',
        mimeType: 'text/markdown',
        server: 'docs',
      },
    ])

    await expect(inst.call({ server: 'missing' }, callCtx)).rejects.toThrow(
      'Server "missing" not found',
    )
  })

  test('ReadMcpResourceTool reads explicit deps.mcpClients() and forwards callCtx.signal', async () => {
    let seenSignal: AbortSignal | undefined
    const readResource = mock(
      async (params: { uri: string }, opts?: { signal?: AbortSignal }) => {
        seenSignal = opts?.signal
        return {
          contents: [
            {
              uri: params.uri,
              mimeType: 'text/plain',
              text: 'hello from explicit deps',
            },
          ],
        }
      },
    )

    const connected: ConnectedMCPServer = {
      name: 'docs',
      type: 'connected',
      capabilities: { resources: {} },
      config: { type: 'sdk', name: 'docs', scope: 'dynamic' },
      client: { readResource } as unknown as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }

    const deps = createExplicitToolDeps({
      mcpClients: () => [connected],
    })
    const inst = ReadMcpResourceTool.create(deps)
    const ac = new AbortController()
    const res = await inst.call(
      { server: 'docs', uri: 'docs://readme' },
      createToolCallContext({ abortController: ac }),
    )

    expect(seenSignal).toBe(ac.signal)
    expect(res.data.contents).toEqual([
      {
        uri: 'docs://readme',
        mimeType: 'text/plain',
        text: 'hello from explicit deps',
      },
    ])

    await expect(
      inst.call(
        { server: 'nope', uri: 'docs://readme' },
        createToolCallContext(),
      ),
    ).rejects.toThrow('Server "nope" not found')
  })

  test('MCPTool executes directly via create(explicitDeps)', async () => {
    const inst = MCPTool.create(createExplicitToolDeps())
    const callCtx = createToolCallContext()
    expect(await inst.checkPermissions?.({}, callCtx)).toEqual({
      behavior: 'passthrough',
      message: 'MCPTool requires permission.',
    })
    expect(await inst.call({}, callCtx)).toEqual({ data: '' })
  })

  test('createMcpAuthTool and createMcpCompleteAuthTool run directly via create(explicitDeps)', async () => {
    const proxyAuthTool = createMcpAuthTool('my-connector', {
      type: 'claudeai-proxy',
      url: 'https://claude.ai/api/mcp',
      id: 'conn-1',
      scope: 'claudeai',
    })
    const authInst = proxyAuthTool.create(createExplicitToolDeps())
    const callCtx = createToolCallContext()
    expect(await authInst.checkPermissions?.({}, callCtx)).toEqual({
      behavior: 'allow',
      updatedInput: {},
    })
    const authRes = await authInst.call({}, callCtx)
    expect(authRes.data.status).toBe('unsupported')
    expect(authRes.data.message).toContain('/mcp')

    const completeTool = createMcpCompleteAuthTool('my-srv', DUMMY_HTTP_CONFIG)
    const dontAskInst = completeTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'dontAsk' }),
      }),
    )
    const dontAskValid = await dontAskInst.validateInput?.(
      { callback_url: 'http://localhost:9999/cb?code=abc' },
      callCtx,
    )
    expect(dontAskValid).toMatchObject({ result: false, errorCode: 3 })
    const dontAskPerm = await dontAskInst.checkPermissions?.(
      { callback_url: 'http://localhost:9999/cb?code=abc' },
      callCtx,
    )
    expect(dontAskPerm?.behavior).toBe('deny')

    const interactiveInst = completeTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'bypassPermissions' }),
      }),
    )
    const askPerm = await interactiveInst.checkPermissions?.(
      { callback_url: 'http://localhost:9999/cb?code=abc' },
      callCtx,
    )
    expect(askPerm?.behavior).toBe('ask')

    const noFlowCall = await interactiveInst.call(
      { callback_url: 'http://localhost:9999/cb?code=abc' },
      callCtx,
    )
    expect(noFlowCall.data.status).toBe('error')
    expect(noFlowCall.data.message).toContain('No OAuth flow is in progress')
  })

  test('WebFetchTool validateInput, checkPermissions, permissionCheckFailureDecision, and share-URL call work via create(explicitDeps)', async () => {
    const callCtx = createToolCallContext()

    // Explicit deny beats preapproved host
    const denyInst = WebFetchTool.create(
      createExplicitToolDeps({
        permissions: () =>
          makePerms({
            alwaysDenyRules: {
              userSettings: ['WebFetch(domain:docs.claude.com)'],
            },
          }),
      }),
    )
    const denied = await denyInst.checkPermissions?.(
      { url: 'https://docs.claude.com/en/home', prompt: 'read' },
      callCtx,
    )
    expect(denied?.behavior).toBe('deny')

    // Explicit allow rule allows custom domain
    const allowInst = WebFetchTool.create(
      createExplicitToolDeps({
        permissions: () =>
          makePerms({
            alwaysAllowRules: {
              userSettings: ['WebFetch(domain:example.test)'],
            },
          }),
      }),
    )
    const allowed = await allowInst.checkPermissions?.(
      { url: 'https://example.test/page', prompt: 'summarize' },
      callCtx,
    )
    expect(allowed?.behavior).toBe('allow')

    // validateInput checks URL parsing and CLAUDE_CODE_DISABLE_WEB_FETCH
    expect(
      await allowInst.validateInput?.(
        { url: 'not-a-valid-url', prompt: 'p' },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 1 })
    expect(
      await allowInst.validateInput?.(
        { url: 'https://example.test/ok', prompt: 'p' },
        callCtx,
      ),
    ).toEqual({ result: true })

    setEnv('CLAUDE_CODE_DISABLE_WEB_FETCH', '1')
    expect(
      await allowInst.validateInput?.(
        { url: 'https://example.test/ok', prompt: 'p' },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 2 })
    setEnv('CLAUDE_CODE_DISABLE_WEB_FETCH', undefined)

    // permissionCheckFailureDecision denies unexpected hook-injected keys
    const failDecision = allowInst.permissionCheckFailureDecision?.(
      {
        url: 'https://example.test/ok',
        prompt: 'p',
        unexpectedKey: 1,
      } as never,
      callCtx,
    )
    expect(failDecision?.behavior).toBe('deny')
    expect(
      allowInst.permissionCheckFailureDecision?.(
        { url: 'https://example.test/ok', prompt: 'p' },
        callCtx,
      ),
    ).toBeUndefined()

    // Direct call on claude.ai share URL returns Not Fetched without network
    const shareRes = await allowInst.call(
      {
        url: 'https://claude.ai/share/11111111-2222-4333-8444-555555555555',
        prompt: 'read',
      },
      callCtx,
    )
    expect(shareRes.data.codeText).toBe('Not Fetched')
    expect(shareRes.data.result).toContain('shared claude.ai chat')
  })

  test('WebSearchTool validateInput, checkPermissions, and taskRegistry budget cap work via create(explicitDeps)', async () => {
    const fakeRegistry = {
      getWebSearchBudget: () => ({
        tryConsume: () => false,
        msUntilNextCall: () => 5000,
        refillsPerHour: () => 0,
      }),
    }
    const inst = WebSearchTool.create(
      createExplicitToolDeps({
        taskRegistry: fakeRegistry as unknown as ToolDeps['taskRegistry'],
      }),
    )
    const callCtx = createToolCallContext()

    expect(await inst.validateInput?.({ query: '' }, callCtx)).toMatchObject({
      result: false,
      errorCode: 1,
    })
    expect(
      await inst.validateInput?.(
        {
          query: 'bun test',
          allowed_domains: ['a.com'],
          blocked_domains: ['b.com'],
        },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 2 })
    expect(await inst.validateInput?.({ query: 'bun test' }, callCtx)).toEqual({
      result: true,
    })

    expect(
      await inst.checkPermissions?.({ query: 'bun test' }, callCtx),
    ).toMatchObject({
      behavior: 'passthrough',
    })

    const capped = await inst.call({ query: 'bun test' }, callCtx)
    expect(capped.data.results[0]).toContain('web search budget is used up')
  })

  test('WebBrowserTool executes navigate & screenshot directly via create(explicitDeps)', async () => {
    const origFetch = globalThis.fetch
    let seenSignal: AbortSignal | undefined
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenSignal = init?.signal ?? undefined
      const url = typeof input === 'string' ? input : input.toString()
      const res = new Response(
        '<html><head><title>DI Test</title></head><body>Hello DI</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
      Object.defineProperty(res, 'url', { value: url, configurable: true })
      return res
    }) as typeof fetch

    try {
      const inst = WebBrowserTool.create(createExplicitToolDeps())
      const ac = new AbortController()
      const res = await inst.call(
        { url: 'https://example.test/di', action: 'screenshot' },
        createToolCallContext({ abortController: ac }),
      )
      expect(seenSignal).toBe(ac.signal)
      expect(res.data.title).toBe('DI Test')
      expect(res.data.content).toContain('Text snapshot')
      expect(res.data.content).toContain('Hello DI')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test('ReadMcpResourceDirTool reads deps.mcpClients() and lists directory children directly', async () => {
    const connected: ConnectedMCPServer = {
      name: 'docs',
      type: 'connected',
      capabilities: {
        extensions: { [MCP_SKILLS_EXTENSION_KEY]: { directoryRead: true } },
      } as ConnectedMCPServer['capabilities'],
      config: { type: 'sdk', name: 'docs', scope: 'dynamic' },
      client: {
        request: mock(async () => ({
          resources: [
            {
              uri: 'docs://root/sub',
              name: 'sub',
              mimeType: MCP_DIRECTORY_MIME_TYPE,
            },
          ],
        })),
      } as unknown as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }

    const inst = ReadMcpResourceDirTool.create(
      createExplicitToolDeps({ mcpClients: () => [connected] }),
    )
    const res = await inst.call(
      { server: 'docs', uri: 'docs://root' },
      createToolCallContext(),
    )
    expect(res.data.error).toBeUndefined()
    expect(res.data.resources).toEqual([
      {
        uri: 'docs://root/sub',
        name: 'sub',
        mimeType: MCP_DIRECTORY_MIME_TYPE,
      },
    ])
  })

  test('WaitForMcpServersTool polls explicit deps.mcpClients() directly', async () => {
    const clients: MCPServerConnection[] = [
      {
        name: 'github',
        type: 'connected',
        capabilities: {},
        config: DUMMY_HTTP_CONFIG,
        client: {} as ConnectedMCPServer['client'],
        cleanup: async () => {},
      },
    ]

    const inst = WaitForMcpServersTool.create(
      createExplicitToolDeps({ mcpClients: () => clients }),
    )
    const res = await inst.call(
      { servers: ['github'] },
      createToolCallContext(),
    )
    expect(res.data.ready).toBe(true)
    expect(res.data.connected).toEqual(['github'])
  })

  test('McpTaskResumePollingTool runs directly via create(explicitDeps)', async () => {
    const inst = McpTaskResumePollingTool.create(
      createExplicitToolDeps({
        tasks: () => ({}),
        mcpClients: () => [],
      }),
    )
    const res = await inst.call(
      { task_id: 'mcp-task-missing' },
      createToolCallContext(),
    )
    expect(res.data.isError).toBe(true)
    expect(typeof res.data.message).toBe('string')
  })

  test('CronCreateTool, CronListTool, and CronDeleteTool work end-to-end via create(explicitDeps)', async () => {
    const autoCreateInst = CronCreateTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'auto' }),
      }),
    )
    const callCtx = createToolCallContext()
    expect(
      await autoCreateInst.checkPermissions?.(
        { cron: '*/5 * * * *', prompt: 'ping' },
        callCtx,
      ),
    ).toMatchObject({ behavior: 'passthrough' })

    const createInst = CronCreateTool.create(
      createExplicitToolDeps({
        hookCaller: 'di-plugin',
        permissions: () => makePerms({ mode: 'default' }),
      }),
    )
    expect(
      await createInst.validateInput?.(
        { cron: 'not-cron', prompt: 'ping' },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 1 })
    expect(
      await createInst.validateInput?.(
        { cron: '*/5 * * * *', prompt: 'ping' },
        callCtx,
      ),
    ).toEqual({ result: true })

    const created = await createInst.call(
      {
        cron: '*/5 * * * *',
        prompt: 'di ping',
        recurring: true,
        durable: false,
      },
      callCtx,
    )
    createdCronIds.push(created.data.id)
    expect(created.data.id.length).toBeGreaterThan(0)
    const allSaved = await listAllCronTasks()
    expect(allSaved.find(t => t.id === created.data.id)?.plugin).toBe(
      'di-plugin',
    )

    // CronListTool via create(explicitDeps)
    const listInst = CronListTool.create(createExplicitToolDeps())
    const listed = await listInst.call({}, callCtx)
    expect(listed.data.jobs.some(j => j.id === created.data.id)).toBe(true)

    // CronDeleteTool via create(explicitDeps)
    const delInst = CronDeleteTool.create(createExplicitToolDeps())
    expect(
      await delInst.validateInput?.({ id: 'nonexistent-cron-id' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 1 })
    expect(
      await delInst.validateInput?.({ id: created.data.id }, callCtx),
    ).toEqual({ result: true })

    const deleted = await delInst.call({ id: created.data.id }, callCtx)
    expect(deleted.data.id).toBe(created.data.id)
    createdCronIds.length = 0
  })

  test('ScheduleWakeupTool checkPermissions and arm/stop call work via create(explicitDeps)', async () => {
    const callCtx = createToolCallContext({ toolUseId: 'tu_wakeup_di_1' })

    const autoInst = ScheduleWakeupTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'auto' }),
      }),
    )
    expect(
      await autoInst.checkPermissions?.({ stop: true }, callCtx),
    ).toMatchObject({ behavior: 'passthrough' })

    const inst = ScheduleWakeupTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'default' }),
      }),
    )
    expect(
      await inst.checkPermissions?.({ stop: true }, callCtx),
    ).toMatchObject({ behavior: 'allow' })

    const armed = await inst.call(
      { delaySeconds: 15, reason: 'check ci', prompt: 'poll ci' },
      callCtx,
    )
    expect(armed.data.wasClamped).toBe(true)
    expect(armed.data.clampedDelaySeconds).toBe(60)
    expect(armed.data.scheduledFor).toBeGreaterThan(Date.now())

    const stopped = await inst.call({ stop: true }, callCtx)
    expect(stopped.data.stopped).toBe(true)
    expect(stopped.data.cancelledWakeups).toBeGreaterThanOrEqual(1)
  })

  test('RemoteTriggerTool checkPermissions reads deps.permissions() directly via create(explicitDeps)', async () => {
    const callCtx = createToolCallContext()
    const autoInst = RemoteTriggerTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'auto' }),
      }),
    )
    expect(
      await autoInst.checkPermissions?.(
        { action: 'run', trigger_id: 'tr_1' },
        callCtx,
      ),
    ).toEqual({
      behavior: 'passthrough',
      message: 'Remote trigger management requires classifier review.',
    })

    const defaultInst = RemoteTriggerTool.create(
      createExplicitToolDeps({
        permissions: () => makePerms({ mode: 'default' }),
      }),
    )
    expect(
      await defaultInst.checkPermissions?.({ action: 'list' }, callCtx),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { action: 'list' },
    })
  })

  test('SkillTool validateInput, checkPermissions, and inline call work via create(explicitDeps) with ZERO ToolUseContext', async () => {
    const inlineSkill = {
      type: 'prompt' as const,
      name: 'di-test-skill',
      description: 'Test skill injected via explicit deps',
      isHidden: false,
      progressMessage: 'running di-test-skill',
      userFacingName: () => 'di-test-skill',
      source: 'userSettings' as const,
      loadedFrom: 'mcp' as const,
      getPromptForCommand: async (args: string) => [
        { type: 'text' as const, text: `Skill body executed with: ${args}` },
      ],
    } as unknown as Command

    const disabledSkill = {
      type: 'prompt' as const,
      name: 'di-disabled-skill',
      description: 'Disabled skill',
      isHidden: false,
      progressMessage: 'running',
      userFacingName: () => 'di-disabled-skill',
      source: 'userSettings' as const,
      loadedFrom: 'mcp' as const,
      disableModelInvocation: true,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const baseState = {
      toolPermissionContext: makePerms({
        alwaysDenyRules: { userSettings: ['Skill(blocked-skill)'] },
      }),
      tasks: {},
      todos: {},
      mcp: {
        clients: [],
        tools: [],
        commands: [inlineSkill, disabledSkill],
        resources: {},
      },
    } as unknown as AppState

    const deps = createExplicitToolDeps({
      getAppState: () => baseState,
      permissions: () => baseState.toolPermissionContext,
    })
    const inst = SkillTool.create(deps)
    const callCtx = createToolCallContext({ toolUseId: 'tu_skill_di_1' })

    expect(await inst.validateInput?.({ skill: '   ' }, callCtx)).toMatchObject(
      { result: false, errorCode: 1 },
    )
    expect(
      await inst.validateInput?.(
        { skill: 'nonexistent-di-skill-xyz' },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 2 })
    expect(
      await inst.validateInput?.({ skill: 'di-disabled-skill' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 4 })
    expect(
      await inst.validateInput?.({ skill: 'di-test-skill' }, callCtx),
    ).toEqual({ result: true })

    // Deny rule honored via deps.permissions()
    expect(
      await inst.checkPermissions?.({ skill: 'blocked-skill' }, callCtx),
    ).toMatchObject({ behavior: 'deny' })

    // Safe-property MCP skill auto-allowed
    expect(
      await inst.checkPermissions?.({ skill: 'di-test-skill' }, callCtx),
    ).toMatchObject({ behavior: 'allow' })

    // Direct inline execution without parentMessage or ToolUseContext
    const execRes = await inst.call(
      { skill: 'di-test-skill', args: 'hello' },
      callCtx,
    )
    expect(execRes.data).toMatchObject({
      success: true,
      commandName: 'di-test-skill',
    })
    expect(execRes.newMessages && execRes.newMessages.length > 0).toBe(true)
  })

  test('DiscoverSkillsTool reads explicit deps.cwd() directly via create(explicitDeps)', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'discover-skills-di-'))
    tempDirs.push(emptyDir)

    const inst = DiscoverSkillsTool.create(
      createExplicitToolDeps({ cwd: () => emptyDir }),
    )
    const res = await inst.call(
      { description: 'deploy cloudflare worker', limit: 3 },
      createToolCallContext(),
    )
    expect(Array.isArray(res.data.results)).toBe(true)
    expect(res.data.count).toBe(res.data.results.length)
  })
})
