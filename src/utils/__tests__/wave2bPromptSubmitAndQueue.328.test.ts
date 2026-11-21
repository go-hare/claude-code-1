/**
 * Wave 2B regression tests — handlePromptSubmit (xLt + sz generation guards
 * and abort/throw resurrection) and queueProcessor (t0t priority/shouldQuery/
 * ideSelection batching).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { Command } from '../../commands.js'
import { handlePromptSubmit } from '../handlePromptSubmit.js'
import {
  enqueue,
  getCommandQueue,
  resetCommandQueue,
} from '../messageQueueManager.js'
import { processQueueIfReady } from '../queueProcessor.js'
import { QueryGuard } from '../QueryGuard.js'

describe('Wave 2B queueProcessor (2.1.328 t0t / cz)', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  afterEach(() => {
    resetCommandQueue()
  })

  test('now-priority item is never blocked behind a screeningPending next-priority item', () => {
    const executed: string[][] = []
    enqueue({
      value: 'normal screening prompt',
      mode: 'prompt',
      priority: 'next',
      screeningPending: true,
      agentId: getMainThreadAgentId(),
    })
    enqueue({
      value: 'urgent now prompt',
      mode: 'prompt',
      priority: 'now',
      agentId: getMainThreadAgentId(),
    })

    const res = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })

    expect(res.processed).toBe(true)
    expect(executed).toEqual([['urgent now prompt']])
    expect(getCommandQueue().map(c => String(c.value))).toEqual([
      'normal screening prompt',
    ])
  })

  test('does not mix shouldQuery:false transcript-only items with model-querying items', () => {
    const executed: string[][] = []
    enqueue({
      value: 'query prompt',
      mode: 'prompt',
      priority: 'next',
      agentId: getMainThreadAgentId(),
    })
    enqueue({
      value: 'transcript only note',
      mode: 'prompt',
      priority: 'next',
      shouldQuery: false,
      agentId: getMainThreadAgentId(),
    })

    const first = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(first.processed).toBe(true)
    expect(executed).toEqual([['query prompt']])

    const second = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(second.processed).toBe(true)
    expect(executed).toEqual([['query prompt'], ['transcript only note']])
  })

  test('breaks batch before a second item carrying ideSelection.text', () => {
    const executed: string[][] = []
    enqueue({
      value: 'first with selection',
      mode: 'prompt',
      priority: 'next',
      ideSelection: { text: 'const a = 1', filePath: 'a.ts', lineCount: 1 },
      agentId: getMainThreadAgentId(),
    })
    enqueue({
      value: 'middle no selection',
      mode: 'prompt',
      priority: 'next',
      agentId: getMainThreadAgentId(),
    })
    enqueue({
      value: 'second with selection',
      mode: 'prompt',
      priority: 'next',
      ideSelection: { text: 'const b = 2', filePath: 'b.ts', lineCount: 1 },
      agentId: getMainThreadAgentId(),
    })

    const first = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(first.processed).toBe(true)
    expect(executed).toEqual([['first with selection', 'middle no selection']])

    const second = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(second.processed).toBe(true)
    expect(executed).toEqual([
      ['first with selection', 'middle no selection'],
      ['second with selection'],
    ])
  })

  test('does not mix different priority tiers of the same mode in one batch', () => {
    const executed: string[][] = []
    enqueue({
      value: 'later prompt',
      mode: 'prompt',
      priority: 'later',
      agentId: getMainThreadAgentId(),
    })
    enqueue({
      value: 'next prompt',
      mode: 'prompt',
      priority: 'next',
      agentId: getMainThreadAgentId(),
    })

    const first = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(first.processed).toBe(true)
    expect(executed).toEqual([['next prompt']])
    expect(getCommandQueue().map(c => String(c.value))).toEqual([
      'later prompt',
    ])
  })
})

describe('Wave 2B handlePromptSubmit (2.1.328 xLt + sz)', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  afterEach(() => {
    resetCommandQueue()
  })

  function makeContext(abortController: AbortController) {
    const state = getDefaultAppState()
    return {
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
    }
  }

  test('local empty-messages slash command unwinding after Esc cannot clear a newer turn reservation or abortController', async () => {
    const guard = new QueryGuard()
    const slashEntered = Promise.withResolvers<void>()
    const slashFinish = Promise.withResolvers<void>()
    let liveAc: AbortController | null = null

    const slowLocalSlash: Command = {
      type: 'local-jsx',
      name: 'slow-dialog',
      description: 'slow fixture',
      isEnabled: () => true,
      isHidden: false,
      userFacingName: () => 'slow-dialog',
      load: async () => ({
        call: async onDone => {
          slashEntered.resolve()
          await slashFinish.promise
          onDone(undefined, { display: 'skip' })
          return null
        },
      }),
    }

    const oldSubmit = handlePromptSubmit({
      helpers: { setCursorOffset() {}, clearBuffer() {}, resetHistory() {} },
      queryGuard: guard,
      queuedCommands: [
        {
          mode: 'prompt',
          value: '/slow-dialog',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'human' },
        },
      ],
      commands: [slowLocalSlash],
      messages: [],
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      getToolUseContext: (_m, _n, ac) =>
        ({
          ...makeContext(ac),
          options: {
            ...makeContext(ac).options,
            commands: [slowLocalSlash],
          },
        }) as any,
      onInputChange() {},
      setPastedContents() {},
      setToolJSX() {},
      setUserInputOnProcessing() {},
      setAbortController: ac => {
        liveAc = ac
      },
      setAppState() {},
      onQuery: async () => true,
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      awaitSessionStartHooks: () => undefined,
    })

    await slashEntered.promise
    // Esc cancels old submit and a new turn immediately reserves + arms its own AC
    guard.forceEnd()
    const newAc = new AbortController()
    liveAc = newAc
    expect(guard.reserve()).toBe(true)
    const nextGen = guard.generation

    // Now the old local slash command finishes its empty-messages else branch
    slashFinish.resolve()
    await oldSubmit

    // Newer turn's reservation and abortController MUST remain intact
    expect(guard.generation).toBe(nextGen)
    expect(guard.isActive).toBe(true)
    expect(liveAc).toBe(newAc)
    guard.cancelReservation()
  })

  test('Esc abort during processUserInput restores human prompt to composer and resurrects trailing non-human commands', async () => {
    const guard = new QueryGuard()
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    let liveAc: AbortController | null = null
    const restored: string[] = []
    let onQueryCalls = 0

    const slowSlash: Command = {
      type: 'local',
      name: 'slow-op',
      description: 'slow fixture',
      isEnabled: () => true,
      isHidden: false,
      userFacingName: () => 'slow-op',
      supportsNonInteractive: false,
      load: async () => ({
        call: async () => {
          entered.resolve()
          await finish.promise
          return { type: 'text', value: '' }
        },
      }),
    }

    const pending = handlePromptSubmit({
      helpers: { setCursorOffset() {}, clearBuffer() {}, resetHistory() {} },
      queryGuard: guard,
      queuedCommands: [
        {
          mode: 'prompt',
          value: '/slow-op',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'human' },
          historyEntry: { display: '/slow-op', pastedContents: {} },
        },
        {
          mode: 'prompt',
          value: 'follow-up human text',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'human' },
          historyEntry: { display: 'follow-up human text', pastedContents: {} },
        },
        {
          mode: 'task-notification',
          value: '<task-notification>done</task-notification>',
          agentId: getMainThreadAgentId(),
          origin: { kind: 'task-notification' },
        },
      ],
      commands: [slowSlash],
      messages: [],
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      getToolUseContext: (_m, _n, ac) =>
        ({
          ...makeContext(ac),
          options: {
            ...makeContext(ac).options,
            commands: [slowSlash],
          },
        }) as any,
      onInputChange() {},
      setPastedContents() {},
      setToolJSX() {},
      setUserInputOnProcessing() {},
      setAbortController: ac => {
        liveAc = ac
      },
      setAppState() {},
      onQuery: async () => {
        onQueryCalls++
        return true
      },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      restoreHandedBackPrompt: text => restored.push(text),
      awaitSessionStartHooks: () => undefined,
    })

    await entered.promise
    // Simulate Esc: forceEnd + user-cancel abort while processUserInput is awaiting
    guard.forceEnd()
    liveAc!.abort('user-cancel')
    finish.resolve()
    await pending

    expect(onQueryCalls).toBe(0)
    // Human prompts restored to composer, task-notification resurrected to queue
    expect(restored).toContain('follow-up human text')
    const resurrected = getCommandQueue()
    expect(resurrected).toHaveLength(1)
    expect(resurrected[0]).toMatchObject({
      mode: 'task-notification',
      value: '<task-notification>done</task-notification>',
      admissionExempt: 'resurrected',
    })
  })

  test('throw inside processUserInput resurrects non-human siblings (demoting now->next) and hands back unwritten human prompts', async () => {
    const guard = new QueryGuard()
    const restored: string[] = []
    let contextCalls = 0

    await expect(
      handlePromptSubmit({
        helpers: { setCursorOffset() {}, clearBuffer() {}, resetHistory() {} },
        queryGuard: guard,
        queuedCommands: [
          {
            mode: 'prompt',
            value: 'human typed prompt',
            agentId: getMainThreadAgentId(),
            origin: { kind: 'human' },
            historyEntry: { display: 'human typed prompt', pastedContents: {} },
          },
          {
            mode: 'task-notification',
            value: '<task-notification>urgent</task-notification>',
            priority: 'now',
            agentId: getMainThreadAgentId(),
            origin: { kind: 'task-notification' },
          },
        ],
        commands: [],
        messages: [],
        mainLoopModel: 'claude-opus-5',
        ideSelection: undefined,
        querySource: 'repl_main_thread',
        getToolUseContext: () => {
          contextCalls++
          throw new Error('simulated processUserInput crash')
        },
        onInputChange() {},
        setPastedContents() {},
        setToolJSX() {},
        setUserInputOnProcessing() {},
        setAbortController() {},
        setAppState() {},
        onQuery: async () => true,
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        restoreHandedBackPrompt: text => restored.push(text),
        awaitSessionStartHooks: () => undefined,
      }),
    ).rejects.toThrow('simulated processUserInput crash')

    expect(contextCalls).toBe(1)
    expect(restored).toEqual(['human typed prompt'])
    const resurrected = getCommandQueue()
    expect(resurrected).toHaveLength(1)
    expect(resurrected[0]).toMatchObject({
      mode: 'task-notification',
      value: '<task-notification>urgent</task-notification>',
      priority: 'next',
      admissionExempt: 'resurrected',
    })
  })
})
