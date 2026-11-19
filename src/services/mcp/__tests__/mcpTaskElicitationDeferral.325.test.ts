import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import type { RequestDialog } from '../../../dialog/requestDialog.js'
import type { AppState } from '../../../state/AppState.js'
import {
  hasMcpTaskNeedingInput,
  McpTaskQuestionController,
  type McpTaskState,
} from '../../../tasks/McpTask/McpTask.js'
import { registerElicitationHandler } from '../elicitationHandler.js'
import type { ElicitRequestParams, ElicitResult } from '../types.js'

function makeRunningMcpTask(id: string, serverName: string): McpTaskState {
  return {
    id,
    type: 'mcp_task',
    status: 'running',
    description: 'Deploy release',
    startTime: Date.now(),
    outputFile: '/tmp/out',
    outputOffset: 0,
    notified: false,
    serverName,
    toolName: 'deploy',
    mcpTaskId: `remote-${id}`,
    mcpStatus: 'working',
  }
}

describe('#2307/#2309/#2349/#2367 background MCP task elicitation deferral & reopen', () => {
  test('McpTaskQuestionController only exposes openFn when state === off_screen (not asking)', () => {
    const events: Array<{
      hasOpen: boolean
      state: 'asking' | 'off_screen' | undefined
    }> = []
    const controller = new McpTaskQuestionController((openFn, state) => {
      events.push({ hasOpen: typeof openFn === 'function', state })
    })

    controller.set('asking')
    expect(events.at(-1)).toEqual({ hasOpen: false, state: 'asking' })

    controller.set('off_screen')
    expect(events.at(-1)).toEqual({ hasOpen: true, state: 'off_screen' })

    controller.set('asking')
    expect(events.at(-1)).toEqual({ hasOpen: false, state: 'asking' })

    controller.set(undefined)
    expect(events.at(-1)).toEqual({ hasOpen: false, state: undefined })
  })

  test('requestDialog path suspends on Esc for background MCP task until reopened and answered', async () => {
    type Handler = (
      request: { params: ElicitRequestParams },
      ctx: { mcpReq: { signal: AbortSignal; id: string | number } },
    ) => Promise<ElicitResult>

    let registeredHandler: Handler | undefined
    const mockClient = {
      setRequestHandler(method: string, handler: Handler) {
        if (method === 'elicitation/create') registeredHandler = handler
      },
      setNotificationHandler() {},
    } as unknown as Client

    const state: { tasks: Record<string, McpTaskState> } = {
      tasks: {
        'task-1': makeRunningMcpTask('task-1', 'deploy-srv'),
      },
    }
    const setAppState = (updater: (prev: AppState) => AppState) => {
      const next = updater(
        state as unknown as AppState,
      ) as unknown as typeof state
      state.tasks = next.tasks
    }

    const dialogCalls: Array<{
      resolve: (res: ElicitResult) => void
      payload: unknown
    }> = []
    const requestDialog: RequestDialog = ((
      _spec: unknown,
      payload: unknown,
    ) => {
      return new Promise<ElicitResult>(resolve => {
        dialogCalls.push({ resolve, payload })
      })
    }) as unknown as RequestDialog

    registerElicitationHandler(
      mockClient,
      'deploy-srv',
      setAppState,
      null,
      requestDialog,
    )
    expect(registeredHandler).toBeDefined()

    const ac = new AbortController()
    let settled = false
    const rpcPromise = registeredHandler!(
      {
        params: {
          message: 'Proceed with production deploy?',
          requestedSchema: { type: 'object', properties: {} },
          _meta: {
            'io.modelcontextprotocol/related-task': { taskId: 'remote-task-1' },
          },
        } as ElicitRequestParams,
      },
      { mcpReq: { signal: ac.signal, id: 1 } },
    ).then(res => {
      settled = true
      return res
    })

    // Wait for first dialog invocation
    await new Promise(r => setTimeout(r, 15))
    expect(dialogCalls).toHaveLength(1)
    // While asking on screen, task should NOT be flagged as needing off-screen input
    expect(state.tasks['task-1']?.questionState).toBe('asking')
    expect(state.tasks['task-1']?.openQuestion).toBeUndefined()
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(false)

    // User presses Esc -> "answer later"
    dialogCalls[0]!.resolve({ action: 'cancel' })
    await new Promise(r => setTimeout(r, 20))

    // CRITICAL: JSON-RPC response MUST NOT be sent to MCP server on Esc
    expect(settled).toBe(false)
    expect(state.tasks['task-1']?.questionState).toBe('off_screen')
    expect(typeof state.tasks['task-1']?.openQuestion).toBe('function')
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(true)

    // User presses Enter in /tasks to reopen
    state.tasks['task-1']!.openQuestion!()
    await new Promise(r => setTimeout(r, 20))
    expect(dialogCalls).toHaveLength(2)
    expect(state.tasks['task-1']?.questionState).toBe('asking')
    expect(state.tasks['task-1']?.openQuestion).toBeUndefined()
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(false)

    // User presses Esc a second time -> still suspended
    dialogCalls[1]!.resolve({ action: 'cancel' })
    await new Promise(r => setTimeout(r, 20))
    expect(settled).toBe(false)
    expect(state.tasks['task-1']?.questionState).toBe('off_screen')
    expect(typeof state.tasks['task-1']?.openQuestion).toBe('function')

    // Reopen again and accept
    state.tasks['task-1']!.openQuestion!()
    await new Promise(r => setTimeout(r, 20))
    expect(dialogCalls).toHaveLength(3)
    dialogCalls[2]!.resolve({ action: 'accept', content: { ok: true } })

    const finalResult = await rpcPromise
    expect(settled).toBe(true)
    expect(finalResult).toEqual({ action: 'accept', content: { ok: true } })
    expect(state.tasks['task-1']?.questionState).toBeUndefined()
    expect(state.tasks['task-1']?.openQuestion).toBeUndefined()
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(false)
  })

  test('requestDialog path resolves cancel and cleans up task state when signal aborts while suspended', async () => {
    type Handler = (
      request: { params: ElicitRequestParams },
      ctx: { mcpReq: { signal: AbortSignal; id: string | number } },
    ) => Promise<ElicitResult>

    let registeredHandler: Handler | undefined
    const mockClient = {
      setRequestHandler(method: string, handler: Handler) {
        if (method === 'elicitation/create') registeredHandler = handler
      },
      setNotificationHandler() {},
    } as unknown as Client

    const state: { tasks: Record<string, McpTaskState> } = {
      tasks: {
        'task-2': makeRunningMcpTask('task-2', 'deploy-srv'),
      },
    }
    const setAppState = (updater: (prev: AppState) => AppState) => {
      const next = updater(
        state as unknown as AppState,
      ) as unknown as typeof state
      state.tasks = next.tasks
    }

    const requestDialog: RequestDialog = (async () => ({
      action: 'cancel',
    })) as unknown as RequestDialog

    registerElicitationHandler(
      mockClient,
      'deploy-srv',
      setAppState,
      null,
      requestDialog,
    )

    const ac = new AbortController()
    let settled = false
    const rpcPromise = registeredHandler!(
      {
        params: {
          message: 'Enter token',
          requestedSchema: { type: 'object', properties: {} },
          _meta: {
            'io.modelcontextprotocol/related-task': { taskId: 'task-2' },
          },
        } as ElicitRequestParams,
      },
      { mcpReq: { signal: ac.signal, id: 2 } },
    ).then(res => {
      settled = true
      return res
    })

    await new Promise(r => setTimeout(r, 20))
    expect(settled).toBe(false)
    expect(state.tasks['task-2']?.questionState).toBe('off_screen')
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(true)

    ac.abort()
    const res = await rpcPromise
    expect(res).toEqual({ action: 'cancel' })
    expect(state.tasks['task-2']?.questionState).toBeUndefined()
    expect(state.tasks['task-2']?.openQuestion).toBeUndefined()
    expect(hasMcpTaskNeedingInput(state.tasks)).toBe(false)
  })

  test('REPL.tsx wires reopenedElicitationKey, draft-held reopen, prevTaskId cleanup, and abort listener cleanup', () => {
    const replSrc = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(replSrc).toContain('reopenedElicitationKey')
    expect(replSrc).toContain('isReopenedElicitation')
    expect(replSrc).toContain('prevQueuedMcpTaskIdRef')
    expect(replSrc).toContain('deferredMcpAbortCleanupsRef')
    expect(replSrc).toContain('clearDeferredMcpElicitation')
    expect(replSrc).toContain("removeEventListener('abort', onAbort)")
  })
})
