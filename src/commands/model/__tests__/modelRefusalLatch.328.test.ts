import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getRefusalFallbackModelLatch,
  resetStateForTests,
  setRefusalFallbackModelLatch,
  takeCarriedEffortEnd,
} from '../../../bootstrap/state.js'
import { call as modelCommandCall } from '../model.js'

afterEach(() => {
  resetStateForTests()
})

describe('Wave 3D: /model clears refusal fallback model latch with model_pick', () => {
  test('inline /model <alias> clears refusal fallback latch and records model_pick carriedEffortEnd', async () => {
    resetStateForTests()
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-7',
      carriedEffort: 'high',
    })

    let state = {
      mainLoopModel: 'claude-opus-4-7' as string | null,
      mainLoopModelForSession: null as string | null,
      fastMode: false,
      toolPermissionContext: { mode: 'default' as const },
    }
    const doneMessages: string[] = []

    const jsx = await modelCommandCall(
      msg => {
        if (msg) doneMessages.push(msg)
      },
      {
        getAppState: () => state as never,
        setAppState: (updater: (prev: typeof state) => typeof state) => {
          state = updater(state)
        },
        messages: [],
      } as never,
      'sonnet',
    )

    expect(jsx).toBeNull()
    expect(doneMessages.length).toBe(1)
    expect(state.mainLoopModel).toBe('sonnet')
    expect(getRefusalFallbackModelLatch()).toBeUndefined()
    expect(takeCarriedEffortEnd()).toBe('model_pick')
  })

  test('/model status does not clear refusal fallback latch', async () => {
    resetStateForTests()
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-7',
      carriedEffort: 'high',
    })

    const state = {
      mainLoopModel: 'claude-opus-4-7' as string | null,
      mainLoopModelForSession: null as string | null,
      fastMode: false,
      toolPermissionContext: { mode: 'default' as const },
    }
    const doneMessages: string[] = []

    await modelCommandCall(
      msg => {
        if (msg) doneMessages.push(msg)
      },
      {
        getAppState: () => state as never,
        setAppState: () => {},
        messages: [],
      } as never,
      'status',
    )

    expect(doneMessages.length).toBe(1)
    expect(getRefusalFallbackModelLatch()?.fallbackModel).toBe(
      'claude-sonnet-4-6',
    )
    expect(takeCarriedEffortEnd()).toBeUndefined()
  })

  test('model.tsx clears refusal fallback latch in picker, JSX command, and inline direct commit paths', () => {
    const src = readFileSync(join(import.meta.dir, '../model.tsx'), 'utf8')
    const matches =
      src.match(/clearRefusalFallbackModelLatch\('model_pick'\)/g) ?? []
    expect(matches.length).toBe(3)
  })
})
