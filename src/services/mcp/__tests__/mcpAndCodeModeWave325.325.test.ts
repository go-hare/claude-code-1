import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attachHeadlessRemoteMcpReconnect } from '../headlessMcpReconnect.js'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
} from '../../../bootstrap/state.js'
import {
  buildMcpTaskWaitingForAnswerNotification,
  hasMcpTaskNeedingInput,
  isDeferredTaskElicitation,
  isMcpTaskWaitingForAnswerNotification,
  MCP_TASK_DEFERRED_CANCEL,
  McpTaskQuestionController,
  McpTaskQuestionNoticeTracker,
  markDeferredTaskElicitation,
  setMcpTaskQuestionState,
  type McpTaskState,
} from '../../../tasks/McpTask/McpTask.js'
import {
  didSessionEndDuringCodeModeScript,
  expandCodeModePath,
  extractApprovalUserFeedback,
  extractEnteredWorktreePath,
  normalizeCodeModeToolInput,
  planCodeModeFromSession,
  syncExpiredMcpAuthInCodeMode,
  wrapReplToolForCodeMode,
} from '../../codeMode/executor.js'
import {
  clearTransientMcpRefreshFailure,
  emitMcpAuthRecovered,
  getServerKey,
  hasRecentTransientMcpRefreshFailure,
  markTransientMcpRefreshFailure,
  subscribeMcpAuthRecovered,
} from '../auth.js'
import {
  getConnectedClientWiring,
  notifyMcpServerConnected,
  onMcpServerConnected,
  registerConnectedClientWiring,
  registerMcpToolsSwapper,
  swapMcpServerTools,
} from '../client.js'
import {
  addScopeToServers,
  canonicalizeRemoteConnectorSignature,
  dedupPluginMcpServers,
  getMcpServerSignature,
  isAutoConnectMcpTransport,
  isCloudPluginStartupPending,
  mergeFolderOwnedMcpConfigs,
  setCloudPluginStartupPending,
  shouldHoldConnectorApprovalWhilePluginsLoading,
} from '../config.js'
import { handleRemoteAuthFailure, McpAuthError } from '../connectionHelpers.js'
import {
  getElicitationCueBehindDraft,
  isBackgroundMcpTaskElicitation,
} from '../elicitationHandler.js'
import type { ConnectedMCPServer, ScopedMcpServerConfig } from '../types.js'

