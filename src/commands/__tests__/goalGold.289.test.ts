import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import React from 'react'

import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

import { getSessionId, setSessionTrustAccepted } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import {
  addSessionHook,
  getSessionHooks,
} from '../../utils/hooks/sessionHooks.js'
import goal from '../goal.js'
import jsxGoal from '../goal/index.js'
import { getAllBaseTools } from '../../tools.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

/**
 * densable 2.1.289: /goal is Stop-hook + AppState.activeGoal.
 * Gold registers local-jsx Dialog (default) + local headless twin.
 * Analog GoalTool / goalState Map / footer pill must stay gone.
 */
describe('gold /goal (Stop-hook) vs analog GoalTool', () => {
  test('commands.ts registers gold local-jsx + local twin', async () => {
    const src = await Bun.file(join(ROOT, 'src/commands.ts')).text()
    expect(src).toContain("from './commands/goal/index.js'")
    expect(src).toContain('goalNonInteractive')
    expect(src).not.toContain("import goal from './commands/goal.js'")
    expect(src).not.toContain('goalCmd')
  })

  test('jsx default is local-jsx Dialog; twin is local headless', () => {
    expect(jsxGoal.type).toBe('local-jsx')
    expect(jsxGoal.description).toBe('Set a goal Claude checks before stopping')
    expect(jsxGoal.immediate).toBe(true)
    expect(goal.type).toBe('local')
    expect(goal.supportsNonInteractive).toBe(true)
  })

  test('Ade/kDe keeps local twin and drops jsx in headless', async () => {
    const { isCommandAvailableInHeadless, filterCommandsForHeadless } =
      await import('../../commands.js')
    expect(isCommandAvailableInHeadless(jsxGoal)).toBe(false)
    expect(isCommandAvailableInHeadless(goal)).toBe(true)
    const filtered = filterCommandsForHeadless([jsxGoal, goal])
    expect(filtered).toEqual([goal])
  })

  test('gold /goal writes AppState.activeGoal and Goal set:', async () => {
    const src = await Bun.file(join(ROOT, 'src/commands/goal.ts')).text()
    expect(src).toContain('activeGoal:')
    expect(src).toContain('Goal set:')
    expect(src).toContain("type: 'prompt'")
    expect(src).not.toContain('goalState')
  })

  test('tool pool has ProposeGoal, not analog GoalTool', async () => {
    const src = await Bun.file(join(ROOT, 'src/tools.ts')).text()
    expect(src).toContain('ProposeGoalTool')
    expect(src).not.toContain('tools/GoalTool/GoalTool')
    expect(src).not.toMatch(/\bGoalTool\b/)
  })

  test('DEFAULT_BUILD_FEATURES does not include analog GOAL', async () => {
    const src = await Bun.file(join(ROOT, 'scripts/defines.ts')).text()
    const start = src.indexOf('export const DEFAULT_BUILD_FEATURES')
    const chunk = src.slice(start, src.indexOf('] as const', start))
    expect(chunk).not.toMatch(/^\s*'GOAL',/m)
  })
})

