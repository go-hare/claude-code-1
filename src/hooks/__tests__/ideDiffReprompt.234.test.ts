import { describe, expect, mock, test } from 'bun:test'

import { debugMock } from '../../../tests/mocks/debug'
import { logMock } from '../../../tests/mocks/log'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))
mock.module('src/services/analytics/metadata.js', () => ({
  sanitizeToolNameForAnalytics: (n: string) => n,
}))

import {
  createResolveOnce,
  isPermissionHookReprompt,
} from '../toolPermission/PermissionContext.js'
import { computeEditsFromContents } from '../useDiffInIDE.js'

describe('ideDiffReprompt.234 (#24)', () => {
  test('isPermissionHookReprompt only matches tagged still-ask', () => {
    expect(
      isPermissionHookReprompt({
        type: 'reprompt',
        reprompted: { behavior: 'ask', message: 'x' },
        finalInput: { a: 1 },
      }),
    ).toBe(true)
    expect(
      isPermissionHookReprompt({
        behavior: 'allow',
        updatedInput: { a: 1 },
      }),
    ).toBe(false)
    expect(isPermissionHookReprompt(null)).toBe(false)
  })

  test('createResolveOnce claim blocks second winner (Fmi)', () => {
    const resolved: unknown[] = []
    const once = createResolveOnce(v => {
      resolved.push(v)
    })
    expect(once.claim()).toBe(true)
    expect(once.claim()).toBe(false)
    expect(once.isResolved()).toBe(true)
    // resolve after claim still delivers once
    once.resolve({ behavior: 'allow' })
    once.resolve({ behavior: 'deny' })
    expect(resolved).toEqual([{ behavior: 'allow' }])
  })

  test('createResolveOnce resolve alone claims (Fmi.resolve sets t)', () => {
    const once = createResolveOnce(() => {})
    once.resolve(1)
    expect(once.claim()).toBe(false)
    expect(once.isResolved()).toBe(true)
  })

  test('computeEditsFromContents empty when contents equal (IDE reject)', () => {
    const edits = computeEditsFromContents(
      '/tmp/a.ts',
      'hello\n',
      'hello\n',
      'single',
    )
    expect(edits).toEqual([])
  })

  test('computeEditsFromContents returns edits when IDE modified', () => {
    const edits = computeEditsFromContents(
      '/tmp/a.ts',
      'hello\n',
      'hello world\n',
      'single',
    )
    expect(edits.length).toBeGreaterThan(0)
    expect(edits[0]?.new_string).toContain('world')
  })

  test('closed latch semantics: y||!claim skips applying previous input', () => {
    // Mirrors densable Mrf: if(y||!a())return before updatedInput apply
    let closed = false
    const once = createResolveOnce(() => {})
    const applied: unknown[] = []

    function applyIdeAccept(updatedInput: unknown) {
      if (closed || !once.claim()) return
      closed = true
      applied.push(updatedInput)
    }

    // Terminal / re-prompt closes tab first
    closed = true
    applyIdeAccept({ file_path: '/old.ts', content: 'STALE' })
    expect(applied).toEqual([])

    // Fresh prompt: new latch + new claim
    closed = false
    const once2 = createResolveOnce(() => {})
    function applyIdeAccept2(updatedInput: unknown) {
      if (closed || !once2.claim()) return
      closed = true
      applied.push(updatedInput)
    }
    applyIdeAccept2({ file_path: '/new.ts', content: 'FRESH' })
    expect(applied).toEqual([{ file_path: '/new.ts', content: 'FRESH' }])
    // Late previous IDE result after claim loses
    applyIdeAccept2({ file_path: '/old.ts', content: 'STALE' })
    expect(applied).toEqual([{ file_path: '/new.ts', content: 'FRESH' }])
  })

  test('per-session latch is never reopened (Mrf y is per show)', () => {
    const previous = { closed: false, tabName: 'old' }
    const next = { closed: false, tabName: 'new' }
    previous.closed = true
    // new session must not un-close the previous object
    expect(previous.closed).toBe(true)
    expect(next.closed).toBe(false)
    function applyIfOpen(
      session: { closed: boolean },
      input: unknown,
      applied: unknown[],
    ) {
      if (session.closed) return
      session.closed = true
      applied.push(input)
    }
    const applied: unknown[] = []
    applyIfOpen(previous, { stale: true }, applied)
    applyIfOpen(next, { fresh: true }, applied)
    expect(applied).toEqual([{ fresh: true }])
  })

  test('reprompt path must not claim (tnf/L4n onReprompt)', () => {
    const once = createResolveOnce(() => {})
    const queuePatches: unknown[] = []

    function onHookResult(
      hookDecision:
        | { behavior: 'allow'; updatedInput: Record<string, unknown> }
        | {
            type: 'reprompt'
            reprompted: { behavior: 'ask'; message: string }
            finalInput: Record<string, unknown>
          },
    ) {
      if (
        hookDecision &&
        'type' in hookDecision &&
        hookDecision.type === 'reprompt'
      ) {
        if (once.isResolved()) return
        queuePatches.push({
          input: hookDecision.finalInput,
          permissionResult: hookDecision.reprompted,
        })
        return // no claim
      }
      if (!once.claim()) return
      once.resolve(hookDecision)
    }

    onHookResult({
      type: 'reprompt',
      reprompted: { behavior: 'ask', message: 'still need approval' },
      finalInput: { file_path: '/rewritten.ts', content: 'new' },
    })
    expect(once.isResolved()).toBe(false)
    expect(once.claim()).toBe(true) // still claimable by user/IDE
    expect(queuePatches).toEqual([
      {
        input: { file_path: '/rewritten.ts', content: 'new' },
        permissionResult: { behavior: 'ask', message: 'still need approval' },
      },
    ])
  })
})
