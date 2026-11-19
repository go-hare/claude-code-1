import { afterEach, describe, expect, test } from 'bun:test'
import {
  issuersMatchSep2352,
  validateSep2352Issuer,
  wrapFetchWithOAuthRedirectGuard,
} from '../auth.js'
import {
  beginMcpToolRefreshSequence,
  commitMcpToolRefreshSequence,
  isMcpToolRefreshSuperseded,
} from '../mcpListChangedRefresh.js'
import {
  isMcpTasksEnabled,
  isOlderMcpHandshakeVersion,
  MCP_TASKS_EXTENSION_KEY,
  patchMcpInitializeCapabilities,
  stripTasksExtensionForOlderHandshake,
} from '../mcpV2Client.js'
import {
  expandConnectorToolAliases,
  toolMatchesWithConnectorAliases,
} from '../utils.js'
import {
  extractSep2663ServerTask,
  handleSep2663ServerTask,
  isMcpTaskBackgroundDisabled,
  shouldAutoBackgroundMcpTasks,
} from '../../../utils/mcpAutoBackground.js'
import { restoreSep2663Tasks } from '../../../tasks/McpTask/McpTask.js'
import type { AppState } from '../../../state/AppState.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_DISABLE_MCP_TASKS
  delete process.env.CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_ENTRYPOINT
})

