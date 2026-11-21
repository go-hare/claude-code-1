import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { handlePromptSubmit } from '../handlePromptSubmit.js'
import { QueryGuard } from '../QueryGuard.js'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import {
  enqueue,
  getCommandQueue,
  popEditableAt,
  resetCommandQueue,
} from '../messageQueueManager.js'

describe('2.1.299 prompt submit & queue alignment (#611)', () => {
  afterEach(() => {
    resetCommandQueue()
  })

  test('messageQueueManager popEditableAt preserves inline pastedContents alongside images', () => {
    resetCommandQueue()
    enqueue({
      value: 'hello',
      mode: 'prompt',
      pastedContents: {
        1: { id: 1, type: 'text', content: 'inline-doc', inline: true },
        2: { id: 2, type: 'text', content: 'ref-only' },
        3: { id: 3, type: 'image', content: 'abc', mediaType: 'image/png' },
      },
    })

    const poppedOne = popEditableAt(0, '', 0)
    expect(poppedOne).toBeDefined()
    expect(poppedOne!.images.map(i => i.id)).toEqual([1, 3])
  })

  test.each([
    false,
    true,
  ])('an Esc-cancelled submit cannot release or requeue a newer reservation (cancel before hook wait: %s)', async cancelBeforeWait => {
    const queryGuard = new QueryGuard()
    const waiting = Promise.withResolvers<void>()
    const finishOldHooks = Promise.withResolvers<void>()
    let oldController: AbortController | null = null
    const placeholderWrites: (string | undefined)[] = []
    const restored: string[] = []
    const pending = handlePromptSubmit({
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      queryGuard,
      queuedCommands: [
        {
          mode: 'prompt',
          value: 'cancelled prompt',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'human' },
        },
      ],
      commands: [],
      messages: [],
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      getToolUseContext: () => {
        throw new Error('cancelled before input processing')
      },
      onInputChange: () => {},
      setPastedContents: () => {},
      setToolJSX: () => {},
      setUserInputOnProcessing: value => placeholderWrites.push(value),
      setAbortController: value => {
        oldController = value
      },
      setAppState: () => {},
      onQuery: async () => {
        throw new Error('cancelled before querying')
      },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      restoreHandedBackPrompt: text => restored.push(text),
      awaitSessionStartHooks: async () => {
        waiting.resolve()
        await finishOldHooks.promise
      },
    })
    if (!cancelBeforeWait) await waiting.promise
    queryGuard.forceEnd()
    oldController!.abort('user-cancel')
    expect(queryGuard.reserve()).toBe(true)
    const nextGeneration = queryGuard.generation
    const writesBeforeOldFinishes = placeholderWrites.length
    await waiting.promise
    finishOldHooks.resolve()
    await pending
    expect(restored).toEqual(['cancelled prompt'])
    expect(getCommandQueue()).toEqual([])
    expect(queryGuard.generation).toBe(nextGeneration)
    expect(queryGuard.isActive).toBe(true)
    expect(placeholderWrites).toHaveLength(writesBeforeOldFinishes)
    queryGuard.cancelReservation()
  })

  test('queued input processing marks the actual guard before handing off to onQuery', async () => {
    const guard = new QueryGuard()
    const state = getDefaultAppState()
    let queried = false
    const context = (abortController: AbortController) =>
      ({
        abortController,
        getAppState: () => state,
        setAppState: () => {},
        setToolPermissionContext: () => {},
        readFileState: new Map(),
        messages: [],
        nestedMemoryAttachmentTriggers: [],
        options: {
          commands: [],
          tools: [],
          isNonInteractiveSession: false,
          mainLoopModel: 'claude-opus-5',
          debug: false,
          verbose: false,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
      }) as any
    await handlePromptSubmit({
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      queryGuard: guard,
      queuedCommands: [
        {
          mode: 'prompt',
          value: 'queued model fixture',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'human' },
          skipAttachments: true,
        },
      ],
      commands: [],
      messages: [],
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      getToolUseContext: (_messages, _newMessages, abort) => context(abort),
      onInputChange: () => {},
      setPastedContents: () => {},
      setToolJSX: () => {},
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      setAppState: () => {},
      onQuery: async () => {
        queried = true
        expect(guard.isRunning).toBe(false)
        expect(guard.isDispatchingForModel).toBe(true)
        return true
      },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      awaitSessionStartHooks: () => undefined,
    })
    expect(queried).toBe(true)
    expect(guard.isDispatchingForModel).toBe(false)
  })

  test('handlePromptSubmit preserves pastedContents for inline/referenced/expanded pastes', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../handlePromptSubmit.ts'),
      'utf8',
    )
    expect(src).toContain('const keepPastedContents =')
    expect(src).toContain(
      'pastedContents: keepPastedContents ? pastedContents : undefined',
    )
  })
})