describe('Wave 325 Group 3 — MCP & Code Mode', () => {
  const prevCwd = getCwdState()
  const prevRemote = process.env.CLAUDE_CODE_REMOTE

  afterEach(() => {
    setCwdState(prevCwd)
    setCloudPluginStartupPending(false)
    if (prevRemote === undefined) {
      delete process.env.CLAUDE_CODE_REMOTE
    } else {
      process.env.CLAUDE_CODE_REMOTE = prevRemote
    }
    registerConnectedClientWiring(undefined)
    registerMcpToolsSwapper(undefined)
  })

  test('#2301 canonicalizes equivalent Atlassian/Asana/Sentry remote connector URLs', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const atlassian1 = canonicalizeRemoteConnectorSignature(
      getMcpServerSignature({
        type: 'http',
        url: 'https://mcp.atlassian.com/v1/mcp',
      })!,
      true,
    )
    const atlassian2 = canonicalizeRemoteConnectorSignature(
      getMcpServerSignature({
        type: 'http',
        url: 'https://mcp.atlassian.com/v2/mcp/',
      })!,
      true,
    )
    expect(atlassian1).toBe(atlassian2)

    const asana1 = canonicalizeRemoteConnectorSignature(
      'url:https://mcp.asana.com/v2/mcp',
      true,
    )
    const asana2 = canonicalizeRemoteConnectorSignature(
      'url:https://mcp.asana.com/sse',
      true,
    )
    expect(asana1).toBe(asana2)

    const sentry1 = canonicalizeRemoteConnectorSignature(
      getMcpServerSignature({
        type: 'http',
        url: 'https://mcp.sentry.dev/mcp',
      })!,
      true,
    )
    const sentry2 = canonicalizeRemoteConnectorSignature(
      getMcpServerSignature({
        type: 'sse',
        url: 'https://mcp.sentry.dev/sse',
      })!,
      true,
    )
    expect(sentry1).toBe(sentry2)

    // Exact URL mode keeps distinct URLs separate (for conflict checks)
    expect(
      getMcpServerSignature(
        { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
        { exactUrl: true },
      ),
    ).not.toBe(
      getMcpServerSignature(
        { type: 'sse', url: 'https://mcp.sentry.dev/sse' },
        { exactUrl: true },
      ),
    )

    // In remote sessions, dynamic connector dedups plugin MCP using equivalent URL
    const existing: Record<string, ScopedMcpServerConfig> = {
      'claude.ai Atlassian': {
        type: 'http',
        url: 'https://mcp.atlassian.com/v1/mcp',
        scope: 'dynamic',
      },
    }
    const pluginServers: Record<string, ScopedMcpServerConfig> = {
      'plugin:atlassian:jira': {
        type: 'http',
        url: 'https://mcp.atlassian.com/v1/mcp/authv2',
        scope: 'dynamic',
        pluginSource: 'atlassian@official',
      },
    }
    const { servers, suppressed } = dedupPluginMcpServers(
      pluginServers,
      existing,
    )
    expect(Object.keys(servers)).toHaveLength(0)
    expect(suppressed.map(s => s.name)).toEqual(['plugin:atlassian:jira'])
  })

  test('#2302 stamps folder ownership on project/local configs and auto-connects ws transport', () => {
    const proj = addScopeToServers(
      { alpha: { type: 'http', url: 'https://a.example/mcp' } },
      'project',
      '/repo/dir-a',
    )
    expect(proj.alpha?.declaredIn).toBe('/repo/dir-a')

    const user = addScopeToServers(
      { global: { type: 'http', url: 'https://u.example/mcp' } },
      'user',
    )
    expect(user.global?.declaredIn).toBeUndefined()

    const merged = mergeFolderOwnedMcpConfigs(
      {
        sharedProj: {
          type: 'ws',
          url: 'wss://folder.example/mcp',
          scope: 'project',
          declaredIn: '/repo/dir-b',
        },
        keepUser: {
          type: 'http',
          url: 'https://u.example/mcp',
          scope: 'user',
        },
      },
      {
        sharedProj: {
          type: 'http',
          url: 'https://host-dynamic.example/mcp',
          scope: 'dynamic',
        },
        keepUser: {
          type: 'http',
          url: 'https://host-override.example/mcp',
          scope: 'dynamic',
        },
      },
    )
    // Folder-owned project config keeps its folder scope over dynamic
    expect(merged.sharedProj?.scope).toBe('project')
    expect(merged.sharedProj?.declaredIn).toBe('/repo/dir-b')
    // User scope yields to dynamic override
    expect(merged.keepUser?.scope).toBe('dynamic')
    expect(isAutoConnectMcpTransport({ type: 'ws' })).toBe(true)
    expect(isAutoConnectMcpTransport({ type: 'http' })).toBe(true)
  })

  test('#2304 transient OAuth refresh failure returns retryable failed instead of needs-auth and emits recovery', () => {
    const serverName = 'test-transient-oauth'
    const serverConfig: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.example/v1',
      scope: 'user',
    }
    const serverKey = getServerKey(serverName, serverConfig)

    clearTransientMcpRefreshFailure(serverKey)
    expect(hasRecentTransientMcpRefreshFailure(serverKey)).toBe(false)

    markTransientMcpRefreshFailure(serverKey)
    expect(hasRecentTransientMcpRefreshFailure(serverKey)).toBe(true)

    const result = handleRemoteAuthFailure(serverName, serverConfig, 'http')
    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.errorCode).toBe('TRANSIENT_REFRESH_FAILED')
    }

    const recovered: string[] = []
    const unsub = subscribeMcpAuthRecovered(name => recovered.push(name))
    emitMcpAuthRecovered(serverName, serverConfig)
    unsub()
    expect(recovered).toEqual([serverName])
    expect(hasRecentTransientMcpRefreshFailure(serverKey)).toBe(false)
  })

  test('#2305 & #2306 client wiring and live tools swapper registries', () => {
    const wired: string[] = []
    registerConnectedClientWiring(conn => wired.push(conn.name))
    expect(getConnectedClientWiring()).not.toBeNull()
    getConnectedClientWiring()?.({ name: 'srv-a' } as ConnectedMCPServer)
    expect(wired).toEqual(['srv-a'])

    const swapped: string[] = []
    registerMcpToolsSwapper(name => {
      swapped.push(name)
      return true
    })
    swapMcpServerTools('srv-a', [], {
      type: 'http',
      url: 'https://a.example',
      scope: 'user',
    })
    expect(swapped).toEqual(['srv-a'])
  })

  test('#2308 onMcpServerConnected notifies subscribers on reconnect', () => {
    const seen: string[] = []
    const unsub = onMcpServerConnected('reconnected-srv', conn =>
      seen.push(conn.name),
    )
    notifyMcpServerConnected({
      type: 'connected',
      name: 'reconnected-srv',
    } as ConnectedMCPServer)
    unsub()
    notifyMcpServerConnected({
      type: 'connected',
      name: 'reconnected-srv',
    } as ConnectedMCPServer)
    expect(seen).toEqual(['reconnected-srv'])
  })

  test('#2307, #2309, #2349, #2367 MCP task question lifecycle, deferred cancel, notifications, and draft cue', () => {
    const params = {
      message: 'Confirm deployment?',
      requestedSchema: { type: 'object' as const, properties: {} },
      _meta: {
        'io.modelcontextprotocol/related-task': { taskId: 'task-42' },
      },
    }
    expect(isBackgroundMcpTaskElicitation(params)).toBe(true)
    const cue = getElicitationCueBehindDraft({
      serverName: 'deploy-srv',
      params,
    })
    expect(cue?.keepSpinnerRunning).toBe(true)
    expect(cue?.text).toContain('needs your input')
    expect(
      getElicitationCueBehindDraft({
        serverName: 'deploy-srv',
        params: {
          message: 'Regular prompt',
          requestedSchema: { type: 'object', properties: {} },
        },
      }),
    ).toBeUndefined()

    expect(isDeferredTaskElicitation(params)).toBe(false)
    markDeferredTaskElicitation(params)
    expect(isDeferredTaskElicitation(params)).toBe(true)
    expect(MCP_TASK_DEFERRED_CANCEL).toEqual({ action: 'cancel' })

    const states: Array<string | undefined> = []
    const controller = new McpTaskQuestionController((_openFn, s) =>
      states.push(s),
    )
    controller.set('off_screen')
    controller.set('asking')
    controller.set('off_screen')
    controller.set(undefined)
    expect(states).toEqual(['off_screen', 'asking', 'off_screen', undefined])

    // #2349 passive notification enqueue + retract
    const queued: Array<{ value: string; taskId: string }> = []
    const tracker = new McpTaskQuestionNoticeTracker('task-42', {
      enqueueNotice: n => queued.push({ value: n.value, taskId: n.taskId }),
      removeQueuedNotices: pred => {
        const before = queued.length
        for (let i = queued.length - 1; i >= 0; i--) {
          if (pred(queued[i]!.value)) queued.splice(i, 1)
        }
        return before - queued.length
      },
    })
    tracker.update('off_screen')
    tracker.update('off_screen')
    expect(queued).toHaveLength(1)
    expect(isMcpTaskWaitingForAnswerNotification(queued[0]!)).toBe(true)
    expect(queued[0]!.value).toContain('/tasks')
    expect(queued[0]!.value).toBe(
      buildMcpTaskWaitingForAnswerNotification('task-42'),
    )
    tracker.update('asking')
    expect(queued).toHaveLength(0)

    // #2307 footer badge detection
    const task: McpTaskState = {
      id: 'task-42',
      type: 'mcp_task',
      status: 'running',
      description: 'deploy',
      startTime: Date.now(),
      outputFile: '/tmp/out',
      outputOffset: 0,
      notified: false,
      serverName: 'deploy-srv',
      toolName: 'run_deploy',
      mcpTaskId: 'r-42',
      mcpStatus: 'input_required',
    }
    const store: { tasks: Record<string, McpTaskState> } = {
      tasks: { 'task-42': task },
    }
    expect(hasMcpTaskNeedingInput(store.tasks)).toBe(false)
    setMcpTaskQuestionState(
      'task-42',
      updater => {
        const next = updater(store as never) as typeof store
        store.tasks = next.tasks
      },
      () => {},
      'off_screen',
    )
    expect(hasMcpTaskNeedingInput(store.tasks)).toBe(true)
  })

  test('#2328 holds connector approval while cloud plugins are loading', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(isCloudPluginStartupPending()).toBe(false)
    expect(shouldHoldConnectorApprovalWhilePluginsLoading()).toBe(false)

    setCloudPluginStartupPending(true)
    expect(isCloudPluginStartupPending()).toBe(true)
    expect(shouldHoldConnectorApprovalWhilePluginsLoading()).toBe(true)

    setCloudPluginStartupPending(false)
    expect(shouldHoldConnectorApprovalWhilePluginsLoading()).toBe(false)
  })

  test('#2314 Code Mode ~ path expansion, worktree cwd sync, and expired MCP auth sync', () => {
    const baseDir = getOriginalCwd() || '/tmp'
    setCwdState(baseDir)

    expect(expandCodeModePath('~')).toBe(homedir())
    expect(expandCodeModePath('~/notes.md')).toBe(join(homedir(), 'notes.md'))
    expect(expandCodeModePath('relative/file.ts')).toBe(
      join(baseDir, 'relative/file.ts'),
    )

    const normalized = normalizeCodeModeToolInput('Read', {
      file_path: '~/foo.txt',
      path: 'sub/bar.ts',
    })
    expect(normalized.file_path).toBe(join(homedir(), 'foo.txt'))
    expect(normalized.path).toBe(join(baseDir, 'sub/bar.ts'))

    expect(
      extractEnteredWorktreePath('EnterWorktree', {
        worktreePath: '/tmp/wt-feature-1',
      }),
    ).toBe('/tmp/wt-feature-1')

    let clients: Array<{
      type: 'connected' | 'needs-auth'
      name: string
      config: { type: 'http'; url: string }
    }> = [
      {
        type: 'connected',
        name: 'linear',
        config: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      },
    ]
    const flipped = syncExpiredMcpAuthInCodeMode(
      'mcp__linear__list_issues',
      new McpAuthError('linear', 'token expired'),
      ((
        updater: (prev: { mcp: { clients: typeof clients } }) => {
          mcp: { clients: typeof clients }
        },
      ) => {
        clients = updater({ mcp: { clients } }).mcp.clients
      }) as never,
    )
    expect(flipped).toBe('linear')
    expect(clients[0]?.type).toBe('needs-auth')
  })

  test('#2315 Code Mode extracts and forwards user feedback typed with Yes approval', () => {
    expect(
      extractApprovalUserFeedback({
        behavior: 'allow',
        userFeedback: 'only touch tests',
      }),
    ).toBe('only touch tests')
    expect(
      extractApprovalUserFeedback({
        behavior: 'allow',
        message: 'use -la next time',
      }),
    ).toBe('use -la next time')

    const mockBaseRepl = {
      name: 'REPL',
      call: async () => ({ data: 'base' }),
    } as never
    const wrapped = wrapReplToolForCodeMode(mockBaseRepl, () => [])
    expect(wrapped.name).toBe('REPL')
    expect(typeof wrapped.call).toBe('function')
  })

  test('#2316 Code Mode resume waits for next prompt when session ended mid-script', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'REPL',
              input: { code: 'Read({ file_path: "a.ts" })' },
            },
          ],
        },
      },
    ] as never[]

    expect(didSessionEndDuringCodeModeScript(messages)).toBe(true)
    const plan = planCodeModeFromSession({
      replMode: true,
      messages,
    })
    if (!plan.refused) {
      expect(plan.waitForNextPrompt).toBe(true)
    }

    const completedMessages = [
      ...messages,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: 'done',
            },
          ],
        },
      },
    ] as never[]
    expect(didSessionEndDuringCodeModeScript(completedMessages)).toBe(false)
  })

  test('#2308: pollToCompletion normal setTimeout callback removes abort listener on pollSignal', () => {
    const clientSrc = readFileSync(
      join(import.meta.dir, '../client.ts'),
      'utf8',
    )
    const idx = clientSrc.indexOf('timer = setTimeout(() => {')
    expect(idx).toBeGreaterThan(-1)
    const snippet = clientSrc.slice(idx, idx + 250)
    expect(snippet).toContain('pollSignal.removeEventListener(')
    expect(snippet).toContain("'abort'")
    expect(snippet).toContain('onAbort')
  })

  test('#2305/#2306: attachHeadlessRemoteMcpReconnect.dispose/cleanup unregisters both global hooks', () => {
    const reconnected: string[] = []
    let appStateUpdates = 0
    const config: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://srv.example/mcp',
      scope: 'dynamic',
    }
    const existingClient = {
      name: 'srv',
      type: 'connected',
      config,
      client: {},
      capabilities: {},
    } as unknown as ConnectedMCPServer

    let appState: Parameters<
      Parameters<typeof attachHeadlessRemoteMcpReconnect>[0]['setAppState']
    >[0] extends (prev: infer S) => unknown
      ? S
      : never = {
      mcp: {
        clients: [existingClient],
        tools: [],
        commands: [],
        resources: {},
        resourceTemplates: {},
      },
    } as never
    let dynamicState: ReturnType<
      Parameters<
        typeof attachHeadlessRemoteMcpReconnect
      >[0]['getDynamicMcpState']
    > = {
      clients: [existingClient],
      tools: [],
    }

    const attach = attachHeadlessRemoteMcpReconnect({
      getAppState: () => appState,
      setAppState: updater => {
        appStateUpdates++
        appState = updater(appState)
      },
      getDynamicMcpState: () => dynamicState,
      setDynamicMcpState: next => {
        dynamicState = next
      },
      isControlReconnectInFlight: () => false,
      isRunEnding: () => false,
      onReconnected: conn => {
        reconnected.push(conn.name)
      },
    })

    // Still callable as (clients) => void
    expect(typeof attach).toBe('function')
    expect(getConnectedClientWiring()).toBeDefined()
    getConnectedClientWiring()?.(existingClient)
    expect(reconnected).toEqual(['srv'])
    expect(swapMcpServerTools('srv', [], config, existingClient)).toBe(true)
    expect(appStateUpdates).toBe(1)

    // dispose() unregisters both connectedClientWiring and mcpToolsSwapper
    attach.dispose()
    expect(getConnectedClientWiring()).toBeUndefined()
    expect(swapMcpServerTools('srv', [], config, existingClient)).toBe(false)
  })
})