describe('gold /goal call: set / status / clear', () => {
  afterEach(() => {
    setSessionTrustAccepted(false)
  })

  function box() {
    const state: Pick<
      AppState,
      'activeGoal' | 'sessionHooks' | 'queuedGoalOrigin'
    > = {
      activeGoal: undefined,
      sessionHooks: new Map(),
      queuedGoalOrigin: undefined,
    }
    const messages: Message[] = []
    const context = {
      agentId: undefined,
      messages,
      getAppState: () => state as AppState,
      setAppState(f: (prev: AppState) => AppState) {
        const next = f(state as AppState)
        state.activeGoal = next.activeGoal
        state.sessionHooks = next.sessionHooks
        state.queuedGoalOrigin = next.queuedGoalOrigin
      },
      setMessages(f: (prev: Message[]) => Message[]) {
        const next = f(messages)
        messages.splice(0, messages.length, ...next)
      },
    }
    return { state, messages, context }
  }

  test('empty status uses gold copy, not analog No active goal', async () => {
    const { context } = box()
    const loaded = await goal.load()
    const result = await loaded.call('', context as never)
    expect(result).toEqual({
      type: 'text',
      value: 'No goal set. Usage: `/goal <condition>`',
    })
    expect(JSON.stringify(result)).not.toContain('No active goal')
  })

  test('set 全面对齐 writes activeGoal + Stop hook + Goal set:', async () => {
    setSessionTrustAccepted(true)
    const { state, messages, context } = box()
    const loaded = await goal.load()
    const result = await loaded.call('全面对齐', context as never)
    expect(result).toEqual({
      type: 'query',
      value: 'Goal set: 全面对齐',
      prompt: expect.stringContaining('Stop hook is now active'),
    })
    expect(state.activeGoal?.condition).toBe('全面对齐')
    expect(state.activeGoal?.origin).toBe('user')
    const stopHooks =
      getSessionHooks(state as AppState, getSessionId(), 'Stop').get('Stop') ??
      []
    expect(
      stopHooks.some(m =>
        m.hooks.some(h => h.type === 'prompt' && h.prompt === '全面对齐'),
      ),
    ).toBe(true)
    expect(messages.some(m => m.type === 'attachment')).toBe(true)
  })

  test('status then clear tears down activeGoal', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    const loaded = await goal.load()
    await loaded.call('全面对齐', context as never)
    const status = await loaded.call('', context as never)
    expect(status.type).toBe('text')
    if (status.type === 'text') {
      expect(status.value).toContain('Goal active: 全面对齐')
    }
    const cleared = await loaded.call('clear', context as never)
    expect(cleared).toEqual({
      type: 'text',
      value: 'Goal cleared: 全面对齐',
    })
    expect(state.activeGoal).toBeUndefined()
  })

  test('SIe leaves skillRoot and non-empty matcher Stop hooks alone', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    const sessionId = getSessionId()
    addSessionHook(
      context.setAppState,
      sessionId,
      'Stop',
      '',
      { type: 'prompt', prompt: 'skill stop' },
      undefined,
      '/skills/demo',
    )
    addSessionHook(context.setAppState, sessionId, 'Stop', 'Bash', {
      type: 'prompt',
      prompt: 'matcher stop',
    })
    const loaded = await goal.load()
    await loaded.call('全面对齐', context as never)
    const prompts = () =>
      (
        getSessionHooks(state as AppState, sessionId, 'Stop').get('Stop') ?? []
      ).flatMap(m => m.hooks.map(h => ('prompt' in h ? h.prompt : '')))
    expect(prompts()).toEqual(
      expect.arrayContaining(['skill stop', 'matcher stop', '全面对齐']),
    )
    const cleared = await loaded.call('clear', context as never)
    expect(cleared).toEqual({
      type: 'text',
      value: 'Goal cleared: 全面对齐',
    })
    expect(state.activeGoal).toBeUndefined()
    expect(prompts()).toEqual(
      expect.arrayContaining(['skill stop', 'matcher stop']),
    )
    expect(prompts()).not.toContain('全面对齐')
  })

  test('vJe is a no-op when the only Stop hook has a skillRoot', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    addSessionHook(
      context.setAppState,
      getSessionId(),
      'Stop',
      '',
      { type: 'prompt', prompt: 'skill stop' },
      undefined,
      '/skills/demo',
    )
    state.activeGoal = {
      condition: 'still here',
      setAt: Date.now(),
      iterations: 0,
      tokensAtStart: 0,
    }
    const loaded = await goal.load()
    const cleared = await loaded.call('clear', context as never)
    expect(cleared).toEqual({ type: 'text', value: 'No goal set' })
    expect(state.activeGoal?.condition).toBe('still here')
  })

  test('vJe removes every empty-matcher prompt Stop hook', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    const sessionId = getSessionId()
    addSessionHook(context.setAppState, sessionId, 'Stop', '', {
      type: 'prompt',
      prompt: 'first goal',
    })
    addSessionHook(context.setAppState, sessionId, 'Stop', '', {
      type: 'prompt',
      prompt: 'second goal',
    })
    const loaded = await goal.load()
    const cleared = await loaded.call('clear', context as never)
    expect(cleared).toEqual({
      type: 'text',
      value: 'Goal cleared: first goal',
    })
    expect(state.activeGoal).toBeUndefined()
    const prompts = (
      getSessionHooks(state as AppState, sessionId, 'Stop').get('Stop') ?? []
    ).flatMap(m => m.hooks.map(h => ('prompt' in h ? h.prompt : '')))
    expect(prompts).not.toContain('first goal')
    expect(prompts).not.toContain('second goal')
  })

  test('status includes Last check when lastReason is set', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    const loaded = await goal.load()
    await loaded.call('全面对齐', context as never)
    state.activeGoal = {
      ...state.activeGoal!,
      iterations: 1,
      lastReason: '1+1 is not yet computed',
    }
    const status = await loaded.call('', context as never)
    expect(status.type).toBe('text')
    if (status.type === 'text') {
      expect(status.value).toContain('Goal active: 全面对齐 (1 turn)')
      expect(status.value).toContain('Last check: 1+1 is not yet computed')
    }
  })
})

