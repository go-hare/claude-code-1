import { afterEach, expect, test } from 'bun:test'
import type { RunReplTurnDeps } from '../runReplTurn.js'

// Other suites replace the queue module process-wide. Keep these real-path
// regressions in a fresh registry without mocking the business modules.
if (process.env.REPL_REQUEUE_REGRESSION_CHILD !== '1') {
  test('real concurrent requeue regressions run in an isolated module registry', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, REPL_REQUEUE_REGRESSION_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0)
      throw new Error(
        `concurrent requeue regressions failed (${code}):\n${stdout}\n${stderr}`,
      )
    expect(code).toBe(0)
  })
} else {
  const { randomUUID } = await import('node:crypto')
  const { getDefaultAppState } = await import('../../../state/AppStateStore.js')
  const { getMainThreadAgentId } = await import('../../../bootstrap/state.js')
  const { handlePromptSubmit } = await import(
    '../../../utils/handlePromptSubmit.js'
  )
  const { createUserMessage } = await import('../../../utils/messages.js')
  const { QueryGuard } = await import('../../../utils/QueryGuard.js')
  const { createMessageQueue, getActiveMessageQueue, setActiveMessageQueue } =
    await import('../../../utils/messageQueueManager.js')
  const { runReplTurn } = await import('../runReplTurn.js')
  const previousQueue = getActiveMessageQueue()
  afterEach(() => setActiveMessageQueue(previousQueue))

  test.each([
    'human',
    'task-notification',
  ])('queued transcript-only provenance survives processing and requeue (%s)', async kind => {
    const queue = createMessageQueue()
    setActiveMessageQueue(queue)
    const guard = new QueryGuard()
    const state = getDefaultAppState()
    let queried: boolean | undefined
    await handlePromptSubmit({
      helpers: { setCursorOffset() {}, clearBuffer() {}, resetHistory() {} },
      queryGuard: guard,
      commands: [],
      messages: [],
      mainLoopModel: 'fixture',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      queuedCommands: [
        {
          uuid: randomUUID(),
          agentId: getMainThreadAgentId(),
          mode: 'prompt',
          value: 'round trip fixture',
          origin: { kind },
          shouldQuery: false,
          skipAttachments: true,
          skipSlashCommands: true,
          scheduledTaskId: 'schedule-fixture',
          scheduledFireId: 'fire-fixture',
          taskDelivery: { id: 'delivery' },
        },
      ],
      getToolUseContext: (_messages, _newMessages, abortController) =>
        ({
          abortController,
          getAppState: () => state,
          setAppState() {},
          setToolPermissionContext() {},
          readFileState: new Map(),
          messages: [],
          nestedMemoryAttachmentTriggers: [],
          options: {
            commands: [],
            tools: [],
            mainLoopModel: 'fixture',
            isNonInteractiveSession: false,
            debug: false,
            verbose: false,
            agentDefinitions: { activeAgents: [], allAgents: [] },
          },
        }) as any,
      onInputChange() {},
      setPastedContents() {},
      setToolJSX() {},
      setUserInputOnProcessing() {},
      setAbortController() {},
      setAppState() {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      onQuery: async (
        newMessages,
        abortController,
        shouldQuery,
        additionalAllowedTools,
        mainLoopModelParam,
      ) => {
        queried = shouldQuery
        guard.tryStart()
        return runReplTurn(
          {
            newMessages,
            abortController,
            shouldQuery,
            additionalAllowedTools,
            mainLoopModelParam,
          },
          { queryGuard: guard } as RunReplTurnDeps,
        )
      },
    })
    expect(queried).toBe(false)
    expect(queue.getCommands()).toHaveLength(1)
    expect(queue.getCommands()[0]).toMatchObject({
      mode: 'prompt',
      origin: { kind },
      shouldQuery: false,
      skipAttachments: true,
      skipSlashCommands: true,
      admissionExempt: 'resurrected',
      scheduledTaskId: 'schedule-fixture',
      scheduledFireId: 'fire-fixture',
      taskDelivery: { id: 'delivery' },
    })
  })

  test('concurrent turns resurrect queued provenance without re-enqueuing dispatch echoes', async () => {
    const queue = createMessageQueue()
    setActiveMessageQueue(queue)
    const guard = new QueryGuard()
    guard.tryStart()
    const origin = { kind: 'channel', source: 'fixture' }
    const prompt = createUserMessage({ content: 'fixture', isMeta: true })
    Object.assign(prompt, {
      queueOrigin: origin,
      queueMode: 'task-notification',
      queueSkipAttachments: true,
      queueSkipSlashCommands: true,
      queueTranscriptOnly: true,
      queuePriority: 'later',
      scheduledTaskId: 'task-fixture',
      scheduledFireId: 'fire-fixture',
      taskDelivery: { id: 'delivery' },
    })
    const echo = createUserMessage({ content: 'display echo' })
    echo.dispatchEcho = true
    const result = await runReplTurn(
      {
        newMessages: [echo, prompt],
        abortController: new AbortController(),
        shouldQuery: true,
        additionalAllowedTools: [],
        mainLoopModelParam: 'fixture',
      },
      { queryGuard: guard } as RunReplTurnDeps,
    )
    expect(result).toBe(false)
    expect(queue.getCommands()).toHaveLength(1)
    expect(queue.getCommands()[0]).toMatchObject({
      uuid: prompt.uuid,
      value: 'fixture',
      mode: 'task-notification',
      origin,
      admissionExempt: 'resurrected',
      skipAttachments: true,
      skipSlashCommands: true,
      shouldQuery: false,
      priority: 'later',
      scheduledTaskId: 'task-fixture',
      scheduledFireId: 'fire-fixture',
      taskDelivery: { id: 'delivery' },
    })
  })
}
