import { afterEach, describe, expect, mock, test } from 'bun:test'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client'
import * as builtinToolsBarrel from '../../index.js'
import {
  PROPOSE_GOAL_LEGACY_TOOL_NAME,
  PROPOSE_GOAL_TOOL_NAME,
  SET_GOAL_TOOL_NAME,
} from '../ProposeGoalTool/constants.js'
import {
  ProposeGoalTool,
  SetGoalTool,
} from '../ProposeGoalTool/ProposeGoalTool.js'
import { ReportFindingsTool } from '../ReportFindingsTool/ReportFindingsTool.js'
import { isDeferredTool } from '../SearchExtraToolsTool/prompt.js'
import {
  getPendingMcpServerNames,
  isWaitForMcpServersEnabled,
  resetWaitForMcpServersStateForTests,
  setLiveMcpClientsForWait,
  setWaitForMcpServersDeclared,
  WaitForMcpServersTool,
  waitForMcpServers,
} from '../WaitForMcpServersTool/WaitForMcpServersTool.js'
import {
  MCP_DIRECTORY_MIME_TYPE,
  MCP_SKILLS_EXTENSION_KEY,
  READ_MCP_RESOURCE_DIR_LEGACY_ALIAS,
  READ_MCP_RESOURCE_DIR_TOOL_NAME,
} from '../ReadMcpResourceDirTool/constants.js'
import {
  isMcpNotADirectoryError,
  ReadMcpResourceDirTool,
  readMcpDirectory,
  serverDeclaresDirectoryRead,
} from '../ReadMcpResourceDirTool/ReadMcpResourceDirTool.js'
import {
  createQueuedNotificationsRegistry,
  formatReadNotificationsResult,
  resetDefaultQueuedNotificationsRegistryForTests,
} from '../ReadNotificationsTool/notificationQueue.js'
import {
  isReadNotificationsEnabled,
  ReadNotificationsTool,
} from '../ReadNotificationsTool/ReadNotificationsTool.js'
import {
  MCP_POLLER_META_KEY,
  MCP_TASK_RESUME_POLLING_TOOL_NAME,
} from '../McpTaskResumePollingTool/constants.js'
import {
  isMcpTaskResumePollingEnabled,
  McpTaskResumePollingTool,
  offerMcpTaskToPoller,
} from '../McpTaskResumePollingTool/McpTaskResumePollingTool.js'
import { formatMcpTaskResumeOutcome } from '../McpTaskResumePollingTool/prompt.js'
import {
  hasAngleBracketTag,
  hasSkillMdInstructions,
  isProposeSkillsEnabled,
  ProposeSkillsTool,
} from '../ProposeSkillsTool/ProposeSkillsTool.js'
import { ShareOnboardingGuideTool } from 'src/commands/team-onboarding/shareOnboardingGuide.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import {
  createMcpTaskState,
  type McpTaskState,
} from 'src/tasks/McpTask/McpTask.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolUseContext,
  toolMatchesName,
} from 'src/Tool.js'
import { getAllBaseTools, getTools } from 'src/tools.js'

const DUMMY_HTTP_CONFIG: ScopedMcpServerConfig = {
  type: 'http',
  url: 'https://mcp.example.test',
  scope: 'user',
}

