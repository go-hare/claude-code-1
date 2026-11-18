import { describe, expect, test } from 'bun:test'
import { createTaskRegistry } from '../../../utils/taskRegistry.js'
import { createMcpTaskState, killMcpTask } from '../McpTask.js'

describe('McpTask (#390, #418)', () => {
  test('#418 sanitizes bidi and control characters in task description', () => {
    const task = createMcpTaskState({
      serverName: 'srv\u202Eevil',
      toolName: 'tool\x1b[31mred',
      mcpTaskId: 'm1',
    })
    expect(task.description).not.toContain('\u202E')
    expect(task.description).not.toContain('\x1b')
  })

  test('#390 killMcpTask aborts controllers and invokes endingGoesTo, onWorkerWakeOutcome, newsToConfirm', async () => {
    let state = { tasks: {} as Record<string, unknown> }
    const registry = createTaskRegistry(
      () => state as never,
      updater => {
        state = updater(state as never)
      },
    )
    const abortController = new AbortController()
    const driveAbortController = new AbortController()
    let endedWith: string | undefined
    let wakeKind: string | undefined
    let confirmed = false
    let sepCancelled = false

    const task = createMcpTaskState({
      serverName: 'srv',
      toolName: 'slow_tool',
      mcpTaskId: 'm2',
      abortController,
      driveAbortController,
    })
    task.sep2663Cancel = () => {
      sepCancelled = true
    }
    task.endingGoesTo = kind => {
      endedWith = kind
    }
    task.onWorkerWakeOutcome = outcome => {
      wakeKind = outcome.kind
    }
    task.newsToConfirm = [
      () => {
        confirmed = true
      },
    ]

    registry.register(task)
    await killMcpTask(task.id, registry)

    expect(abortController.signal.aborted).toBe(true)
    expect(driveAbortController.signal.aborted).toBe(true)
    expect(sepCancelled).toBe(true)
    expect(endedWith).toBe('stopped')
    expect(wakeKind).toBe('stopped')
    expect(confirmed).toBe(true)
    expect(registry.get(task.id)?.status).toBe('killed')
  })
})