describe('runtime tool pool', () => {
  test('getAllBaseTools includes ProposeGoal, excludes analog GoalTool', () => {
    const names = getAllBaseTools().map(t => t.name)
    expect(names).toContain('ProposeGoal')
    expect(names).not.toContain('GoalTool')
  })
})

describe('gold Stop eval (source)', () => {
  test('ok:false prompt hook does not preventContinuation', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/utils/hooks/execPromptHook.ts'),
    ).text()
    const idx = src.indexOf('Prompt hook condition was not met')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 700)
    expect(slice).toContain('stopReason: parsed.data.reason')
    expect(slice).not.toContain('preventContinuation: true')
  })

  test('stopHooks yields active_goal on met and not_met', async () => {
    const src = await Bun.file(join(ROOT, 'src/query/stopHooks.ts')).text()
    expect(src).toContain("type: 'active_goal'")
    expect(src).toContain('tengu_goal_achieved')
    expect(src).toContain('lastReason: result.stopReason')
    expect(src).toContain("type: 'goal_status'")
  })

  test('Stop met/not_met use Ne then live $e; ht is error/timeout only', async () => {
    const src = await Bun.file(join(ROOT, 'src/query/stopHooks.ts')).text()
    expect(src).toContain('const goalAtStop = toolUseContext.agentId')
    expect(src).toContain('matchRegisteredStopHook')
    expect(src).toContain('isHookEqual')
    expect(src).toContain(
      'const liveGoal = toolUseContext.getAppState().activeGoal',
    )
    expect(src).toContain('liveGoal?.condition === goalHook.prompt')
    expect(src).toContain('isGoalPromptHook(result.hook, liveGoal.condition)')
    expect(src).toContain('result.timedOut')
    expect(src).toContain('evaluator_timeout')
    const ht = src.indexOf('const goalAtStop = toolUseContext.agentId')
    const live = src.indexOf(
      'const liveGoal = toolUseContext.getAppState().activeGoal',
    )
    const timedOut = src.indexOf('if (result.timedOut)')
    expect(ht).toBeGreaterThan(0)
    expect(live).toBeGreaterThan(ht)
    expect(timedOut).toBeGreaterThan(ht)
  })

  test('goal not_met still feeds the model; gold cap Z=_r+1 includes not_met', async () => {
    const stopSrc = await Bun.file(join(ROOT, 'src/query/stopHooks.ts')).text()
    expect(stopSrc).toContain("goalPass = 'not_met'")
    expect(stopSrc).toContain("goalPass = 'met'")
    const querySrc = await Bun.file(join(ROOT, 'src/query.ts')).text()
    expect(querySrc).toContain('const nextBlockCount = stopHookBlockCount + 1')
    expect(querySrc).not.toContain("stopHookResult.goalPass === 'not_met'")
  })

  test('executeHooks yields timedOut for prompt Stop when parent did not abort', async () => {
    const src = await Bun.file(join(ROOT, 'src/utils/hooks.ts')).text()
    expect(src).toContain(
      "promptResult.outcome === 'cancelled' && !signal?.aborted",
    )
    expect(src).toContain('timedOut: true')
    expect(src).toContain("result.hook.type === 'prompt'")
    expect(src).toContain("hookEvent === 'Stop'")
  })
})

describe('gold /goal Dialog (local-jsx)', () => {
  test('empty /goal returns GoalStatusDialog, not analog footer pill', async () => {
    const src = await Bun.file(join(ROOT, 'src/commands/goal/goal.tsx')).text()
    expect(src).toContain('Goal active')
    expect(src).toContain('/goal clear to stop early')
    expect(src).toContain('Goal achieved')
    expect(src).toContain('No goal set')
    expect(src).toContain("display: 'skip'")
    expect(src).toContain('shouldQuery: true')
    expect(src).toContain('metaMessages')
    expect(src).not.toContain('goalState')
    expect(src).not.toContain('GoalTool')
  })

  test('empty jsx call returns a Dialog element and skip-onDone', async () => {
    const { call } = await import('../goal/goal.js')
    let done: { result?: string; options?: unknown } | undefined
    const node = await call(
      (result, options) => {
        done = { result, options }
      },
      { messages: [] } as never,
      '',
    )
    expect(node).not.toBeNull()
    expect(done).toBeUndefined()
    expect(React.isValidElement(node)).toBe(true)
  })
})
