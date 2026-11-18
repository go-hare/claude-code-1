import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AppState } from 'src/state/AppState.js'
import {
  acquireModelHookSlot,
  getActiveModelHookCount,
  MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  resetModelHookConcurrencyForTests,
} from '../modelHookConcurrency.js'
import {
  checkSkillHooksBounds,
  MAX_SKILL_HOOKS_PER_SOURCE,
  MAX_SKILL_MATCHER_CHARS_PER_SOURCE,
  registerSkillHooks,
} from '../registerSkillHooks.js'
import {
  clearSessionHooks,
  getSessionHooks,
  removeSessionHook,
} from '../sessionHooks.js'

function makeMockAppState(): {
  getState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
} {
  let state = { sessionHooks: new Map() } as unknown as AppState
  return {
    getState: () => state,
    setAppState: updater => {
      state = updater(state)
    },
  }
}

describe('hooks v2.1.302–2.1.304 (#928, #996, #1017)', () => {
  afterEach(() => {
    resetModelHookConcurrencyForTests()
  })

  test('#928: acquireModelHookSlot limits 12 concurrent slots per event and queues the rest', async () => {
    expect(MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT).toBe(12)
    const ac = new AbortController()
    const releases: Array<() => void> = []

    for (let i = 0; i < 12; i++) {
      const rel = await acquireModelHookSlot('PreToolUse', ac.signal)
      expect(rel).toBeDefined()
      releases.push(rel!)
    }
    expect(getActiveModelHookCount('PreToolUse')).toBe(12)

    let granted13 = false
    const p13 = acquireModelHookSlot('PreToolUse', ac.signal).then(rel => {
      granted13 = true
      return rel
    })
    await Promise.resolve()
    expect(granted13).toBe(false)

    // Different event runs immediately without waiting on PreToolUse
    const otherRel = await acquireModelHookSlot('PostToolUse', ac.signal)
    expect(otherRel).toBeDefined()
    otherRel!()

    // Releasing one PreToolUse slot wakes #13
    releases.shift()!()
    const rel13 = await p13
    expect(granted13).toBe(true)
    expect(rel13).toBeDefined()
    rel13!()
    for (const r of releases) r()
    expect(getActiveModelHookCount('PreToolUse')).toBe(0)
  })

  test('#928: queued waiter cancels cleanly when AbortSignal aborts', async () => {
    const ac1 = new AbortController()
    const releases: Array<() => void> = []
    for (let i = 0; i < 12; i++) {
      releases.push((await acquireModelHookSlot('Stop', ac1.signal))!)
    }

    const acWaiter = new AbortController()
    const pWaiter = acquireModelHookSlot('Stop', acWaiter.signal)
    acWaiter.abort()
    expect(await pWaiter).toBeUndefined()

    for (const r of releases) r()
  })

  test('#996: once hook removal scopes by skillRoot so another skill with an identical hook is preserved', () => {
    const { getState, setAppState } = makeMockAppState()
    const sessionId = 'sess-996'
    const identicalHook = {
      type: 'command' as const,
      command: 'echo ok',
      once: true,
    }
    const hooks = {
      PreToolUse: [{ matcher: 'Bash', hooks: [identicalHook] }],
    }

    registerSkillHooks(
      setAppState,
      sessionId,
      hooks,
      'skill-a',
      '/repo/skills/a',
    )
    registerSkillHooks(
      setAppState,
      sessionId,
      hooks,
      'skill-b',
      '/repo/skills/b',
    )

    const before = getSessionHooks(getState(), sessionId, 'PreToolUse').get(
      'PreToolUse',
    )
    expect(before?.length).toBe(2)

    // Remove only skill-a's hook
    removeSessionHook(setAppState, sessionId, 'PreToolUse', identicalHook, {
      skillRoot: '/repo/skills/a',
    })

    const after = getSessionHooks(getState(), sessionId, 'PreToolUse').get(
      'PreToolUse',
    )
    expect(after?.length).toBe(1)
    expect(after?.[0]?.skillRoot).toBe('/repo/skills/b')
    clearSessionHooks(setAppState, sessionId)
  })

  test('#1017: enforces 1024 hooks and 16384 matcher chars per source per session', () => {
    const { getState, setAppState } = makeMockAppState()
    const sessionId = 'sess-1017'

    // 1024 hooks from same source fit; 1025th is rejected
    const bigHooks = Array.from({ length: 1024 }, (_, i) => ({
      type: 'command' as const,
      command: `echo ${i}`,
    }))
    registerSkillHooks(
      setAppState,
      sessionId,
      { PreToolUse: [{ matcher: 'Bash', hooks: bigHooks }] },
      'skill-1',
      '/repo/skills/s1',
    )
    expect(
      getSessionHooks(getState(), sessionId, 'PreToolUse').get(
        'PreToolUse',
      )?.[0]?.hooks.length,
    ).toBe(1024)

    // Same source (/repo/skills) trying to add 1 more hook fails count bound
    const res = checkSkillHooksBounds(
      sessionId,
      'skill',
      '/repo/skills',
      'skill-2',
      {
        PostToolUse: [
          { matcher: 'Read', hooks: [{ type: 'command', command: 'echo x' }] },
        ],
      },
    )
    expect(res).toBe('count')

    // Different source (/other/skills) has its own budget, but fails character bound > 16384
    const longMatcher = 'a'.repeat(MAX_SKILL_MATCHER_CHARS_PER_SOURCE + 1)
    const charRes = checkSkillHooksBounds(
      sessionId,
      'skill',
      '/other/skills',
      'skill-3',
      {
        PreToolUse: [
          {
            matcher: longMatcher,
            hooks: [{ type: 'command', command: 'echo y' }],
          },
        ],
      },
    )
    expect(charRes).toBe('characters')
    expect(MAX_SKILL_HOOKS_PER_SOURCE).toBe(1024)
    expect(MAX_SKILL_MATCHER_CHARS_PER_SOURCE).toBe(16384)

    clearSessionHooks(setAppState, sessionId)
  })
})
