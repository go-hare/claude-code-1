import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realMessageQueue from 'src/utils/messageQueueManager.js'
import { debugMock } from '../../../tests/mocks/debug'
import { growthbookMock } from '../../../tests/mocks/growthbook'
import { createMessageQueueManagerMock } from '../../../tests/mocks/messageQueueManager'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

// Side-effect deps used only on auto-bg timeout path — mock before import.
// Mock debug (not bootstrap/state): incomplete state mock is process-global and
// poisons other files' named imports (addSlowOperation / setLastAPIRequestMessages).
// debugMock cuts debug → slowOperations → state chain per project test rules.
// growthbookMock must be complete — Bun mock.module is process-global and an
// incomplete growthbook mock breaks later files that import other GB exports.
// messageQueueManager: spread real module — incomplete stubs drop getCommandQueue
// and poison co-running suites (modelScheduledOrigin.221 etc.).
// Snapshot BEFORE mock — live namespace rebinds under Bun.
const mqmSnap = snapshotModuleExports(realMessageQueue)

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/debug.js', debugMock)
const realMcpTask = await import('src/tasks/McpTask/McpTask.js')
const mcpTaskSnap = snapshotModuleExports(realMcpTask)
const autoBgOutcome = {
  complete: 0,
  fail: 0,
  notifications: [] as string[],
  completeOpts: [] as Array<{ resourceLinks?: unknown[] } | undefined>,
}
function resetAutoBgOutcome(): void {
  autoBgOutcome.complete = 0
  autoBgOutcome.fail = 0
  autoBgOutcome.notifications = []
  autoBgOutcome.completeOpts = []
}
mock.module('src/tasks/McpTask/McpTask.js', () => ({
  ...mcpTaskSnap,
  registerMcpTask: () => 'task-bg-1',
  completeMcpTask: (
    _taskId: string,
    _setAppState: unknown,
    _statusMessage?: string,
    resourceLinks?: unknown[],
  ) => {
    autoBgOutcome.complete++
    autoBgOutcome.completeOpts.push(
      resourceLinks ? { resourceLinks } : undefined,
    )
    return true
  },
  failMcpTask: () => {
    autoBgOutcome.fail++
    return true
  },
}))
const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  ...growthbookMock(),
}))
mock.module(
  'src/utils/messageQueueManager.js',
  createMessageQueueManagerMock(realMessageQueue, {
    enqueuePendingNotification: command => {
      if (typeof command.value === 'string') {
        autoBgOutcome.notifications.push(command.value)
      }
    },
  }),
)
afterAll(() => {
  // Restore real queue / monitor / analytics surface for co-suites.
  mock.module('src/utils/messageQueueManager.js', () => ({ ...mqmSnap }))
  mock.module('src/tasks/McpTask/McpTask.js', () => ({
    ...mcpTaskSnap,
  }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const {
  DEFAULT_MCP_AUTO_BACKGROUND_MS,
  callMcpToolWithAutoBackground,
  collectMcpResourceLinks,
  formatMcpAutoBackgroundMovedMessage,
  isMcpAutoBackgroundEnabled,
  mcpContentToNotificationText,
  resolveMcpAutoBackgroundMs,
} = await import('../mcpAutoBackground.js')

describe('resolveMcpAutoBackgroundMs (densable Ncy)', () => {
  test('default 120s when env unset and gb default true', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS)
  })

  test('gb false → 0 when env unset', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: false, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('env positive', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '5000' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(5000)
  })

  test('env 0 disables', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '0' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('invalid env → 0', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: 'x' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('sse-ide / ws-ide always off', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        {
          transportType: 'sse-ide',
          gbEnabled: true,
          isNonInteractiveSession: false,
        },
      ),
    ).toBe(0)
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        {
          transportType: 'ws-ide',
          gbEnabled: true,
          isNonInteractiveSession: false,
        },
      ),
    ).toBe(0)
  })

  test('non-interactive requires CLAUDE_AUTO_BACKGROUND_TASKS', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: true, isNonInteractiveSession: true },
      ),
    ).toBe(0)
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_AUTO_BACKGROUND_TASKS: '1' },
        { gbEnabled: true, isNonInteractiveSession: true },
      ),
    ).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS)
  })

  test('densable pv: CLAUDE_CODE_DISABLE_BACKGROUND_TASKS forces 0', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {
          CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
          CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '5000',
          CLAUDE_AUTO_BACKGROUND_TASKS: '1',
        },
        {
          gbEnabled: true,
          isNonInteractiveSession: false,
          transportType: 'stdio',
        },
      ),
    ).toBe(0)
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: 'true' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })
})

