import { describe, expect, test } from 'bun:test'
import { stopTask } from '../../tasks/stopTask.js'
import { dequeueAll, resetCommandQueue } from '../messageQueueManager.js'
import {
  formatMcpReconnectOutcome,
  missingMcpReconnectTarget,
  renderReplMcpNeedsAuthNotice,
  replMcpNeedsAuthServersOf,
} from '../../services/mcp/mcpReconnectRemedy.js'
import {
  MAX_WEBSOCKET_MESSAGE_BYTES,
  WebSocketTransport,
} from '../mcpWebSocketTransport.js'

describe('#466 WebSocketTransport 16 MiB cap', () => {
  test('rejects and closes connection when Bun message exceeds 16 MiB without parsing', () => {
    expect(MAX_WEBSOCKET_MESSAGE_BYTES).toBe(16_777_216)
    let closed = false
    let errored: Error | undefined
    let messaged = false
    const fakeWs = {
      readyState: 1,
      addEventListener() {},
      removeEventListener() {},
      close() {
        closed = true
      },
      send() {},
    }
    const transport = new WebSocketTransport(fakeWs as never)
    transport.onerror = e => {
      errored = e
    }
    transport.onmessage = () => {
      messaged = true
    }

    const oversized = 'x'.repeat(MAX_WEBSOCKET_MESSAGE_BYTES + 1)
    ;(
      transport as unknown as { onBunMessage: (ev: { data: string }) => void }
    ).onBunMessage({ data: oversized })

    expect(messaged).toBe(false)
    expect(closed).toBe(true)
    expect(errored?.message).toContain('over 16 MiB')
  })
})

describe('#522 mcpReconnectRemedy remote/REPL auth notices', () => {
  test('replMcpNeedsAuthServersOf and renderReplMcpNeedsAuthNotice match SEA', () => {
    const servers = replMcpNeedsAuthServersOf({
      servers: [
        { name: 'linear', authTool: 'mcp__linear__auth' },
        { bad: true },
      ],
    })
    expect(servers).toEqual([])

    const valid = replMcpNeedsAuthServersOf({
      servers: [{ name: 'linear', authTool: 'mcp__linear__auth' }],
    })
    expect(valid).toEqual([{ name: 'linear', authTool: 'mcp__linear__auth' }])
    expect(renderReplMcpNeedsAuthNotice(valid)).toBe(
      'MCP server linear needs authentication before its tools answer; its mcp__linear__auth tool is callable from a script.',
    )
  })

  test('formatMcpReconnectOutcome and missingMcpReconnectTarget avoid /mcp & claude mcp in remote mode', () => {
    const outcome = formatMcpReconnectOutcome(
      'linear',
      [{ ok: true, type: 'needs-auth' }],
      null,
      { isRemote: true },
    )
    expect(outcome).toContain('Open MCP servers from the command menu.')
    expect(outcome).not.toContain('/mcp')

    const missingAll = missingMcpReconnectTarget('all', { isRemote: true })
    expect(missingAll).toBe('No MCP servers are configured.')
    expect(missingAll).not.toContain('claude mcp add')

    const missingOne = missingMcpReconnectTarget('linear', { isRemote: true })
    expect(missingOne).toBe('There\'s no MCP server named "linear".')
  })
})

describe('#390 stopTask mcp_task user/client stop notification', () => {
  test('stopTask on mcp_task with source=user enqueues "was stopped by the user" notification and returns note', async () => {
    resetCommandQueue()
    const ac = new AbortController()
    let appState = {
      tasks: {
        'mcp-1': {
          id: 'mcp-1',
          type: 'mcp_task',
          status: 'running',
          description: 'Run slow MCP query',
          toolUseId: 'tu-mcp-1',
          startTime: Date.now(),
          outputFile: '/tmp/mcp-1.out',
          outputOffset: 0,
          notified: false,
          abortController: ac,
        },
      },
    } as never

    const res = await stopTask('mcp-1', {
      getAppState: () => appState,
      setAppState: updater => {
        appState = (updater as (p: unknown) => typeof appState)(appState)
      },
      source: 'user',
    })

    expect(res.taskId).toBe('mcp-1')
    expect(res.taskType).toBe('mcp_task')
    expect(res.note).toContain('Cancellations are fire and forget')
    const notifications = dequeueAll()
    expect(notifications.length).toBe(1)
    expect(notifications[0]?.value).toContain(
      'Task "Run slow MCP query" was stopped by the user',
    )
    expect(notifications[0]?.value).toContain(
      'No result will follow. The MCP server may already have done some of the work',
    )
  })
})