describe('Wave 319-321 Group 3: MCP Tasks, Auth, Refresh, Connector Aliases', () => {
  test('#1701/#1805: isMcpTasksEnabled defaults true in terminal without FF fetch and honors CLAUDE_CODE_DISABLE_MCP_TASKS', () => {
    expect(isMcpTasksEnabled({}, (_key, def) => def)).toBe(true)
    expect(
      isMcpTasksEnabled(
        { CLAUDE_CODE_DISABLE_MCP_TASKS: '1' },
        (_key, def) => def,
      ),
    ).toBe(false)
    expect(
      isMcpTasksEnabled({ CLAUDE_CODE_REMOTE: '1' }, (_key, def) => def),
    ).toBe(false)
  })

  test('#1702: CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND keeps SEP-2663 server task inline', async () => {
    expect(
      isMcpTaskBackgroundDisabled({
        CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND: '1',
      }),
    ).toBe(true)
    expect(
      shouldAutoBackgroundMcpTasks(
        { CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND: '1' },
        { isNonInteractiveSession: false, readFeature: (_k, d) => d },
      ),
    ).toBe(false)

    const taskRef = extractSep2663ServerTask({
      task: { taskId: 'srv-task-1', status: 'working', pollInterval: 10 },
    })
    expect(taskRef?.mcpTaskId).toBe('srv-task-1')

    let registeredCount = 0
    const inlineResult = await handleSep2663ServerTask({
      serverName: 'demo',
      toolName: 'run',
      toolLabel: 'mcp__demo__run',
      taskRef: taskRef!,
      env: { CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND: '1' },
      isNonInteractiveSession: false,
      setAppState: () => {
        registeredCount++
      },
      pollToCompletion: async () => ({
        content: [{ type: 'text', text: 'inline-done' }],
      }),
    })
    expect(registeredCount).toBe(0)
    expect(
      (inlineResult as { content: Array<{ text: string }> }).content[0]?.text,
    ).toBe('inline-done')
  })

  test('#1701: SEP-2663 server task immediately backgrounds when enabled', async () => {
    const taskRef = extractSep2663ServerTask({
      _meta: {
        'io.modelcontextprotocol/related-task': {
          taskId: 'srv-task-2',
          status: 'working',
        },
      },
    })
    expect(taskRef?.mcpTaskId).toBe('srv-task-2')

    let state = { tasks: {} } as unknown as AppState
    const res = await handleSep2663ServerTask({
      serverName: 'demo',
      toolName: 'slow',
      toolLabel: 'mcp__demo__slow',
      taskRef: taskRef!,
      env: {},
      isNonInteractiveSession: false,
      setAppState: updater => {
        state = updater(state)
      },
      pollToCompletion: async () => ({
        content: [{ type: 'text', text: 'bg-finished' }],
      }),
    })
    expect((res as { autoBackgrounded?: boolean }).autoBackgrounded).toBe(true)
    expect(Object.keys(state.tasks)).toHaveLength(1)
  })

  test('#1716: older MCP handshake strips tasks extension from capabilities.extensions', () => {
    expect(isOlderMcpHandshakeVersion('2025-11-25')).toBe(true)
    expect(isOlderMcpHandshakeVersion('2026-03-01')).toBe(false)

    const stripped = stripTasksExtensionForOlderHandshake(
      {
        roots: { listChanged: true },
        elicitation: {},
        extensions: { [MCP_TASKS_EXTENSION_KEY]: {} },
      },
      '2025-11-25',
    )
    expect(stripped.extensions).toBeUndefined()

    const sent: unknown[] = []
    const fakeClient = {
      send(msg: unknown) {
        sent.push(msg)
        return Promise.resolve({})
      },
    }
    patchMcpInitializeCapabilities(
      fakeClient,
      { type: 'http' },
      {
        readFeature: (_k, d) => d,
      },
    )
    fakeClient.send({
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    })
    fakeClient.send({
      method: 'initialize',
      params: { protocolVersion: '2026-03-01', capabilities: {} },
    })
    const oldCaps = (
      sent[0] as { params: { capabilities: { extensions?: unknown } } }
    ).params.capabilities
    const newCaps = (
      sent[1] as {
        params: { capabilities: { extensions?: Record<string, unknown> } }
      }
    ).params.capabilities
    expect(oldCaps.extensions).toBeUndefined()
    expect(newCaps.extensions?.[MCP_TASKS_EXTENSION_KEY]).toEqual({})
  })

  test('#1717: restoreSep2663Tasks restores sep2663 tasks and notifies on completion', async () => {
    let state = { tasks: {} } as unknown as AppState
    const notifications: Array<{
      taskId: string
      status: string
      resultText?: string
    }> = []
    const { restoredTaskIds, skippedTaskIds } = await restoreSep2663Tasks({
      metas: [
        {
          taskId: 'mcp-1',
          serverName: 'claude.ai Slack',
          toolName: 'export',
          mcpTaskId: 'srv-99',
          protocol: 'sep2663',
        },
        {
          taskId: 'legacy-1',
          serverName: 'old',
          toolName: 'op',
          mcpTaskId: 'srv-old',
        },
      ],
      setAppState: updater => {
        state = updater(state)
      },
      bindingFactory: () => ({
        pollToCompletion: async () => ({
          status: 'completed',
          resultText: 'connector-done',
        }),
      }),
      onNotify: n => notifications.push(n),
    })
    expect(restoredTaskIds).toEqual(['mcp-1'])
    expect(skippedTaskIds).toEqual(['legacy-1'])
    await new Promise(r => setTimeout(r, 10))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      taskId: 'mcp-1',
      status: 'completed',
      resultText: 'connector-done',
    })
  })

  test('#1847: wrapFetchWithOAuthRedirectGuard blocks cross-origin POST redirects', async () => {
    const guarded = wrapFetchWithOAuthRedirectGuard(async () => {
      return new Response(null, {
        status: 307,
        headers: { location: 'https://evil.example/steal' },
      })
    })
    await expect(
      guarded('https://auth.example/token', {
        method: 'POST',
        body: 'refresh_token=secret',
      }),
    ).rejects.toThrow('Stopped an OAuth request, which can hold secrets')
  })

  test('#1853: validateSep2352Issuer normalizes trailing slash and respects canPersistStamp', () => {
    expect(
      issuersMatchSep2352('https://idp.example/', 'https://idp.example'),
    ).toBe(true)
    const warnings: string[] = []
    const unstamped = validateSep2352Issuer<{
      client_id: string
      issuer?: string
    }>({ client_id: 'abc' }, 'https://idp.example', {
      canPersistStamp: false,
      warn: m => warnings.push(m),
    })
    expect(unstamped?.client_id).toBe('abc')
    expect(warnings).toHaveLength(0)

    const mismatch = validateSep2352Issuer(
      { client_id: 'abc', issuer: 'https://other.example' },
      'https://idp.example',
    )
    expect(mismatch).toBeUndefined()
  })

  test('#1893: toolRefreshSequences discards stale concurrent refresh results', () => {
    const conn = { name: 'srv' }
    const seq1 = beginMcpToolRefreshSequence(conn)
    const seq2 = beginMcpToolRefreshSequence(conn)
    expect(commitMcpToolRefreshSequence(conn, seq2)).toBe(true)
    expect(isMcpToolRefreshSuperseded(conn, seq1)).toBe(true)
    expect(commitMcpToolRefreshSequence(conn, seq1)).toBe(false)
  })

  test('#1779: expandConnectorToolAliases maps Desktop connector tools to terminal claude_ai names', () => {
    const aliases = expandConnectorToolAliases('mcp__Slack__post_message', {
      connectorId: 'slack-conn-1',
      connectorDisplayName: 'Slack',
    })
    expect(aliases).toContain('mcp__claude_ai_Slack__post_message')
    expect(aliases).toContain('mcp__claude_ai_Slack')

    expect(
      toolMatchesWithConnectorAliases(
        'mcp__Slack__post_message',
        'mcp__claude_ai_Slack',
        [
          {
            name: 'Slack',
            type: 'connected',
            config: {
              type: 'claudeai-proxy',
              url: 'https://claude.ai',
              id: 'slack-conn-1',
            },
          } as never,
        ],
      ),
    ).toBe(true)
  })
})