describe('isMcpAutoBackgroundEnabled', () => {
  test('on when positive', () => {
    expect(
      isMcpAutoBackgroundEnabled(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1' },
        { isNonInteractiveSession: false },
      ),
    ).toBe(true)
  })
})

describe('formatMcpAutoBackgroundMovedMessage', () => {
  test('densable copy', () => {
    const msg = formatMcpAutoBackgroundMovedMessage({
      toolLabel: 'mcp__srv__tool',
      elapsedSeconds: 120,
      taskId: 'm1',
    })
    expect(msg).toContain(
      'MCP tool "mcp__srv__tool" is still running after 120s',
    )
    expect(msg).toContain('moved to the background as task m1')
    expect(msg).toContain('TaskStop with task_id "m1"')
    expect(msg).toContain('does not survive exiting this session')
  })
})

describe('callMcpToolWithAutoBackground autoBackgrounded stamp', () => {
  test('timeout path returns autoBackgrounded:true (not a real completion)', async () => {
    const parent = new AbortController()
    let resolveRun!: (v: {
      content: Array<{ type: 'text'; text: string }>
    }) => void
    const run = () =>
      new Promise<{ content: Array<{ type: 'text'; text: string }> }>(
        resolve => {
          resolveRun = resolve
        },
      )

    const result = await callMcpToolWithAutoBackground({
      run,
      serverName: 'srv',
      toolName: 'slow',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 20,
      toolLabel: 'mcp__srv__slow',
    })

    expect(result).toMatchObject({ autoBackgrounded: true })
    expect(
      Array.isArray(result.content) &&
        result.content.some(
          b =>
            typeof b === 'object' &&
            b &&
            'text' in b &&
            String((b as { text: string }).text).includes(
              'moved to the background',
            ),
        ),
    ).toBe(true)

    // let background promise settle to avoid unhandled rejection noise
    resolveRun({ content: [{ type: 'text', text: 'late' }] })
  })

  test('timeout then interrupted resolve fails the monitor (not completed)', async () => {
    resetAutoBgOutcome()
    const parent = new AbortController()
    let resolveRun!: (v: {
      content: string
      interrupted: boolean
      isError: boolean
    }) => void
    const run = () =>
      new Promise<{
        content: string
        interrupted: boolean
        isError: boolean
      }>(resolve => {
        resolveRun = resolve
      })

    await callMcpToolWithAutoBackground({
      run,
      serverName: 'srv',
      toolName: 'slow',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 20,
      toolLabel: 'mcp__srv__slow',
    })

    resolveRun({
      content: 'The tool call was interrupted before a result was received.',
      interrupted: true,
      isError: true,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(autoBgOutcome.fail).toBe(1)
    expect(autoBgOutcome.complete).toBe(0)
    expect(
      autoBgOutcome.notifications.some(n => n.includes('was interrupted')),
    ).toBe(true)
    expect(autoBgOutcome.notifications.some(n => n.includes('completed'))).toBe(
      false,
    )
  })

  test('fast settle does not stamp autoBackgrounded', async () => {
    const parent = new AbortController()
    const result = await callMcpToolWithAutoBackground({
      run: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      serverName: 'srv',
      toolName: 'fast',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 5_000,
    })
    expect(
      result &&
        typeof result === 'object' &&
        'autoBackgrounded' in result &&
        (result as { autoBackgrounded?: boolean }).autoBackgrounded,
    ).toBeFalsy()
  })

  test('timeout complete path forwards resource_link blocks to MonitorMcp', async () => {
    resetAutoBgOutcome()
    const parent = new AbortController()
    let resolveRun!: (v: {
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'resource_link'; uri: string; name: string }
      >
    }) => void
    const run = () =>
      new Promise<{
        content: Array<
          | { type: 'text'; text: string }
          | { type: 'resource_link'; uri: string; name: string }
        >
      }>(resolve => {
        resolveRun = resolve
      })

    await callMcpToolWithAutoBackground({
      run,
      serverName: 'srv',
      toolName: 'slow',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 20,
      toolLabel: 'mcp__srv__slow',
    })

    resolveRun({
      content: [
        { type: 'text', text: 'done' },
        { type: 'resource_link', uri: 'file:///tmp/a', name: 'a' },
        { type: 'resource_link', uri: 'file:///tmp/b', name: 'b' },
      ],
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(autoBgOutcome.complete).toBe(1)
    expect(autoBgOutcome.completeOpts[0]).toEqual({
      resourceLinks: [
        { uri: 'file:///tmp/a', name: 'a' },
        { uri: 'file:///tmp/b', name: 'b' },
      ],
    })
  })
})

describe('collectMcpResourceLinks', () => {
  test('collects resource_link blocks and caps at 50 and 64 KiB serialized', () => {
    const links = Array.from({ length: 60 }, (_, i) => ({
      type: 'resource_link' as const,
      uri: `file:///tmp/${i}`,
      name: String(i),
      _meta: { dropped: true },
    }))
    const collected = collectMcpResourceLinks([
      { type: 'text', text: 'x' },
      ...links,
    ])
    expect(collected).toHaveLength(50)
    expect(collected[0]).toEqual({ uri: 'file:///tmp/0', name: '0' })
    expect(collected[49]).toEqual({ uri: 'file:///tmp/49', name: '49' })

    const huge = Array.from({ length: 10 }, (_, i) => ({
      type: 'resource_link' as const,
      uri: `file:///tmp/${i}`,
      name: String(i),
      description: 'd'.repeat(10_000),
    }))
    const byteCapped = collectMcpResourceLinks(huge)
    expect(byteCapped.length).toBeLessThan(10)
    expect(JSON.stringify(byteCapped).length).toBeLessThanOrEqual(65_536)
  })

  test('returns empty when content has no resource_link', () => {
    expect(collectMcpResourceLinks([{ type: 'text', text: 'only' }])).toEqual(
      [],
    )
    expect(collectMcpResourceLinks('plain')).toEqual([])
  })
})

describe('mcpContentToNotificationText & parent abort wakeup (2.1.289)', () => {
  test('preserves >200-char text and formats resource / resource_link blocks', async () => {
    resetAutoBgOutcome()
    const longText = 'x'.repeat(1500)
    expect(
      mcpContentToNotificationText([
        { type: 'text', text: longText },
        { resource: { uri: 'file:///doc.md', text: 'body' } },
        {
          type: 'resource_link',
          name: 'spec',
          uri: 'https://example.com/spec',
          description: 'design',
        },
        { type: 'image', data: 'abc', mimeType: 'image/png' },
      ]),
    ).toBe(
      `${longText}\n[Resource at file:///doc.md] body\n[Resource link: spec] https://example.com/spec (design)\n[image]`,
    )

    const parent = new AbortController()
    let resolveRun!: (v: {
      content: Array<{ type: 'text'; text: string }>
    }) => void
    await callMcpToolWithAutoBackground({
      run: () =>
        new Promise<{ content: Array<{ type: 'text'; text: string }> }>(
          resolve => {
            resolveRun = resolve
          },
        ),
      serverName: 'srv',
      toolName: 'long',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 15,
    })
    resolveRun({ content: [{ type: 'text', text: longText }] })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(autoBgOutcome.notifications[0]).toContain(longText)
  })

  test('parentAbortController.abort() wakes race immediately without waiting autoBackgroundMs', async () => {
    const parent = new AbortController()
    let resolveRun!: (v: {
      content: string
      interrupted: boolean
      isError: boolean
    }) => void
    const started = Date.now()
    const promise = callMcpToolWithAutoBackground({
      run: () =>
        new Promise<{
          content: string
          interrupted: boolean
          isError: boolean
        }>(resolve => {
          resolveRun = resolve
        }),
      serverName: 'srv',
      toolName: 'abortable',
      parentAbortController: parent,
      setAppState: () => {},
      autoBackgroundMs: 60_000,
    })
    parent.abort()
    resolveRun({ content: 'interrupted', interrupted: true, isError: true })
    const out = await promise
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(out).not.toHaveProperty('autoBackgrounded')
  })
})
