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
// Incomplete MonitorMcp strip drops killMonitorMcp and poisons shellKeepalive co-suites.
const realMonitorMcp = await import('src/tasks/MonitorMcpTask/MonitorMcpTask.js')
const monitorMcpSnap = snapshotModuleExports(realMonitorMcp)
mock.module('src/tasks/MonitorMcpTask/MonitorMcpTask.js', () => ({
  ...monitorMcpSnap,
  registerMonitorMcpTask: () => 'task-bg-1',
  completeMonitorMcpTask: () => {},
  failMonitorMcpTask: () => {},
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
    enqueuePendingNotification: () => {},
  }),
)
afterAll(() => {
  // Restore real queue / monitor / analytics surface for co-suites.
  mock.module('src/utils/messageQueueManager.js', () => ({ ...mqmSnap }))
  mock.module('src/tasks/MonitorMcpTask/MonitorMcpTask.js', () => ({
    ...monitorMcpSnap,
  }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const {
  DEFAULT_MCP_AUTO_BACKGROUND_MS,
  callMcpToolWithAutoBackground,
  formatMcpAutoBackgroundMovedMessage,
  isMcpAutoBackgroundEnabled,
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
})