function makeToolContext(
  overrides: Partial<ToolUseContext> & {
    mcpClients?: MCPServerConnection[]
    queuedNotificationsRegistry?: ReturnType<
      typeof createQueuedNotificationsRegistry
    >
  } = {},
): ToolUseContext {
  const { mcpClients = [], queuedNotificationsRegistry, ...rest } = overrides
  return {
    abortController: new AbortController(),
    options: {
      mcpClients,
      tools: [],
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () =>
      ({
        mcp: { clients: mcpClients },
        tasks: {},
        toolPermissionContext: getEmptyToolPermissionContext(),
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    ...(queuedNotificationsRegistry ? { queuedNotificationsRegistry } : {}),
    ...rest,
  } as unknown as ToolUseContext
}

afterEach(() => {
  resetWaitForMcpServersStateForTests()
  resetDefaultQueuedNotificationsRegistryForTests()
})

// ─── 1. ProposeGoal -> SetGoal canonical rename ───────────────────────────────

describe('2.1.331 ProposeGoal -> SetGoal canonical rename', () => {
  test('canonical wire name is SetGoal with ProposeGoal alias and SetGoalTool export', () => {
    expect(SET_GOAL_TOOL_NAME).toBe('SetGoal')
    expect(PROPOSE_GOAL_TOOL_NAME).toBe('SetGoal')
    expect(PROPOSE_GOAL_LEGACY_TOOL_NAME).toBe('ProposeGoal')

    expect(SetGoalTool).toBe(ProposeGoalTool)
    expect(builtinToolsBarrel.SetGoalTool).toBe(ProposeGoalTool)
    expect(builtinToolsBarrel.ProposeGoalTool).toBe(ProposeGoalTool)

    expect(SetGoalTool.name).toBe('SetGoal')
    expect(SetGoalTool.aliases).toEqual(['ProposeGoal'])
    expect(toolMatchesName(SetGoalTool, 'SetGoal')).toBe(true)
    expect(toolMatchesName(SetGoalTool, 'ProposeGoal')).toBe(true)
    expect(SetGoalTool.shouldDefer).toBe(true)
    expect(SetGoalTool.backgrounding).toBe('never')
    expect(
      SetGoalTool.renderToolUseMessage({ condition: 'bun test passes' }),
    ).toBe('Goal: bun test passes')
  })

  test('getAllBaseTools resolves SetGoal by canonical name and ProposeGoal alias', () => {
    const base = getAllBaseTools()
    expect(findToolByName(base, 'SetGoal')).toBe(SetGoalTool)
    expect(findToolByName(base, 'ProposeGoal')).toBe(SetGoalTool)
  })
})

// ─── 2. shouldDefer drift fixes ───────────────────────────────────────────────

describe('2.1.331 shouldDefer alignment', () => {
  test('ReportFindingsTool is not deferred (shouldDefer: false)', () => {
    expect(ReportFindingsTool.shouldDefer).toBe(false)
    expect(isDeferredTool(ReportFindingsTool)).toBe(false)
    expect(ReportFindingsTool.backgrounding).toBe('never')
  })

  test('ShareOnboardingGuideTool is not deferred (shouldDefer: false)', () => {
    expect(ShareOnboardingGuideTool.shouldDefer).toBe(false)
    expect(isDeferredTool(ShareOnboardingGuideTool)).toBe(false)
    expect(ShareOnboardingGuideTool.backgrounding).toBe('never')
  })
})

// ─── 3. Barrel exports & base tool registry ──────────────────────────────────

describe('2.1.331 built-in tools registration & exports', () => {
  test('all 5 new official 2.1.331 tools are exported from @claude-code/builtin-tools and registered in getAllBaseTools()', () => {
    expect(builtinToolsBarrel.WaitForMcpServersTool).toBe(WaitForMcpServersTool)
    expect(builtinToolsBarrel.ReadMcpResourceDirTool).toBe(
      ReadMcpResourceDirTool,
    )
    expect(builtinToolsBarrel.ReadNotificationsTool).toBe(ReadNotificationsTool)
    expect(builtinToolsBarrel.McpTaskResumePollingTool).toBe(
      McpTaskResumePollingTool,
    )
    expect(builtinToolsBarrel.ProposeSkillsTool).toBe(ProposeSkillsTool)

    const base = getAllBaseTools()
    expect(findToolByName(base, 'WaitForMcpServers')).toBe(
      WaitForMcpServersTool,
    )
    expect(findToolByName(base, 'ReadMcpResourceDirTool')).toBe(
      ReadMcpResourceDirTool,
    )
    expect(findToolByName(base, 'ReadMcpResourceDir')).toBe(
      ReadMcpResourceDirTool,
    )
    expect(findToolByName(base, 'ReadNotifications')).toBe(
      ReadNotificationsTool,
    )
    expect(findToolByName(base, 'McpTaskResumePolling')).toBe(
      McpTaskResumePollingTool,
    )
    expect(findToolByName(base, 'propose_skills')).toBe(ProposeSkillsTool)
  })

  test('none of the 5 gated/special tools pollute default getTools() in plain local CLI', () => {
    const prevKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = prevKey || 'test-key'
    try {
      const enabledNames = new Set(
        getTools(getEmptyToolPermissionContext()).map(t => t.name),
      )
      expect(enabledNames.has('WaitForMcpServers')).toBe(false)
      expect(enabledNames.has('ReadMcpResourceDirTool')).toBe(false)
      expect(enabledNames.has('ReadNotifications')).toBe(false)
      expect(enabledNames.has('McpTaskResumePolling')).toBe(false)
      expect(enabledNames.has('propose_skills')).toBe(false)
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prevKey
    }
  })
})

// ─── 4. WaitForMcpServersTool ────────────────────────────────────────────────

describe('2.1.331 WaitForMcpServersTool', () => {
  test('surface metadata and isEnabled gate', () => {
    expect(WaitForMcpServersTool.name).toBe('WaitForMcpServers')
    expect(WaitForMcpServersTool.shouldDefer).toBe(false)
    expect(WaitForMcpServersTool.isReadOnly()).toBe(true)
    expect(WaitForMcpServersTool.isConcurrencySafe()).toBe(false)
    expect(WaitForMcpServersTool.userFacingName()).toBe('MCP Wait For Servers')
    expect(WaitForMcpServersTool.renderToolUseMessage({})).toBe(
      'Wait for pending MCP servers to connect',
    )
    expect(
      WaitForMcpServersTool.renderToolUseMessage({ servers: ['gh', 'slack'] }),
    ).toBe('Wait for MCP servers to connect: gh, slack')

    expect(WaitForMcpServersTool.isEnabled()).toBe(false)

    setLiveMcpClientsForWait([
      { name: 'github', type: 'pending', config: DUMMY_HTTP_CONFIG },
    ])
    expect(
      getPendingMcpServerNames([
        { name: 'github', type: 'pending', config: DUMMY_HTTP_CONFIG },
      ]),
    ).toEqual(['github'])
    expect(isWaitForMcpServersEnabled()).toBe(true)
    expect(WaitForMcpServersTool.isEnabled()).toBe(true)

    setLiveMcpClientsForWait([])
    expect(WaitForMcpServersTool.isEnabled()).toBe(false)

    setWaitForMcpServersDeclared(true)
    expect(WaitForMcpServersTool.isEnabled()).toBe(true)
  })

  test('waits until pending server connects and reports ready=true', async () => {
    let clients: MCPServerConnection[] = [
      { name: 'github', type: 'pending', config: DUMMY_HTTP_CONFIG },
    ]
    setTimeout(() => {
      clients = [
        {
          name: 'github',
          type: 'connected',
          capabilities: {},
          config: DUMMY_HTTP_CONFIG,
          client: {} as ConnectedMCPServer['client'],
          cleanup: async () => {},
        },
      ]
    }, 20)

    const out = await waitForMcpServers(
      {},
      { getClients: () => clients, timeoutMs: 500, pollIntervalMs: 10 },
    )
    expect(out.ready).toBe(true)
    expect(out.connected).toEqual(['github'])
    expect(out.stillPending).toEqual([])
    expect(out.failed).toEqual([])
    expect(out.unknown).toEqual([])

    const block = WaitForMcpServersTool.mapToolResultToToolResultBlockParam(
      out,
      'tu_wait_1',
    )
    expect(block.is_error).toBe(false)
    expect(String(block.content)).toContain('ready: true')
    expect(String(block.content)).toContain('github')
  })

  test('categorizes failed, needsAuth, disabled, unconfigured, stillPending, and unknown servers', async () => {
    const clients: MCPServerConnection[] = [
      {
        name: 'broken',
        type: 'failed',
        config: DUMMY_HTTP_CONFIG,
        error: 'ECONNREFUSED',
      },
      {
        name: 'no-url',
        type: 'failed',
        config: DUMMY_HTTP_CONFIG,
        errorCode: 'UNCONFIGURED',
      },
      { name: 'authme', type: 'needs-auth', config: DUMMY_HTTP_CONFIG },
      { name: 'off', type: 'disabled', config: DUMMY_HTTP_CONFIG },
      { name: 'slow', type: 'pending', config: DUMMY_HTTP_CONFIG },
    ]

    const out = await waitForMcpServers(
      {
        servers: ['broken', 'no-url', 'authme', 'off', 'slow', 'ghost'],
      },
      { getClients: () => clients, timeoutMs: 25, pollIntervalMs: 10 },
    )
    expect(out.ready).toBe(false)
    expect(out.failed).toEqual(['broken'])
    expect(out.unconfigured).toEqual(['no-url'])
    expect(out.needsAuth).toEqual(['authme'])
    expect(out.disabled).toEqual(['off'])
    expect(out.stillPending).toEqual(['slow'])
    expect(out.unknown).toEqual(['ghost'])

    const block = WaitForMcpServersTool.mapToolResultToToolResultBlockParam(
      out,
      'tu_wait_2',
    )
    expect(block.is_error).toBe(true)
    const text = String(block.content)
    expect(text).toContain('Failed to connect: broken')
    expect(text).toContain('Not configured')
    expect(text).toContain('Needs authentication')
    expect(text).toContain('Disabled')
    expect(text).toContain('Still connecting')
    expect(text).toContain('Unknown')
  })

  test('tool.call works via ToolUseContext and matches normalized server names', async () => {
    const connected: ConnectedMCPServer = {
      name: 'claude.ai Slack',
      type: 'connected',
      capabilities: {},
      config: DUMMY_HTTP_CONFIG,
      client: {} as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }
    const ctx = makeToolContext({ mcpClients: [connected] })
    const res = await WaitForMcpServersTool.call(
      { servers: ['claude_ai_Slack'] },
      ctx,
    )
    expect(res.data.ready).toBe(true)
    expect(res.data.connected).toEqual(['claude.ai Slack'])
  })
})

// ─── 5. ReadMcpResourceDirTool ───────────────────────────────────────────────

describe('2.1.331 ReadMcpResourceDirTool', () => {
  test('surface metadata, alias, and capability check', () => {
    expect(ReadMcpResourceDirTool.name).toBe(READ_MCP_RESOURCE_DIR_TOOL_NAME)
    expect(ReadMcpResourceDirTool.aliases).toEqual([
      READ_MCP_RESOURCE_DIR_LEGACY_ALIAS,
    ])
    expect(ReadMcpResourceDirTool.shouldDefer).toBe(true)
    expect(ReadMcpResourceDirTool.isReadOnly()).toBe(true)
    expect(ReadMcpResourceDirTool.isConcurrencySafe()).toBe(true)
    expect(ReadMcpResourceDirTool.userFacingName()).toBe('readMcpResourceDir')
    expect(
      ReadMcpResourceDirTool.renderToolUseMessage({
        server: 'docs',
        uri: 'docs://skills',
      }),
    ).toBe('List directory resource "docs://skills" from server "docs"')

    expect(serverDeclaresDirectoryRead(undefined)).toBe(false)
    expect(serverDeclaresDirectoryRead({})).toBe(false)
    expect(
      serverDeclaresDirectoryRead({
        extensions: { [MCP_SKILLS_EXTENSION_KEY]: { directoryRead: true } },
      } as ConnectedMCPServer['capabilities']),
    ).toBe(true)
  })

  test('paginates resources/directory/read and formats subdirectories with trailing slash', async () => {
    const requestMock = mock(
      async (payload: { method: string; params?: Record<string, unknown> }) => {
        expect(payload.method).toBe('resources/directory/read')
        if (!payload.params?.cursor) {
          return {
            resources: [
              {
                uri: 'docs://skills/sub',
                name: 'sub',
                mimeType: MCP_DIRECTORY_MIME_TYPE,
              },
            ],
            nextCursor: 'page-2',
          }
        }
        return {
          resources: [
            {
              uri: 'docs://skills/README.md',
              name: 'README.md',
              mimeType: 'text/markdown',
            },
          ],
        }
      },
    )

    const connected: ConnectedMCPServer = {
      name: 'docs',
      type: 'connected',
      capabilities: {
        extensions: { [MCP_SKILLS_EXTENSION_KEY]: { directoryRead: true } },
      } as ConnectedMCPServer['capabilities'],
      config: DUMMY_HTTP_CONFIG,
      client: {
        request: requestMock,
      } as unknown as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }

    const res = await ReadMcpResourceDirTool.call(
      { server: 'docs', uri: 'docs://skills' },
      makeToolContext({ mcpClients: [connected] }),
    )
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(res.data.error).toBeUndefined()
    expect(res.data.resources).toEqual([
      {
        uri: 'docs://skills/sub',
        name: 'sub',
        mimeType: MCP_DIRECTORY_MIME_TYPE,
      },
      {
        uri: 'docs://skills/README.md',
        name: 'README.md',
        mimeType: 'text/markdown',
      },
    ])

    const block = ReadMcpResourceDirTool.mapToolResultToToolResultBlockParam(
      res.data,
      'tu_dir_1',
    )
    const content = String(block.content)
    expect(content).toContain('Directory listing (2 entries):')
    expect(content).toContain('sub/')
    expect(content).toContain('README.md')
  })

  test('handles InvalidParams (-32602) on page 1 as not-a-directory and on page > 1 as partial return', async () => {
    const invalidParams = new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      'Not a directory',
    )
    expect(isMcpNotADirectoryError(invalidParams)).toBe(true)

    const notDirClient: ConnectedMCPServer = {
      name: 'docs',
      type: 'connected',
      capabilities: {
        extensions: { [MCP_SKILLS_EXTENSION_KEY]: { directoryRead: true } },
      } as ConnectedMCPServer['capabilities'],
      config: DUMMY_HTTP_CONFIG,
      client: {
        request: mock(async () => {
          throw invalidParams
        }),
      } as unknown as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }

    const notDirRes = await ReadMcpResourceDirTool.call(
      { server: 'docs', uri: 'docs://file.md' },
      makeToolContext({ mcpClients: [notDirClient] }),
    )
    expect(notDirRes.data.resources).toEqual([])
    expect(notDirRes.data.error).toContain('Not a directory resource')
    expect(notDirRes.data.error).toContain('ReadMcpResourceTool')

    let callNum = 0
    const partialEntries = await readMcpDirectory(
      {
        name: 'docs',
        capabilities: {
          extensions: { [MCP_SKILLS_EXTENSION_KEY]: { directoryRead: true } },
        } as ConnectedMCPServer['capabilities'],
        client: {
          request: async () => {
            callNum++
            if (callNum === 1) {
              return {
                resources: [{ uri: 'docs://a', name: 'a' }],
                nextCursor: 'stale-cursor',
              }
            }
            throw invalidParams
          },
        } as unknown as ConnectedMCPServer['client'],
      },
      'docs://root',
    )
    expect(partialEntries).toEqual([{ uri: 'docs://a', name: 'a' }])
  })

  test('returns helpful errors for pending server or missing directoryRead capability', async () => {
    const pendingRes = await ReadMcpResourceDirTool.call(
      { server: 'docs', uri: 'docs://root' },
      makeToolContext({
        mcpClients: [
          { name: 'docs', type: 'pending', config: DUMMY_HTTP_CONFIG },
        ],
      }),
    )
    expect(pendingRes.data.error).toContain('not connected yet')
    expect(pendingRes.data.error).toContain('ListMcpResourcesTool')

    const noCapClient: ConnectedMCPServer = {
      name: 'plain',
      type: 'connected',
      capabilities: {},
      config: DUMMY_HTTP_CONFIG,
      client: {} as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }
    const noCapRes = await ReadMcpResourceDirTool.call(
      { server: 'plain', uri: 'plain://root' },
      makeToolContext({ mcpClients: [noCapClient] }),
    )
    expect(noCapRes.data.error).toContain('does not support directory listing')
  })
})

// ─── 6. ReadNotificationsTool ────────────────────────────────────────────────

describe('2.1.331 ReadNotificationsTool', () => {
  test('surface metadata and isEnabled gate', () => {
    expect(ReadNotificationsTool.name).toBe('ReadNotifications')
    expect(ReadNotificationsTool.shouldDefer).toBe(false)
    expect(ReadNotificationsTool.isReadOnly()).toBe(true)
    expect(ReadNotificationsTool.isConcurrencySafe()).toBe(true)
    expect(ReadNotificationsTool.maxResultSizeChars).toBe(100_000)
    expect(ReadNotificationsTool.toAutoClassifierInput()).toBe(
      'read queued notifications',
    )

    expect(
      isReadNotificationsEnabled({
        env: {},
        isNonInteractive: false,
        replBridgeActive: false,
      }),
    ).toBe(false)
    expect(
      isReadNotificationsEnabled({
        env: { CLAUDE_CODE_REMOTE: '1' },
        isNonInteractive: true,
        replBridgeActive: false,
      }),
    ).toBe(true)
    expect(
      isReadNotificationsEnabled({
        env: {},
        isNonInteractive: false,
        replBridgeActive: true,
        readFeature: () => true,
      }),
    ).toBe(true)
    expect(
      isReadNotificationsEnabled({
        env: {},
        isNonInteractive: false,
        replBridgeActive: true,
        readFeature: () => false,
      }),
    ).toBe(false)
  })

  test('rejects subagent calls, drains oldest-first with dedup, and formats tool result', async () => {
    const registry = createQueuedNotificationsRegistry()
    expect(
      registry.enqueue({
        notificationId: 'notif-1',
        origin: 'github_webhook',
        queuedAt: '2026-11-25T08:00:00Z',
        content: 'PR #42 approved',
        arrivedAt: '2026-11-25T08:00:05Z',
      }),
    ).toBe(true)
    // Duplicate id rejected
    expect(
      registry.enqueue({
        notificationId: 'notif-1',
        origin: 'github_webhook',
        queuedAt: '2026-11-25T08:00:00Z',
        content: 'duplicate',
      }),
    ).toBe(false)
    expect(
      registry.enqueue({
        notificationId: 'notif-2',
        origin: 'BAD ORIGIN!',
        queuedAt: '2026-11-25T08:01:00Z',
        content: 'Routine check-in',
        arrivedAt: '2026-11-25T08:01:02Z',
      }),
    ).toBe(true)

    await expect(
      ReadNotificationsTool.call(
        {},
        makeToolContext({
          agentId: 'sub-1' as ToolUseContext['agentId'],
          queuedNotificationsRegistry: registry,
        }),
      ),
    ).rejects.toThrow(
      'ReadNotifications can only be called from the main conversation',
    )

    const res = await ReadNotificationsTool.call(
      {},
      makeToolContext({ queuedNotificationsRegistry: registry }),
    )
    expect(res.data.remaining).toBe(0)
    expect(res.data.notifications).toHaveLength(2)
    expect(res.data.notifications[0]?.notification_id).toBe('notif-1')
    expect(res.data.notifications[0]?.origin).toBe('github_webhook')
    expect(res.data.notifications[1]?.origin).toBe('unknown')
    expect(registry.wasDelivered('notif-1')).toBe(true)
    expect(registry.pendingCount()).toBe(0)
    // Redelivery of already-delivered id is ignored
    expect(
      registry.enqueue({
        notificationId: 'notif-1',
        origin: 'github_webhook',
        queuedAt: '2026-11-25T08:00:00Z',
        content: 'redelivery',
      }),
    ).toBe(false)

    const block = ReadNotificationsTool.mapToolResultToToolResultBlockParam(
      res.data,
      'tu_notif_1',
    )
    const content = String(block.content)
    expect(content).toContain('Exactly 2 notifications were queued')
    expect(content).toContain('GitHub activity on a subscribed PR')
    expect(content).toContain('PR #42 approved')
    expect(content).toContain('0 notifications remain queued.')

    // Empty drain
    const empty = await ReadNotificationsTool.call(
      {},
      makeToolContext({ queuedNotificationsRegistry: registry }),
    )
    expect(
      ReadNotificationsTool.mapToolResultToToolResultBlockParam(
        empty.data,
        'tu_notif_2',
      ).content,
    ).toBe('No queued notifications.')
  })

  test('size-budgeted drain leaves remaining notifications for subsequent call', () => {
    const registry = createQueuedNotificationsRegistry()
    registry.enqueue({
      notificationId: 'n1',
      origin: 'trigger_fire',
      queuedAt: '2026-11-25T08:00:00Z',
      content: 'a'.repeat(400),
    })
    registry.enqueue({
      notificationId: 'n2',
      origin: 'trigger_fire',
      queuedAt: '2026-11-25T08:01:00Z',
      content: 'b'.repeat(400),
    })
    const first = registry.drain(700)
    expect(first.notifications).toHaveLength(1)
    expect(first.remaining).toBe(1)

    const formatted = formatReadNotificationsResult(
      first.notifications.map(n => ({
        notification_id: n.notificationId,
        origin: n.origin,
        queued_at: n.queuedAt,
        content: n.content,
      })),
      first.remaining,
    )
    expect(formatted).toContain(
      '1 more notification still queued — call ReadNotifications again to read the rest.',
    )

    const second = registry.drain(700)
    expect(second.notifications).toHaveLength(1)
    expect(second.remaining).toBe(0)
  })
})

// ─── 7. McpTaskResumePollingTool ─────────────────────────────────────────────

describe('2.1.331 McpTaskResumePollingTool', () => {
  test('surface metadata and isEnabled gate', () => {
    expect(McpTaskResumePollingTool.name).toBe(
      MCP_TASK_RESUME_POLLING_TOOL_NAME,
    )
    expect(McpTaskResumePollingTool.shouldDefer).toBe(true)
    expect(McpTaskResumePollingTool.isReadOnly()).toBe(false)
    expect(McpTaskResumePollingTool.isConcurrencySafe()).toBe(false)
    expect(McpTaskResumePollingTool.maxResultSizeChars).toBe(1000)
    expect(
      McpTaskResumePollingTool.toAutoClassifierInput({ task_id: 'k_123' }),
    ).toBe('k_123')

    expect(
      isMcpTaskResumePollingEnabled({
        env: {},
        isDiskless: false,
        readFeature: () => false,
        isPolicyAllowed: () => true,
      }),
    ).toBe(false)

    expect(
      isMcpTaskResumePollingEnabled({
        env: { CLAUDE_CODE_REMOTE: '1' },
        isDiskless: false,
        readFeature: key =>
          key === 'tengu_glowing_lark' ||
          key === 'tengu_zippy_piglet' ||
          key === 'tengu_mossy_ferry',
        isPolicyAllowed: key => key === 'allow_mcp_task_worker_wake',
      }),
    ).toBe(true)

    expect(
      isMcpTaskResumePollingEnabled({
        env: { CLAUDE_CODE_REMOTE: '1' },
        isDiskless: false,
        readFeature: () => true,
        isPolicyAllowed: () => false,
      }),
    ).toBe(false)
  })

  test('offerMcpTaskToPoller handles unknown, ended, question, found_end, resumed, and unknown_to_server', async () => {
    const tasks = new Map<string, McpTaskState>()

    // unknown_id
    expect(
      await offerMcpTaskToPoller('missing', {
        getTask: id => tasks.get(id),
        getMcpClients: () => [],
        isEnabled: () => true,
      }),
    ).toEqual({ outcome: 'unknown_id' })

    // ended
    const endedTask = createMcpTaskState({
      serverName: 'linear',
      toolName: 'sync',
      mcpTaskId: 'srv-1',
      protocol: 'sep2663',
    })
    endedTask.status = 'completed'
    tasks.set(endedTask.id, endedTask)
    expect(
      await offerMcpTaskToPoller(endedTask.id, {
        getTask: id => tasks.get(id),
        getMcpClients: () => [],
        isEnabled: () => true,
      }),
    ).toEqual({ outcome: 'ended' })

    // question (input_required) surfaces openQuestion
    const opened = mock(() => {})
    const activeTask = createMcpTaskState({
      serverName: 'linear',
      toolName: 'sync',
      mcpTaskId: 'srv-2',
      protocol: 'sep2663',
    })
    activeTask.parked = true
    activeTask.openQuestion = opened
    tasks.set(activeTask.id, activeTask)

    const makeConn = (
      requestFn: (p: {
        method: string
        params?: Record<string, unknown>
      }) => Promise<unknown>,
    ): ConnectedMCPServer => ({
      name: 'linear',
      type: 'connected',
      capabilities: {},
      config: DUMMY_HTTP_CONFIG,
      client: { request: requestFn } as unknown as ConnectedMCPServer['client'],
      cleanup: async () => {},
    })

    const qRes = await offerMcpTaskToPoller(activeTask.id, {
      getTask: id => tasks.get(id),
      getMcpClients: () => [
        makeConn(async () => ({ status: 'input_required' })),
      ],
      isEnabled: () => true,
    })
    expect(qRes).toEqual({ outcome: 'question', status: 'input_required' })
    expect(opened).toHaveBeenCalledTimes(1)

    // found_end
    const endRes = await offerMcpTaskToPoller(activeTask.id, {
      getTask: id => tasks.get(id),
      getMcpClients: () => [makeConn(async () => ({ status: 'completed' }))],
      isEnabled: () => true,
    })
    expect(endRes).toEqual({ outcome: 'found_end', status: 'completed' })

    // resumed via poller _meta
    const resumedRes = await offerMcpTaskToPoller(activeTask.id, {
      getTask: id => tasks.get(id),
      updateTask: (id, updater) => {
        const cur = tasks.get(id)
        if (cur) tasks.set(id, updater(cur))
      },
      getMcpClients: () => [
        makeConn(async () => ({
          status: 'working',
          _meta: { [MCP_POLLER_META_KEY]: 'service' },
        })),
      ],
      isEnabled: () => true,
    })
    expect(resumedRes).toEqual({ outcome: 'resumed' })
    expect(tasks.get(activeTask.id)?.parked).toBe(false)

    // already_tracked after resumed
    expect(
      await offerMcpTaskToPoller(activeTask.id, {
        getTask: id => tasks.get(id),
        getMcpClients: () => [],
        isEnabled: () => true,
      }),
    ).toEqual({ outcome: 'already_tracked' })

    // unknown_to_server (-32602)
    const currentTask = tasks.get(activeTask.id)
    if (currentTask) currentTask.parked = true
    const unkRes = await offerMcpTaskToPoller(activeTask.id, {
      getTask: id => tasks.get(id),
      getMcpClients: () => [
        makeConn(async () => {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Unknown task',
          )
        }),
      ],
      isEnabled: () => true,
    })
    expect(unkRes).toEqual({ outcome: 'unknown_to_server' })

    // Formatting check
    expect(formatMcpTaskResumeOutcome('resumed', 'k1')).toEqual({
      message:
        'Tracking of task k1 resumed. You will get a notification when it ends, so there is no need to poll or wait.',
      isError: false,
    })
    const errBlock =
      McpTaskResumePollingTool.mapToolResultToToolResultBlockParam(
        formatMcpTaskResumeOutcome('unknown_id', 'k_bad'),
        'tu_mcp_1',
      )
    expect(errBlock.is_error).toBe(true)
    expect(String(errBlock.content)).toContain('No MCP task with the id k_bad')
  })
})

// ─── 8. ProposeSkillsTool ────────────────────────────────────────────────────

describe('2.1.331 ProposeSkillsTool', () => {
  test('surface metadata and isEnabled gate', () => {
    expect(ProposeSkillsTool.name).toBe('propose_skills')
    expect(ProposeSkillsTool.shouldDefer).toBe(false)
    expect(ProposeSkillsTool.isReadOnly()).toBe(true)
    expect(ProposeSkillsTool.isConcurrencySafe()).toBe(true)
    expect(ProposeSkillsTool.maxResultSizeChars).toBe(1000)

    // Default local CLI: off
    expect(
      isProposeSkillsEnabled({
        env: {},
        isDiskless: false,
        skillsSyncVetoed: false,
      }),
    ).toBe(false)

    // Enabled when CLAUDE_CODE_SKILL_PROPOSALS + CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE set and not vetoed
    expect(
      isProposeSkillsEnabled({
        env: {
          CLAUDE_CODE_SKILL_PROPOSALS: '1',
          CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud',
        },
        isDiskless: false,
        skillsSyncVetoed: false,
      }),
    ).toBe(true)

    // Blocked in child sessions or when skills sync is vetoed
    expect(
      isProposeSkillsEnabled({
        env: {
          CLAUDE_CODE_SKILL_PROPOSALS: '1',
          CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud',
          CLAUDE_CODE_CHILD_SESSION: '1',
        },
        isDiskless: false,
        skillsSyncVetoed: false,
      }),
    ).toBe(false)
    expect(
      isProposeSkillsEnabled({
        env: {
          CLAUDE_CODE_SKILL_PROPOSALS: '1',
          CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud',
        },
        isDiskless: false,
        skillsSyncVetoed: true,
      }),
    ).toBe(false)
  })

  test('schema enforces name/description/skillMd/edits constraints and call is render-only', async () => {
    expect(hasAngleBracketTag('Use when <foo> happens')).toBe(true)
    expect(hasAngleBracketTag('Use when x < 5')).toBe(false)
    expect(hasSkillMdInstructions('---\nname: test\n---\n\nRun checks.')).toBe(
      true,
    )
    expect(hasSkillMdInstructions('---\nname: test\n---\n   ')).toBe(false)

    const validNew = {
      proposals: [
        {
          name: 'release-checklist',
          kind: 'new' as const,
          description: 'Use when cutting a tagged release',
          skillMd:
            '---\nname: release-checklist\n---\n\n1. Run bun run precheck',
        },
      ],
    }
    expect(ProposeSkillsTool.inputSchema.safeParse(validNew).success).toBe(true)

    // Rejects forbidden word "claude" in new skill name
    expect(
      ProposeSkillsTool.inputSchema.safeParse({
        proposals: [
          {
            name: 'claude-helper',
            kind: 'new',
            description: 'Helper',
            skillMd: '---\nname: x\n---\n\nBody',
          },
        ],
      }).success,
    ).toBe(false)

    // Rejects angle brackets in description
    expect(
      ProposeSkillsTool.inputSchema.safeParse({
        proposals: [
          {
            name: 'good-slug',
            kind: 'new',
            description: 'Use for <script> tags',
            skillMd: '---\nname: x\n---\n\nBody',
          },
        ],
      }).success,
    ).toBe(false)

    // Rejects improvement without target
    expect(
      ProposeSkillsTool.inputSchema.safeParse({
        proposals: [
          {
            name: 'my-skill',
            kind: 'improvement',
            description: 'Updated description',
            edits: [{ old_string: 'a', new_string: 'b' }],
          },
        ],
      }).success,
    ).toBe(false)

    // validateInput rejects improvement providing both edits and skillMd
    const bothRes = await ProposeSkillsTool.validateInput?.(
      {
        proposals: [
          {
            name: 'my-skill',
            kind: 'improvement',
            target: 'my-skill',
            description: 'Updated description',
            edits: [{ old_string: 'a', new_string: 'b' }],
            skillMd: '---\nname: my-skill\n---\n\nBody',
          },
        ],
      },
      makeToolContext(),
    )
    expect(bothRes?.result).toBe(false)

    // Render-only call
    const res = await ProposeSkillsTool.call(validNew, makeToolContext())
    expect(res.data).toEqual({ proposalCount: 1 })
    const block = ProposeSkillsTool.mapToolResultToToolResultBlockParam(
      res.data,
      'tu_skills_1',
    )
    expect(String(block.content)).toContain(
      'Shown 1 skill proposal(s) to the user for review.',
    )
    expect(ProposeSkillsTool.renderToolUseMessage(validNew)).toBe(
      'Propose 1 skill: release-checklist',
    )
  })
})
